// wykorzystanie.js - zakładka "Wykorzystanie": na co mikrokontroler zużywa cykle zegara
//
// Emulator dolicza cykle każdej wykonanej instrukcji do jej adresu (stats.profMain
// i stats.profIsr). Tutaj adresy są przypisywane do funkcji i linii programu, a czas
// dzielony na: program główny, przerwania, czekanie (delay/millis) i uśpienie.

import { VECTOR_NAMES, FLASH_WORDS } from './avr.js';
import { getLang } from './i18n.js';

const SNAP_EVERY = 0.25;    // [s czasu symulacji] co ile zapamiętywać stan liczników
const WINDOW = 1;           // [s] okno "ostatnia sekunda"

// funkcje biblioteki, w których procesor tylko odmierza czas
const WAIT_FUNCS = /^(delay|delayMicroseconds|micros|millis|yield|_delay)\b/;

const CATS = [
  { key: 'main', name: 'Program główny', color: '#3ec7ff' },
  { key: 'isr', name: 'Przerwania', color: '#ff9f43' },
  { key: 'wait', name: 'Czekanie (delay, millis)', color: '#5c677b' },
  { key: 'sleep', name: 'Uśpienie (sleep)', color: '#2f3a4e' },
];

const pct = (x) => {
  const s = (x * 100).toFixed(x < 0.1 ? 1 : 0);
  return (getLang() === 'en' ? s : s.replace('.', ',')) + '%';
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class CpuUse {
  constructor(root) {
    this.root = root;
    this.mode = 'last';
    this.snaps = [];
    this.chip = null;
    this.built = false;
  }

  // nowy program w układzie: przypisz każdy adres do funkcji
  setProgram(chip) {
    this.chip = chip;
    this.snaps = [];
    this.funcOf = new Int16Array(FLASH_WORDS).fill(-1);
    this.funcs = [];
    if (!chip) return;
    for (const f of chip.symbols.funcs) {
      if (!f.size) continue;
      const v = f.name.match(/^__vector_(\d+)$/);
      const name = v ? `ISR(${VECTOR_NAMES[+v[1]] || v[1]})` : f.name.replace(/^[LSF]_/, '').replace(/\.constprop\.\d+|\.part\.\d+/, '');
      const idx = this.funcs.push({ name, wait: WAIT_FUNCS.test(name), lib: !v && name !== 'main' && !/\)$/.test(f.name) }) - 1;   // funkcje C++ użytkownika mają nawiasy (nm -C)
      for (let a = f.addr >> 1; a < Math.min(FLASH_WORDS, (f.addr + f.size) >> 1); a++) this.funcOf[a] = idx;
    }
  }

  // wywoływane co klatkę - zapamiętuje stan liczników co SNAP_EVERY sekund symulacji
  sample(cpu) {
    const last = this.snaps[this.snaps.length - 1];
    if (last && last.stats !== cpu.stats) this.snaps = [];
    const t = cpu.time();
    if (last && last.stats === cpu.stats && t - last.t < SNAP_EVERY) return;
    this.snaps.push(this.snapshot(cpu));
    while (this.snaps.length > 2 && t - this.snaps[1].t >= WINDOW) this.snaps.shift();
  }

  snapshot(cpu) {
    const s = cpu.stats;
    return { stats: s, t: cpu.time(), cycles: cpu.cycles, isr: s.isrCycles, sleep: s.sleepCycles,
      main: Float64Array.from(s.profMain), isrP: Float64Array.from(s.profIsr) };
  }

  build() {
    this.root.innerHTML =
      '<div class="cu-head"><div class="cu-big"><b id="cuBig">–</b> wykorzystania procesora</div>' +
      '<select id="cuMode"><option value="last">ostatnia sekunda</option><option value="all">od wgrania programu</option></select></div>' +
      '<div class="cu-bar" id="cuBar"></div><div class="cu-legend" id="cuLegend"></div>' +
      '<div class="note cu-note no-i18n"><span data-ui="pl">Mikrokontroler nigdy nie stoi – jeśli nie śpi, wykonuje instrukcje z pełną szybkością. ' +
      '<b>Wykorzystanie</b> to czas na program główny i przerwania. Czas w <code>delay()</code> i <code>millis()</code> to aktywne czekanie: ' +
      'procesor kręci się w pętli bez pożytecznej pracy, więc liczy się jako zapas, tak samo jak uśpienie. ' +
      'Pętla <code>loop()</code>, która ciągle odpytuje port albo zmienną, zużywa 100% – zapas dają dopiero przerwania i sleep.</span>' +
      '<span data-ui="en">A microcontroller never stands still – unless it sleeps, it executes instructions at full speed. ' +
      '<b>Utilization</b> is the time spent in the main program and interrupts. Time in <code>delay()</code> and <code>millis()</code> is busy-waiting: ' +
      'the CPU spins in a loop doing nothing useful, so it counts as spare capacity, just like sleep. ' +
      'A <code>loop()</code> that keeps polling a port or a variable uses 100% – only interrupts and sleep free the CPU.</span></div>' +
      '<h5>Funkcje</h5><table class="vars" id="cuFuncs"></table>' +
      '<h5>Linie programu</h5><table class="vars" id="cuLines"></table>';
    this.root.querySelector('#cuMode').onchange = (e) => { this.mode = e.target.value; };
    this.built = true;
  }

  render(cpu) {
    if (!this.built) this.build();
    const $ = (id) => this.root.querySelector(id);
    if (!this.chip) {
      $('#cuBig').textContent = '–';
      $('#cuBar').innerHTML = '';
      $('#cuLegend').innerHTML = '<span class="note">Brak programu w pamięci układu.</span>';
      $('#cuFuncs').innerHTML = $('#cuLines').innerHTML = '';
      return;
    }

    // różnica liczników: teraz minus początek okna
    const now = this.snapshot(cpu);
    const zero = { t: 0, cycles: 0, isr: 0, sleep: 0, main: new Float64Array(FLASH_WORDS), isrP: new Float64Array(FLASH_WORDS) };
    const base = this.mode === 'all' || !this.snaps.length ? zero : this.snaps[0];
    if (now.cycles - base.cycles <= 0) return;

    const funcCycles = new Float64Array(this.funcs.length + 1);   // ostatni = kod bez nazwy
    const funcIsr = new Float64Array(this.funcs.length + 1);
    const lineMain = new Map(), lineIsr = new Map();
    const lineOf = this.chip.lines ? this.chip.lines.lineOf : null;
    let wait = 0, mainSum = 0;
    for (let a = 0; a < FLASH_WORDS; a++) {
      const m = now.main[a] - base.main[a], i = now.isrP[a] - base.isrP[a];
      if (!m && !i) continue;
      const f = this.funcOf[a];
      const k = f < 0 ? this.funcs.length : f;
      funcCycles[k] += m + i;
      funcIsr[k] += i;
      mainSum += m;
      if (f >= 0 && this.funcs[f].wait) wait += m;
      const line = lineOf ? lineOf[a] : 0;
      if (line > 0) {
        if (m) lineMain.set(line, (lineMain.get(line) || 0) + m);
        if (i) lineIsr.set(line, (lineIsr.get(line) || 0) + i);
      }
    }

    // czas, w którym procesor działał - bez startu po resecie i braku zasilania
    const isr = now.isr - base.isr, sleep = now.sleep - base.sleep;
    const total = mainSum + isr + sleep;
    if (total <= 0) return;
    const part = { isr, sleep, wait, main: mainSum - wait };
    $('#cuBig').textContent = pct((part.main + part.isr) / total);
    $('#cuBar').innerHTML = CATS.map(c => part[c.key] > 0
      ? `<span style="width:${(part[c.key] / total) * 100}%;background:${c.color}" title="${c.name}: ${pct(part[c.key] / total)}"></span>` : '').join('');
    $('#cuLegend').innerHTML = CATS.map(c =>
      `<span><i style="background:${c.color}"></i>${c.name} <b>${pct(part[c.key] / total)}</b></span>`).join('');

    // funkcje - od najdroższej
    const rows = [];
    funcCycles.forEach((c, k) => {
      if (c < total * 0.0005) return;   // pomijaj funkcje poniżej 0,05%
      const f = this.funcs[k];
      const where = funcIsr[k] > c / 2 ? 'przerwanie' : f && f.wait ? 'czekanie' : f && f.lib ? 'biblioteka' : 'program';
      rows.push({ name: f ? f.name : '(tablica wektorów, start)', where, c });
    });
    rows.sort((a, b) => b.c - a.c);
    $('#cuFuncs').innerHTML = '<tr><th>Funkcja</th><th>Rodzaj</th><th>Czas</th></tr>' +
      rows.slice(0, 10).map(r => `<tr><td>${esc(r.name)}</td><td class="cu-${r.where}">${r.where}</td><td>${this.barCell(r.c / total)}</td></tr>`).join('');

    // linie programu użytkownika
    const src = (this.chip.src || '').split(/\r?\n/);
    const lines = [];
    for (const [l, c] of lineMain) lines.push({ l, c, isr: false });
    for (const [l, c] of lineIsr) lines.push({ l, c, isr: true });
    lines.sort((a, b) => b.c - a.c);
    $('#cuLines').innerHTML = lines.length
      ? '<tr><th>Linia</th><th>Kod</th><th>Czas</th></tr>' + lines.slice(0, 10).map(r =>
        `<tr><td>${r.l}${r.isr ? ' <small class="cu-przerwanie">ISR</small>' : ''}</td><td class="cu-src">${esc((src[r.l - 1] || '').trim())}</td><td>${this.barCell(r.c / total)}</td></tr>`).join('')
      : '<tr><td class="note">Brak informacji o liniach – czas zużywa kod biblioteki.</td></tr>';
  }

  barCell(x) {
    return `<span class="cu-cell"><span class="cu-mini" style="width:${Math.min(100, x * 100)}%"></span><span>${pct(x)}</span></span>`;
  }
}
