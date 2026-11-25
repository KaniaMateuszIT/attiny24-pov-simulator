// main.js - aplikacja symulatora: edytor, kompilacja, wgrywanie, symulacja, debuger, panele

import { ATtiny24, IO_GROUPS, REG, VECTOR_NAMES, RAM_START, RAM_END } from './avr.js';
import { Stand, NB } from './stanowisko.js';
import { StandView } from './widok.js';
import { Schematic } from './schemat.js';
import { Analyzer, fmtTime } from './analizator.js';
import { Editor } from './edytor.js';
import { compileProgram, parseBuild, funcAt, FLASH_SIZE, RAM_SIZE } from './kompilacja.js';
import { CpuUse } from './wykorzystanie.js';
import { setLang as setUiLang, getLang, initialLang, onLangChange } from './i18n.js';
import { download, savePng, GifRecorder } from './eksport.js';

const THEMES = ['dark', 'light', 'ocean', 'contrast'];
const REPO_URL = 'https://github.com/KaniaMateuszIT/attiny24-pov-simulator';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---------------------------------------------------------------- pamięć przeglądarki

const store = {
  get(k, d = null) { try { const v = localStorage.getItem('sym.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sym.' + k, JSON.stringify(v)); } catch { /* brak miejsca */ } },
};

const TEMPLATES = {
  cpp: `#include <Arduino.h>

void setup() {
  DDRA = 0b11111111;      // PA0..PA7 - wyjścia (anody diod)
  DDRB = 0b00001011;      // PB0, PB1 - tranzystory T1, T2; PB2 - fotodioda (wejście)
  PORTB = 0b00000011;     // T1 i T2 włączone - obie gałęzie diod aktywne
}

void loop() {

}
`,
  bas: `$regfile = "attiny24.dat"
$crystal = 8000000
$hwstack = 16
$swstack = 8
$framesize = 8

Config Porta = Output            ' PA0..PA7 - anody diod
Config Portb = &B00001011        ' PB0, PB1 - tranzystory, PB2 - fotodioda (wejście)
Portb = &B00000011               ' T1 i T2 włączone

Do

Loop

End
`,
};
const DEFAULT_NAMES = { cpp: 'main.cpp', bas: 'program.bas' };

// ---------------------------------------------------------------- stan

const cpu = new ATtiny24();
const stand = new Stand(cpu);
const view = new StandView($('#standCanvas'));
const schem = new Schematic($('#tab-schem'));
const analyzer = new Analyzer($('#tab-analyzer'));
const cpuUse = new CpuUse($('#cpuuse'));
const gif = new GifRecorder();

const app = {
  lang: store.get('lang', 'cpp'),
  sources: store.get('sources', {}),
  files: store.get('files', {}),
  chip: null,            // program w pamięci układu (wynik kompilacji)
  lastBuild: null,
  lastBuildSrc: null,
  busy: false,
  running: true,
  speed: 1,
  eff: 1,
  load: 0,
  stepLine: null,
  serverOk: false,
  examples: [],
  fcpu: store.get('fcpu', 8000000),
  rightTab: 'schem',
  leftTab: 'console',
};

const editor = new Editor($('#editor'), {
  onChange: () => { markDirty(); saveSourceSoon(); },
  onCursor: (l, c) => { $('#cursorPos').textContent = `${l}:${c}`; },
  onBreakpoints: () => { saveBreakpoints(); applyBreakpoints(); },
});
const cEditor = new Editor($('#ccode'));
cEditor.ta.readOnly = true;

cpu.hooks.pins = () => { stand.onPins(); analyzer.record(cpu); };

// dostęp z konsoli przeglądarki (F12) - do własnych eksperymentów
window.symulator = { cpu, stand, view, analyzer, app };
cpu.hooks.isr = (c, v) => analyzer.setIsr(c, c.isrDepth > 0);
cpu.hooks.diag = (type, info) => diagnostic(type, info);
cpu.hooks.reset = (src) => { if (src === 'wdt') analyzer.record(cpu); };

// ---------------------------------------------------------------- konsola i status

const consoleEl = $('#console');
function log(text, cls = 'out') {
  const d = document.createElement('div');
  d.className = cls;
  const ts = document.createElement('span');
  ts.className = 'ts';
  const now = new Date();
  ts.textContent = now.toTimeString().slice(0, 8);
  d.append(ts, text);
  consoleEl.append(d);
  while (consoleEl.childElementCount > 1500) consoleEl.firstChild.remove();
  const box = consoleEl.parentElement;
  box.scrollTop = box.scrollHeight;
  return d;
}

function setStatus(text, cls = '') {
  const s = $('#status');
  s.textContent = text;
  s.className = 'status ' + cls;
}

function showTab(group, name) {
  const tabs = $(`[data-tabs="${group}"]`);
  for (const b of $$('button[data-tab]', tabs)) b.classList.toggle('on', b.dataset.tab === name);
  const pane = tabs.parentElement;
  for (const b of $$('.tab-body', pane)) b.classList.toggle('on', b.dataset.body === name);
  if (group === 'right') { app.rightTab = name; store.set('rightTab', name); refreshPanels(true); }
  else { app.leftTab = name; store.set('leftTab', name); if (name === 'asm') renderAsm(); }
}

// ---------------------------------------------------------------- pliki i język

function saveSourceSoon() {
  clearTimeout(saveSourceSoon.t);
  saveSourceSoon.t = setTimeout(saveSource, 400);
}
function saveSource() {
  app.sources[app.lang] = editor.getValue();
  store.set('sources', app.sources);
}

function fileName() {
  return app.files[app.lang] || DEFAULT_NAMES[app.lang];
}

function setLang(lang, text) {
  if (app.lang !== lang) saveSource();
  app.lang = lang;
  store.set('lang', lang);
  for (const b of $$('#langSeg button')) b.classList.toggle('on', b.dataset.lang === lang);
  editor.setLanguage(lang);
  editor.setValue(text !== undefined ? text : (app.sources[lang] ?? TEMPLATES[lang]));
  editor.setBreakpoints(store.get('bp.' + lang, []));
  editor.setMarkers([]);
  $('#fileName').textContent = fileName();
  $('#tabCcode').style.display = lang === 'bas' ? '' : 'none';
  if (lang !== 'bas' && app.leftTab === 'ccode') showTab('left', 'console');
  updateModeInfo();
  markDirty();
}

function updateModeInfo() {
  const src = editor.getValue();
  let t;
  if (app.lang === 'bas') t = 'BASCOM-AVR → C → avr-gcc';
  else t = /\bint\s+main\s*\(/.test(src.replace(/\/\/.*$/gm, '')) ? 'C/C++, własne main() (bez Arduino)' : 'C++, Arduino (setup/loop)';
  $('#modeInfo').textContent = t;
}

function markDirty() {
  const dirty = app.chip && app.chip.lang === app.lang && app.chip.src != null && editor.getValue() !== app.chip.src;
  $('#dirty').textContent = dirty ? ' ● zmieniony – wgraj ponownie' : '';
  updateModeInfo();
}

function saveBreakpoints() {
  store.set('bp.' + app.lang, [...editor.breakpoints]);
}

async function saveToDisk() {
  const text = editor.getValue();
  const name = fileName();
  try {
    if (window.showSaveFilePicker) {
      const h = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: app.lang === 'bas' ? 'Program BASCOM' : 'Program C/C++', accept: { 'text/plain': [app.lang === 'bas' ? '.bas' : '.cpp'] } }],
      });
      const w = await h.createWritable();
      await w.write(text);
      await w.close();
      app.files[app.lang] = h.name;
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    }
    store.set('files', app.files);
    $('#fileName').textContent = fileName();
    log(`Zapisano plik ${fileName()}`, 'ok');
  } catch (e) {
    if (e.name !== 'AbortError') log('Nie udało się zapisać pliku: ' + e.message, 'err');
  }
}

function openFromDisk(file) {
  const r = new FileReader();
  r.onload = () => {
    const lang = /\.bas$/i.test(file.name) ? 'bas' : 'cpp';
    app.files[lang] = file.name;
    store.set('files', app.files);
    setLang(lang, String(r.result).replace(/\r\n/g, '\n'));
    saveSource();
    log(`Otwarto plik ${file.name}`, 'info');
  };
  r.readAsText(file);
}

// ---------------------------------------------------------------- przykłady

async function loadExamplesList() {
  try {
    app.examples = await (await fetch('przyklady/lista.json')).json();
  } catch {
    app.examples = [];
  }
  // dodatkowe przykłady spoza repozytorium (folder przyklady/prywatne jest w .gitignore)
  try {
    const res = await fetch('przyklady/prywatne/lista.json');
    if (res.ok) app.examples = app.examples.concat(await res.json());
  } catch { /* brak folderu - tylko przykłady podstawowe */ }
  const sel = $('#examples');
  sel.innerHTML = '<option value="">Przykłady…</option>';
  let group = null, og = null;
  app.examples.forEach((ex, i) => {
    if (ex.group !== group) {
      group = ex.group;
      og = document.createElement('optgroup');
      og.label = group;
      sel.append(og);
    }
    const o = document.createElement('option');
    o.value = i;
    o.textContent = ex.title;
    og.append(o);
  });
}

async function loadExample(i, upload = true) {
  const ex = app.examples[i];
  if (!ex) return;
  const text = (await (await fetch('przyklady/' + ex.file)).text()).replace(/\r\n/g, '\n');
  app.files[ex.lang] = ex.file;
  store.set('files', app.files);
  setLang(ex.lang, text);
  saveSource();
  log(`Przykład: ${ex.title} (${ex.file})`, 'info');
  if (ex.motor !== undefined) setMotor(ex.motor);
  if (upload) await doUpload();
}

// ---------------------------------------------------------------- kompilacja i wgrywanie

function updateMemBars(size) {
  const set = (el, used, total, label) => {
    const p = Math.min(100, used / total * 100);
    el.querySelector('i').style.width = p + '%';
    el.querySelector('span').textContent = `${label} ${used} / ${total} B (${Math.round(used / total * 100)}%)`;
    el.classList.toggle('warn', used / total > 0.85 && used <= total);
    el.classList.toggle('err', used > total);
  };
  if (!size) return;
  set($('#flashBar'), size.flash, FLASH_SIZE, 'Flash');
  set($('#ramBar'), size.ram, RAM_SIZE, 'RAM');
}

function showProblems(list) {
  const ul = $('#problems');
  ul.innerHTML = '';
  const errs = list.filter(p => p.severity === 'error').length;
  const warns = list.length - errs;
  const cnt = $('#probCount');
  cnt.textContent = list.length ? String(errs || warns) : '';
  cnt.className = 'cnt' + (errs ? '' : ' warn');
  if (!list.length) {
    ul.innerHTML = '<li class="empty">Brak błędów i ostrzeżeń.</li>';
    return;
  }
  for (const p of list) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="sev ${p.severity}"></span><span class="where">${p.line ? 'linia ' + p.line : '—'}</span><span class="msg"></span>`;
    li.querySelector('.msg').textContent = (p.severity === 'error' ? 'Błąd: ' : 'Ostrzeżenie: ') + p.message;
    if (p.hint) {
      const h = document.createElement('span');
      h.className = 'hint';
      h.textContent = '→ ' + p.hint;
      li.append(h);
    }
    if (p.line) li.onclick = () => editor.gotoLine(p.line);
    ul.append(li);
  }
}

async function doCompile() {
  if (app.busy) return null;
  if (!app.serverOk) await pingServer();
  app.busy = true;
  setStatus('Kompilacja…', 'busy');
  saveSource();
  const src = editor.getValue();
  const lang = app.lang;
  log(`Kompilacja ${fileName()} (${$('#modeInfo').textContent})`, 'info');
  let r;
  try {
    r = await compileProgram(lang, src, app.fcpu);
  } finally {
    app.busy = false;
  }
  for (const l of r.log) log(l.text, l.cls);
  showProblems(r.problems);
  editor.setMarkers(r.problems);
  if (lang === 'bas' && r.csource) cEditor.setValue(r.csource);
  if (r.size) updateMemBars(r.size);
  if (!r.ok) {
    const n = r.problems.filter(p => p.severity === 'error').length;
    log(r.offline ? 'Kompilacja niemożliwa – serwer symulatora nie działa.' : `Kompilacja nieudana: ${n} ${n === 1 ? 'błąd' : n < 5 ? 'błędy' : 'błędów'}.`, 'err');
    setStatus(r.offline ? 'Brak serwera' : 'Błąd kompilacji', 'err');
    if (!r.offline) showTab('left', 'problems');
    return null;
  }
  const w = r.problems.filter(p => p.severity === 'warning').length;
  log(`OK – Flash: ${r.size.flash} B z ${FLASH_SIZE} (${(r.size.flash / FLASH_SIZE * 100).toFixed(1)}%), RAM: ${r.size.ram} B z ${RAM_SIZE} (${(r.size.ram / RAM_SIZE * 100).toFixed(1)}%)` +
    `${w ? `, ostrzeżeń: ${w}` : ''} – ${r.ms} ms`, 'ok');
  if (w) showTab('left', 'problems');
  app.lastBuild = r;
  app.lastBuildSrc = src;
  setStatus(app.chip ? (app.running ? 'Program działa' : 'Pauza') : 'Skompilowano', app.running ? 'run' : 'pause');
  return r;
}

function ispProblem() {
  if (!$('#usbasp').checked) return 'usb';
  if (!cpu.powered) return 'power';
  if (!cpu.clockOk) return 'clock';
  if (cpu.rstdisbl()) return 'rstdisbl';
  if (!(cpu.fuses.high & 0x40)) return 'dwen';
  return null;
}

function avrdudeError(kind) {
  log('avrdude -c usbasp -p t24 -e -U flash:w:firmware.hex:i', 'cmd');
  if (kind === 'usb') {
    log("avrdude: error: could not find USB device with vid=0x16c0 pid=0x5dc vendor='www.fischl.de' product='USBasp'", 'err');
    log('→ Programator USBasp nie jest podłączony do komputera (pole „USBasp podłączony” w panelu stanowiska).', 'warn');
  } else {
    log('avrdude: warning: cannot set sck period. please check for usbasp firmware update.', 'dim');
    log("avrdude: error: program enable: target doesn't answer. 1", 'err');
    log('avrdude: initialization failed, rc=-1', 'err');
    log('         Double check connections and try again, or use -F to override this check.', 'err');
    const why = {
      power: 'Płytka nie ma zasilania – włącz „Zasilanie płytki”.',
      clock: 'Układ nie ma zegara: fusebity CKSEL wybierają zewnętrzny zegar lub kwarc, a na stanowisku ich nie ma. Pomoże tylko programator wysokonapięciowy (zakładka Fusebity).',
      rstdisbl: 'Fusebit RSTDISBL jest zaprogramowany – pin RESET działa jak zwykły PB3, więc USBasp nie może wprowadzić układu w tryb programowania. Pomoże tylko programator wysokonapięciowy.',
      dwen: 'Włączony debugWIRE (DWEN) blokuje programowanie przez ISP. Pomoże programator wysokonapięciowy.',
    }[kind];
    log('→ ' + why, 'warn');
  }
  setStatus('Błąd programowania', 'err');
}

function bar(p) {
  const n = Math.round(p * 50);
  return '#'.repeat(n) + ' '.repeat(50 - n);
}

async function animateProgress(label, seconds) {
  const line = log(`${label} | ${bar(0)} | 0% 0.00s`, 'out');
  const t0 = performance.now();
  return new Promise((res) => {
    const tick = () => {
      const p = Math.min(1, (performance.now() - t0) / 1000 / seconds);
      line.lastChild.textContent = `${label} | ${bar(p)} | ${Math.round(p * 100)}% ${(p * seconds).toFixed(2)}s`;
      stand.ispNoise();
      if (p < 1) setTimeout(tick, 40); else res();
    };
    tick();
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function doUpload() {
  if (app.busy) return;
  let r = app.lastBuild;
  if (!r || app.lastBuildSrc !== editor.getValue() || r.lang !== app.lang || r.fcpu !== (app.lang === 'bas' ? r.fcpu : app.fcpu)) r = await doCompile();
  if (!r) return;
  const prob = ispProblem();
  if (prob) { avrdudeError(prob); return; }
  app.busy = true;
  setStatus('Wgrywanie…', 'busy');
  const bytes = r.size.flash;
  stand.startIsp();
  try {
    log('avrdude -c usbasp -p t24 -e -U flash:w:firmware.hex:i', 'cmd');
    log('avrdude: warning: cannot set sck period. please check for usbasp firmware update.', 'dim');
    log('avrdude: AVR device initialized and ready to accept instructions', 'out');
    await sleep(120);
    log('avrdude: Device signature = 0x1e910b (probably t24)', 'out');
    log('avrdude: erasing chip', 'out');
    await sleep(150);
    log(`avrdude: writing ${bytes} bytes flash ...`, 'out');
    await animateProgress('Writing', 0.12 + bytes / 1400);
    log(`avrdude: ${bytes} bytes of flash written`, 'out');
    log('avrdude: verifying flash memory against firmware.hex', 'out');
    await animateProgress('Reading', 0.1 + bytes / 1700);
    log(`avrdude: ${bytes} bytes of flash verified`, 'out');
    const f = cpu.fuses;
    log(`avrdude: safemode: Fuses OK (E:${hex2(f.ext)}, H:${hex2(f.high)}, L:${hex2(f.low)})`, 'out');
    log('avrdude done.  Thank you.', 'ok');
  } finally {
    stand.endIsp();
    app.busy = false;
  }
  // kasowanie układu: EEPROM zostaje tylko z zaprogramowanym EESAVE
  if (cpu.fuses.high & 0x08) cpu.eeprom.fill(0xFF);
  if (r.eeprom && r.eeprom.some(b => b !== 0xFF)) {
    cpu.eeprom.set(r.eeprom.subarray(0, 128));
    log('avrdude: zapisano też EEPROM (zmienne EEMEM)', 'dim');
  }
  clearStepLine();
  installProgram(r, app.lastBuildSrc);
  saveChip();
  store.set('eeprom', Array.from(cpu.eeprom));
  cpu.reset('isp');
  resetDiagnostics();
  analyzer.clear();
  stand.clearPov();
  setRunning(true);
  checkFcpu();
}

function installProgram(r, src) {
  app.chip = r;
  app.chip.src = src;
  cpu.loadFlash(r.flashWords);
  cpu.stats = cpu.newStats();
  cpuUse.setProgram(r);
  cpu.badIrqAddr = r.symbols.badIrq;
  cpu.stopAddr = r.symbols.stop;
  updateMemBars(r.size);
  applyBreakpoints();
  buildVarsTable();
  app.asmDirty = true;
  if (app.leftTab === 'asm') renderAsm();
  markDirty();
}

function saveChip() {
  const c = app.chip;
  if (!c) return;
  store.set('chip', { raw: c.raw, lang: c.lang, fcpu: c.fcpu, src: c.src, basicVars: c.basicVars || (c.basic ? c.basic.vars : null), csource: c.csource || null });
}

function restoreChip() {
  const s = store.get('chip');
  if (!s || !s.raw) return;
  try {
    const r = parseBuild(s.raw, s.lang, s.basicVars);
    r.lang = s.lang;
    r.fcpu = s.fcpu;
    r.csource = s.csource;
    installProgram(r, s.src);
    if (s.lang === app.lang) app.lastBuildSrc = s.src;
    if (s.csource) cEditor.setValue(s.csource);
    log(`W pamięci układu jest program z poprzedniej sesji (${s.lang === 'bas' ? 'BASCOM' : 'C/C++'}, ${r.size.flash} B).`, 'dim');
  } catch (e) {
    log('Nie udało się odtworzyć programu z poprzedniej sesji: ' + e.message, 'warn');
  }
}

// ---------------------------------------------------------------- diagnostyka

const diagState = { seen: new Map(), last: null };

function resetDiagnostics() {
  diagState.seen.clear();
  diagState.last = { resets: cpu.stats.resets, isr: cpu.stats.isrCycles, cyc: cpu.cycles, lost: cpu.stats.lostIrq[1], t: performance.now(), intOff: 0, noTr: 0 };
}

function diagMsg(key, text, cls = 'diag') {
  const s = diagState.seen.get(key);
  if (s) {
    s.count++;
    s.el.lastChild.textContent = `${text}  (×${s.count})`;
    return;
  }
  const el = log(text, cls);
  diagState.seen.set(key, { count: 1, el });
}

function diagnostic(type, info) {
  switch (type) {
    case 'badirq': {
      const v = VECTOR_NAMES[info.vector];
      diagMsg('badirq' + info.vector, `⚠ Zgłosiło się przerwanie ${v}, ale program nie ma procedury ISR(${v}_vect). Procesor skoczył do __bad_interrupt, a stamtąd pod adres 0 – program wystartował od nowa.`, 'diag e');
      break;
    }
    case 'wdt':
      diagMsg('wdt', '⚠ Watchdog zresetował mikrokontroler – program nie wywołał wdt_reset() w wymaganym czasie (po takim resecie flaga WDRF wymusza dalsze działanie watchdoga).', 'diag e');
      break;
    case 'ram':
      diagMsg('ram', `⚠ Odwołanie do nieistniejącej pamięci RAM (adres 0x${info.addr.toString(16).toUpperCase()}, instrukcja 0x${(info.pc * 2).toString(16)}). ATtiny24 ma RAM 0x60–0xDF – to wyjście poza tablicę albo zły wskaźnik.`, 'diag e');
      break;
    case 'exit':
      diagMsg('exit', 'ℹ Program wyszedł z funkcji main() – procesor stoi w pętli bez końca z wyłączonymi przerwaniami (instrukcja End w BASIC-u działa tak samo).');
      break;
    case 'illegal':
      diagMsg('illegal', `⚠ Nieznana instrukcja 0x${info.word.toString(16).padStart(4, '0')} pod adresem 0x${(info.pc * 2).toString(16)} – procesor wykonuje dane albo pustą pamięć.`, 'diag e');
      break;
    case 'sleep':
      diagMsg('sleep', `ℹ Procesor przechodzi w tryb uśpienia (${['Idle', 'ADC Noise Reduction', 'Power-down', 'Power-down'][info.mode]}) i czeka na przerwanie.`);
      break;
    case 'clkpr':
      diagMsg('clkpr', `ℹ Program zmienił preskaler zegara (CLKPR): zegar procesora ${(cpu.freq / 1e6).toFixed(3)} MHz.`);
      checkFcpu();
      break;
    case 'eeprom':
      diagMsg('eeprom', `ℹ Zapis do EEPROM: adres ${info.addr} = ${info.val} (EEPROM zachowuje dane po wyłączeniu zasilania).`);
      store.set('eeprom', Array.from(cpu.eeprom));
      break;
  }
}

function checkFcpu() {
  const c = app.chip;
  if (!c || !cpu.clockOk) return;
  const fc = c.fcpu || 8000000;
  if (Math.abs(fc - cpu.freq) / fc > 0.01) {
    diagMsg('fcpu' + cpu.freq, `⚠ Program skompilowano dla F_CPU = ${fc / 1e6} MHz, a mikrokontroler pracuje z ${cpu.freq / 1e6} MHz – wszystkie opóźnienia i czasy będą ${(fc / cpu.freq).toFixed(fc > cpu.freq ? 0 : 2)}× ${fc > cpu.freq ? 'dłuższe' : 'krótsze'}.`, 'diag e');
  }
}

function periodicChecks() {
  const L = diagState.last;
  if (!L || !app.chip || !cpu.powered || !app.running) return;
  const D = cpu.data;
  if (cpu.minSp < app.chip.symbols.heapStart && cpu.minSp >= RAM_START - 1) {
    diagMsg('stack', `⛔ Stos zszedł do adresu 0x${cpu.minSp.toString(16).toUpperCase()} i nachodzi na zmienne globalne (kończą się na 0x${(app.chip.symbols.heapStart - 1).toString(16).toUpperCase()}) – zmienne dostają przypadkowe wartości!`, 'diag e');
  }
  if (cpu.minSp < RAM_START) diagMsg('stackio', '⛔ Stos zszedł poniżej początku RAM i nadpisuje rejestry I/O – program działa w sposób nieprzewidywalny.', 'diag e');
  if (D[REG.DDRB] & 4) diagMsg('pb2out', '⚠ PB2 (fotodioda / INT0) jest ustawiony jako wyjście – program nie odczyta fotodiody.');
  const pu = ~D[REG.DDRA] & D[REG.PORTA] & 0xFF;
  if (pu && !(D[REG.MCUCR] & 0x40)) diagMsg('pullup', `ℹ Piny PORTA ${bitsList(pu, 'PA')} są wejściami (DDRA = 0) z włączonym pull-upem – diody na nich świecą bardzo słabo. Ustaw je jako wyjścia w DDRA.`);
  const outHi = D[REG.DDRA] & D[REG.PORTA];
  if (outHi && !(cpu.lvl[1] & 3)) { if (++L.noTr === 6) diagMsg('notr', 'ℹ Na liniach PA są jedynki, ale oba tranzystory są wyłączone (PB0 = PB1 = 0) – żadna dioda nie świeci. Włącz T1 (PB0) lub T2 (PB1).'); } else L.noTr = 0;
  if ((D[REG.GIMSK] & 0x70) && !(D[REG.SREG] & 0x80) && !cpu.isrDepth) { if (++L.intOff === 6) diagMsg('intoff', '⚠ Przerwanie jest włączone w GIMSK, ale globalna flaga przerwań I jest wyłączona (brak sei() / Enable Interrupts) – procedura nie zostanie wywołana.'); } else L.intOff = 0;
  const dc = cpu.cycles - L.cyc;
  if (dc > cpu.freq * 0.2) {
    const p = (cpu.stats.isrCycles - L.isr) / dc;
    if (p > 0.6) diagMsg('isrload', `⚠ Procesor spędza ${(p * 100).toFixed(0)}% czasu w procedurach przerwań – pętla główna prawie nie działa. Skróć procedury przerwań.`);
    if (cpu.stats.resets - L.resets >= 3) diagMsg('resetloop', '⚠ Mikrokontroler restartuje się w kółko.', 'diag e');
    if (cpu.stats.lostIrq[1] > L.lost) diagMsg('lost', `ℹ Zgubione przerwania INT0: kolejne zbocze przyszło, zanim poprzednie zostało obsłużone${stand.cfg.bounce ? ' (drgania zbocza)' : ''}.`);
    Object.assign(L, { resets: cpu.stats.resets, isr: cpu.stats.isrCycles, cyc: cpu.cycles, lost: cpu.stats.lostIrq[1] });
  }
}

function bitsList(mask, p) {
  const out = [];
  for (let i = 0; i < 8; i++) if (mask & (1 << i)) out.push(p + i);
  return out.join(', ');
}

// ---------------------------------------------------------------- debuger

function currentLine() {
  const c = app.chip;
  if (!c || !c.lines) return 0;
  return c.lang === app.lang ? c.lines.lineOf[cpu.pc] : 0;
}

function applyBreakpoints() {
  const c = app.chip;
  const addrs = [];
  if (c && c.lines && c.lang === app.lang) {
    for (const line of editor.breakpoints) {
      let l = line;
      while (l < line + 30 && !c.lines.linesToAddr.has(l)) l++;
      const a = c.lines.linesToAddr.get(l);
      if (a) addrs.push(...a);
    }
  }
  if (!app.stepLine) cpu.setBreakpoints(addrs);
  app.userBp = addrs;
}

function setRunning(on) {
  app.running = on;
  $('#btnRun').textContent = on ? '⏸ Pauza' : '▶ Wznów';
  if (on) {
    editor.setExecLine(0);
    cpu.bpResume = true;
    setStatus(app.chip ? 'Program działa' : 'Brak programu', app.chip ? 'run' : '');
  }
  refreshPanels(true);
}

function clearStepLine() {
  if (!app.stepLine) return;
  app.stepLine = null;
  cpu.setBreakpoints(app.userBp || []);
}

function onStopped(reason) {
  const wasStep = !!app.stepLine;
  clearStepLine();
  setRunning(false);
  showPausePosition(wasStep && reason === 'bp' ? 'stepline' : reason);
}

function showPausePosition(reason) {
  const line = currentLine();
  editor.setExecLine(line);
  const fn = app.chip ? funcAt(app.chip.symbols, cpu.pc) : '';
  const where = line ? `linia ${line}` : `adres 0x${(cpu.pc * 2).toString(16)}${fn ? ' (' + fn + ')' : ''}`;
  setStatus(`Pauza – ${where}`, 'pause');
  if (reason === 'bp') log(`Zatrzymano na pułapce: ${where}`, 'info');
  if (reason === 'break') log(`Zatrzymano na instrukcji BREAK: ${where}`, 'info');
  if (app.leftTab === 'asm') renderAsm(true);
  refreshPanels(true);
}

function togglePause() {
  if (app.running) {
    clearStepLine();
    setRunning(false);
    showPausePosition('pause');
  } else {
    setRunning(true);
  }
}

function stepInstruction() {
  if (app.running) setRunning(false);
  cpu.bpResume = true;
  const reason = stand.advance(0.05, 1);
  stand.decay(0);
  showPausePosition(reason === 'step' ? 'step' : reason || 'step');
}

function stepLineCmd() {
  const c = app.chip;
  if (!c || !c.lines || c.lang !== app.lang) { stepInstruction(); return; }
  if (app.running) setRunning(false);
  const cur = currentLine();
  const lineOf = c.lines.lineOf;
  const addrs = [];
  for (let a = 0; a < lineOf.length; a++) if (lineOf[a] > 0 && lineOf[a] !== cur) addrs.push(a);
  for (const a of app.userBp || []) addrs.push(a);
  app.stepLine = { from: cur };
  cpu.setBreakpoints(addrs);
  cpu.bpResume = true;
  app.running = true;
  $('#btnRun').textContent = '⏸ Pauza';
  setStatus('Wykonywanie do następnej linii…', 'busy');
}

// ---------------------------------------------------------------- pętla symulacji

let lastFrame = performance.now();
let lastPanel = 0, lastCheck = 0, lastAn = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  const work0 = performance.now();
  if (app.running) {
    const want = dt * app.speed;
    const t0 = cpu.time();
    let reason = null;
    while (cpu.time() - t0 < want - 1e-9) {
      const chunk = Math.min(want - (cpu.time() - t0), 0.004);
      reason = stand.advance(chunk);
      if (reason) break;
      if (performance.now() - work0 > 13) break;
    }
    const done = cpu.time() - t0;
    stand.decay(done);
    if (dt > 0) app.eff = app.eff * 0.9 + 0.1 * (done / dt);
    if (reason) onStopped(reason);
  }
  view.showBoard = $('#showBoard').checked;
  view.strobe = $('#strobe').checked;
  view.draw(stand, cpu);
  if (gif.active) recordGifFrame();
  cpuUse.sample(cpu);
  updateHud();
  const work = performance.now() - work0;
  app.load = app.load * 0.95 + 0.05 * (dt > 0 ? work / (dt * 1000) : 0);
  if (now - lastPanel > 100) { lastPanel = now; refreshPanels(false); }
  if (app.rightTab === 'analyzer' && now - lastAn > 33) { lastAn = now; analyzer.draw(cpu.time()); }
  if (now - lastCheck > 500) { lastCheck = now; periodicChecks(); }
  requestAnimationFrame(frame);
}

function fmtNum(x, d = 1) {
  const s = x.toFixed(d);
  return getLang() === 'en' ? s : s.replace('.', ',');
}

function updateHud() {
  const rps = stand.rpsNow;
  const det = !(cpu.lvl[1] & 4);
  const t1 = cpu.lvl[1] & 1, t2 = (cpu.lvl[1] >> 1) & 1;
  const c = stand.cfg.colors;
  const dotc = (on, col) => `<span style="color:${on ? `rgb(${col.join(',')})` : '#4a5466'}">●</span>`;
  $('#hud').innerHTML =
    `<b>${fmtNum(rps)}</b> obr/s · ${Math.round(rps * 60)} obr/min<br>` +
    `fotodioda PB2: ${det ? '<span class="det">● wykrycie (0)</span>' : '○ brak (1)'}<br>` +
    `T1 (Led1) ${dotc(t1, c[0])}  T2 (Led2) ${dotc(t2, c[1])}` +
    (!cpu.powered ? '<br><span class="paused">BRAK ZASILANIA</span>' : !cpu.clockOk ? '<br><span class="paused">BRAK ZEGARA (fusebity)</span>' : '') +
    (!app.running ? '<br><span class="paused">⏸ PAUZA</span>' : '') +
    (stand.ispActive ? '<br><span class="det">PROGRAMOWANIE…</span>' : '');
  const isrP = cpu.cycles > 0 ? cpu.stats.isrCycles / cpu.cycles : 0;
  $('#hud2').innerHTML = `${cpu.clockOk ? fmtNum(cpu.freq / 1e6, 3) + ' MHz' : 'brak zegara'} · PC 0x${(cpu.pc * 2).toString(16).padStart(4, '0')}<br>` +
    `${app.chip ? `program: ${app.chip.size.flash} B` : 'pamięć programu pusta'}`;
  void isrP;
  $('#simTime').textContent = 't = ' + fmtNum(cpu.time(), 3) + ' s';
  $('#simLoad').textContent = app.running ? `symulacja ${fmtNum(app.eff, 2)}× · obciążenie ${Math.round(Math.min(1, app.load) * 100)}%` : 'zatrzymana';
}

// ---------------------------------------------------------------- panele

function refreshPanels(force) {
  if (app.rightTab === 'schem') schem.update(cpu, stand);
  else if (app.rightTab === 'regs') renderRegs();
  else if (app.rightTab === 'mem') renderMem();
  else if (app.rightTab === 'analyzer' && force) analyzer.draw(cpu.time());
  else if (app.rightTab === 'fuses' && force) renderFuses();
  else if (app.rightTab === 'cpu') cpuUse.render(cpu);
}

// --- rejestry
let regsBuilt = false;
const regEls = {};

function buildRegs() {
  const root = $('#regs');
  let h = '<div><h5>Procesor</h5><div class="kv">';
  for (const [k, n] of [['pc', 'PC'], ['fn', 'funkcja'], ['line', 'linia'], ['sp', 'SP'], ['cyc', 'cykle'], ['time', 'czas'], ['freq', 'zegar'], ['instr', 'instrukcje'], ['isr', 'w przerwaniu'], ['irqs', 'przerwania'], ['resets', 'resety']]) {
    h += `<span class="k">${n}</span><span class="v" data-r="${k}"></span>`;
  }
  h += '</div><h5>SREG</h5><div class="flags" data-r="sreg">' + 'ITHSVNZC'.split('').map(f => `<span title="${f}">${f}</span>`).join('') + '</div>';
  h += '<h5>Rejestry r0–r31</h5><div class="rfile">';
  for (let i = 0; i < 32; i++) h += `<div><i>r${i}</i><span data-rr="${i}">00</span></div>`;
  h += '</div></div><div>';
  for (const [g, regs] of IO_GROUPS) {
    h += `<h5>${g}</h5><div class="ioreg">`;
    for (const [name, bits] of regs) {
      if (Array.isArray(bits)) {
        h += `<span class="n">${name}</span><span class="bits">${bits.map(b => `<span class="${b ? '' : 'na'}">${b || '-'}</span>`).join('')}</span><span class="hex" data-io="${name}"></span>`;
      } else {
        h += `<span class="n">${name}</span><span class="hex wide" data-io="${name}"></span><span></span>`;
      }
    }
    h += '</div>';
  }
  h += '</div>';
  root.innerHTML = h;
  for (const el of $$('[data-r]', root)) regEls[el.dataset.r] = el;
  regEls.rr = $$('[data-rr]', root);
  regEls.io = $$('[data-io]', root).map(el => ({ el, name: el.dataset.io, bits: el.previousElementSibling && el.previousElementSibling.classList.contains('bits') ? [...el.previousElementSibling.children] : null, last: -1 }));
  regsBuilt = true;
}

// porównanie z ostatnio wpisanym tekstem, a nie z textContent - po angielsku
// i18n.js podmienia treść i porównanie z nią dawałoby "zmianę" co odświeżenie
function setText(el, t) {
  if (el._raw !== t) {
    el._raw = t;
    el.textContent = t;
    el.classList.remove('chg');
    void el.offsetWidth;
    el.classList.add('chg');
  }
}

function renderRegs() {
  if (!regsBuilt) buildRegs();
  const D = cpu.data;
  const line = currentLine();
  setText(regEls.pc, `0x${(cpu.pc * 2).toString(16).padStart(4, '0')} (słowo ${cpu.pc})`);
  regEls.fn.textContent = app.chip ? funcAt(app.chip.symbols, cpu.pc) || '–' : '–';
  regEls.line.textContent = line ? String(line) : '– (kod biblioteki)';
  setText(regEls.sp, `0x${cpu.sp.toString(16).toUpperCase()} (najniżej: 0x${cpu.minSp.toString(16).toUpperCase()})`);
  regEls.cyc.textContent = Math.round(cpu.cycles).toLocaleString('pl-PL');
  regEls.time.textContent = fmtTime(cpu.time());
  regEls.freq.textContent = cpu.clockOk ? `${cpu.freq / 1e6} MHz` : 'brak zegara';
  regEls.instr.textContent = cpu.stats.instr.toLocaleString('pl-PL');
  regEls.isr.textContent = cpu.isrDepth ? `tak (zagnieżdżenie ${cpu.isrDepth})` : 'nie';
  const irqs = [];
  cpu.stats.irqCount.forEach((n, v) => { if (v && n) irqs.push(`${VECTOR_NAMES[v]}: ${n}`); });
  regEls.irqs.textContent = irqs.join(', ') || '–';
  regEls.resets.textContent = String(cpu.stats.resets);
  const s = D[0x5F];
  [...regEls.sreg.children].forEach((el, i) => el.classList.toggle('on', !!(s & (0x80 >> i))));
  for (let i = 0; i < 32; i++) setText(regEls.rr[i], hex2(D[i]));
  for (const r of regEls.io) {
    let v;
    if (['TCNT1', 'OCR1A', 'OCR1B', 'ICR1'].includes(r.name)) {
      v = cpu.readIo16(r.name);
      if (v !== r.last) { setText(r.el, `0x${v.toString(16).toUpperCase().padStart(4, '0')}  (${v})`); r.last = v; }
      continue;
    }
    v = cpu.peekIo(r.name);
    if (v === r.last) continue;
    r.last = v;
    setText(r.el, '0x' + hex2(v));
    if (r.bits) r.bits.forEach((b, i) => b.classList.toggle('on', !!(v & (0x80 >> i))));
    else r.el.textContent = `0x${hex2(v)} (${v})`;
  }
}

// --- zmienne i pamięć
function buildVarsTable() {
  app.varsBuilt = false;
}

function renderMem() {
  const root = $('#mem');
  const c = app.chip;
  if (!app.varsBuilt) {
    let h = '<div class="note">Mapa pamięci RAM (0x60–0xDF): <span style="color:#6fa8dc">■</span> .data (zmienne z wartością początkową) <span style="color:#7fc29b">■</span> .bss (zmienne zerowane) <span style="color:#d0a060">■</span> stos (rośnie w dół od 0xDF)</div>';
    h += '<div class="ramdiag" id="ramdiag"><div class="data"></div><div class="bss"></div><div class="free"></div><div class="stack"></div></div>';
    h += '<div class="ramaxis"><span>0x60</span><span id="spInfo"></span><span>0xDF</span></div><div id="stackWarn"></div>';
    if (!c) h += '<div class="empty-note">Brak programu w pamięci układu.</div>';
    else {
      h += `<table class="vars"><tr><th>Zmienna</th><th>Adres</th><th>Rozmiar</th><th>Wartość</th><th>Bajty</th></tr>`;
      for (const v of c.vars) {
        h += `<tr class="${v.core ? 'core' : ''}" title="${v.core ? 'zmienna biblioteki' : ''}"><td>${escapeHtml(v.name)}${v.core ? ' <small>(bibl.)</small>' : ''}</td><td>0x${v.addr.toString(16).toUpperCase()}</td><td>${v.size} B</td><td class="val"></td><td class="bytes"></td></tr>`;
      }
      if (!c.vars.length) h += '<tr><td colspan="5" class="note">Program nie ma zmiennych globalnych.</td></tr>';
      h += '</table>';
    }
    h += '<h5 style="margin:14px 0 2px;color:var(--muted);font:600 11px var(--ui);text-transform:uppercase">EEPROM (128 B) <button class="btn sm" id="btnEeClear" style="margin-left:8px">Wyczyść</button></h5><div class="eep" id="eep"></div>';
    root.innerHTML = h;
    app.varRows = c ? [...root.querySelectorAll('.vars tr')].slice(1, 1 + c.vars.length) : [];
    $('#btnEeClear').onclick = () => { cpu.eeprom.fill(0xFF); store.set('eeprom', Array.from(cpu.eeprom)); renderMem(); };
    let e = '';
    for (let r = 0; r < 8; r++) {
      e += `<span class="a">${(r * 16).toString(16).padStart(2, '0')}</span>`;
      for (let k = 0; k < 16; k++) e += `<span data-e="${r * 16 + k}"></span>`;
    }
    $('#eep').innerHTML = e;
    app.eepEls = $$('#eep [data-e]');
    app.varsBuilt = true;
  }
  const D = cpu.data;
  // mapa RAM
  const total = RAM_END - RAM_START + 1;
  const dataSz = c ? c.size.data : 0, bssSz = c ? c.size.bss : 0;
  const sp = cpu.sp, minSp = cpu.minSp;
  const stackSz = Math.max(0, RAM_END - Math.max(RAM_START - 1, minSp));
  const used = dataSz + bssSz;
  const hit = c && minSp < RAM_START + used;
  const segs = $$('#ramdiag div');
  segs[0].style.width = dataSz / total * 100 + '%'; segs[0].textContent = dataSz ? `.data ${dataSz} B` : '';
  segs[1].style.width = bssSz / total * 100 + '%'; segs[1].textContent = bssSz ? `.bss ${bssSz} B` : '';
  segs[2].style.width = Math.max(0, total - used - stackSz) / total * 100 + '%'; segs[2].textContent = 'wolne';
  segs[3].style.width = Math.min(stackSz, total) / total * 100 + '%'; segs[3].textContent = stackSz > 6 ? `stos ${stackSz} B` : '';
  segs[3].classList.toggle('hit', !!hit);
  $('#spInfo').textContent = `SP = 0x${sp.toString(16).toUpperCase()}, najniżej 0x${minSp.toString(16).toUpperCase()}`;
  $('#stackWarn').innerHTML = hit ? '<div class="errbox">Stos zszedł na obszar zmiennych globalnych – ich wartości zostały nadpisane!</div>' : '';
  if (c) {
    c.vars.forEach((v, i) => {
      const row = app.varRows[i];
      if (!row) return;
      const bytes = [];
      for (let k = 0; k < Math.min(v.size, 16); k++) bytes.push(D[v.addr + k]);
      const valEl = row.children[3], byEl = row.children[4];
      const txt = formatVar(v, bytes);
      if (valEl._raw !== txt) { valEl._raw = txt; valEl.textContent = txt; valEl.classList.remove('chg'); void valEl.offsetWidth; valEl.classList.add('chg'); }
      byEl.textContent = bytes.map(hex2).join(' ') + (v.size > 16 ? ' …' : '');
    });
  }
  app.eepEls.forEach((el, i) => {
    const t = hex2(cpu.eeprom[i]);
    if (el.textContent !== t) { el.textContent = t; el.classList.toggle('set', cpu.eeprom[i] !== 0xFF); }
  });
}

function formatVar(v, b) {
  const t = v.type;
  const le = (n) => { let x = 0; for (let k = n - 1; k >= 0; k--) x = x * 256 + b[k]; return x; };
  if (t === 'SINGLE') return new DataView(new Uint8Array(b.slice(0, 4)).buffer).getFloat32(0, true).toPrecision(6);
  if (t === 'BIT') return String(b[0] & 1);
  if (v.size === 1) { const x = b[0]; return t === null ? `${x}${x > 127 ? ` (${x - 256})` : ''}` : String(x); }
  if (v.size === 2) { const x = le(2); return t === 'INTEGER' ? String(x > 32767 ? x - 65536 : x) : `${x}${t === null && x > 32767 ? ` (${x - 65536})` : ''}`; }
  if (v.size === 4) { const x = le(4); return t === 'LONG' ? String(x > 2147483647 ? x - 4294967296 : x) : String(x); }
  return `tablica ${v.size} B`;
}

// --- asembler
function renderAsm(scroll) {
  const root = $('#asm');
  const c = app.chip;
  if (!c) { root.innerHTML = '<div class="empty-note">Brak programu w pamięci układu.</div>'; app.asmDirty = false; return; }
  if (app.asmDirty !== false) {
    const rows = c.listing.rows;
    let h = '';
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.text.trim() || /file format|Disassembly of section/.test(r.text)) { h += '<div> </div>'; continue; }
      const cls = r.addr >= 0 ? '' : /^[0-9a-f]+ <.*>:$/.test(r.text) ? 'fn' : 'src';
      h += `<div class="${cls}" data-i="${i}">${escapeHtml(r.text)}</div>`;
    }
    root.innerHTML = h;
    app.asmDirty = false;
    app.asmPc = null;
  }
  const idx = c.listing.addrIndex.get(cpu.pc);
  if (app.asmPc) app.asmPc.classList.remove('pc');
  app.asmPc = idx !== undefined ? root.querySelector(`[data-i="${idx}"]`) : null;
  if (app.asmPc && !app.running) {
    app.asmPc.classList.add('pc');
    if (scroll !== false) app.asmPc.scrollIntoView({ block: 'center' });
  }
}

// --- fusebity
const FUSE_DEFS = {
  low: [[7, 'CKDIV8', 'Zegar podzielony przez 8 (8 MHz → 1 MHz). Fabrycznie zaprogramowany!'], [6, 'CKOUT', 'Zegar systemowy wyprowadzony na PB2 – zakłóca odczyt fotodiody'],
    [5, 'SUT1', 'Czas startu (SUT1:0)'], [4, 'SUT0', '']],
  high: [[7, 'RSTDISBL', 'PB3 zamiast RESET – USBasp przestaje działać!', 'danger'], [6, 'DWEN', 'debugWIRE – blokuje programowanie ISP', 'danger'],
    [5, 'SPIEN', 'Programowanie szeregowe (ISP) – nie da się zmienić przez USBasp', 'fixed'], [4, 'WDTON', 'Watchdog zawsze włączony (resetuje, jeśli nie ma wdt_reset())'],
    [3, 'EESAVE', 'EEPROM zachowany przy kasowaniu układu (wgrywaniu)'], [2, 'BODLEVEL2', 'Próg detektora spadku napięcia (BOD)'], [1, 'BODLEVEL1', ''], [0, 'BODLEVEL0', '']],
  ext: [[0, 'SELFPRGEN', 'Samoprogramowanie (instrukcja SPM)']],
};
const CKSEL = [[0x2, 'Wewnętrzny RC 8 MHz (stanowisko)'], [0x4, 'Wewnętrzny 128 kHz'], [0x0, 'Zegar zewnętrzny na PB0 – brak na stanowisku!'],
  [0x6, 'Kwarc zegarkowy 32 kHz – brak na stanowisku!'], [0xF, 'Kwarc 8 MHz – brak na stanowisku!']];
let fusePending = null;

function renderFuses() {
  if (!fusePending) fusePending = { ...cpu.fuses };
  const f = fusePending;
  const root = $('#fuses');
  const box = (key, title) => {
    let h = `<div class="fusebox"><h5>${title} <code>0x${hex2(f[key])}</code></h5>`;
    if (key === 'low') {
      h += `<div class="fusebit"><span></span><b>CKSEL3:0</b><select data-cksel>${CKSEL.map(([v, n]) => `<option value="${v}" ${(f.low & 0xF) === v ? 'selected' : ''}>${n}</option>`).join('')}${CKSEL.some(([v]) => v === (f.low & 0xF)) ? '' : `<option selected>inny (0x${(f.low & 0xF).toString(16)})</option>`}</select></div>`;
    }
    for (const [bit, name, desc, kind] of FUSE_DEFS[key]) {
      const prog = !(f[key] & (1 << bit));
      h += `<label class="fusebit ${kind === 'danger' ? 'danger' : ''}"><input type="checkbox" data-fuse="${key}" data-bit="${bit}" ${prog ? 'checked' : ''} ${kind === 'fixed' ? 'disabled' : ''}><b>${name}</b><span>${desc}</span></label>`;
    }
    return h + '</div>';
  };
  const base = { 0x2: 8e6, 0x4: 128e3 }[f.low & 0xF] || 0;
  const clk = base ? base / ((f.low & 0x80) ? 1 : 8) : 0;
  let info = `<div class="clockinfo">Zegar procesora po zapisie: <b>${clk ? (clk >= 1e6 ? clk / 1e6 + ' MHz' : clk / 1e3 + ' kHz') : 'BRAK – układ nie ruszy'}</b>. ` +
    `Zaznaczone pole = bit <b>zaprogramowany (0)</b>. Obecnie w układzie: <code>L:${hex2(cpu.fuses.low)} H:${hex2(cpu.fuses.high)} E:${hex2(cpu.fuses.ext)}</code>.<br>` +
    `F_CPU w kompilatorze (C/C++): <select id="fcpuSel"><option value="8000000">8 MHz (jak PlatformIO)</option><option value="1000000">1 MHz</option><option value="128000">128 kHz</option></select>` +
    ` <span class="note">– w BASCOM-ie ustala go $crystal.</span></div>`;
  if (!(f.high & 0x80)) info += '<div class="errbox" style="grid-column:1/-1">RSTDISBL: po zapisie USBasp nie będzie mógł już zaprogramować układu (tylko programator wysokonapięciowy).</div>';
  if (!clk) info += '<div class="errbox" style="grid-column:1/-1">Wybrane źródło zegara nie istnieje na stanowisku – po zapisie procesor stanie, a USBasp przestanie się z nim łączyć.</div>';
  root.innerHTML = box('low', 'Low fuse') + box('high', 'High fuse') + box('ext', 'Extended fuse') + info +
    `<div class="fuse-actions"><button class="btn primary sm" id="fuseWrite">Zapisz fusebity (avrdude)</button>
     <button class="btn sm" id="fuseStand">Ustawienia stanowiska (E2 D7 FF)</button>
     <button class="btn sm" id="fuseRevert">Cofnij zmiany</button>
     <button class="btn sm" id="fuseHv" title="Przywraca fabryczne fusebity niezależnie od stanu układu">Programator wysokonapięciowy…</button></div>`;
  $('#fcpuSel').value = String(app.fcpu);
  $('#fcpuSel').onchange = (e) => { app.fcpu = +e.target.value; store.set('fcpu', app.fcpu); log(`F_CPU dla kompilatora C/C++: ${app.fcpu} Hz – wgraj program ponownie.`, 'info'); };
  root.querySelector('[data-cksel]').onchange = (e) => { if (!isNaN(+e.target.value)) { f.low = (f.low & 0xF0) | +e.target.value; renderFuses(); } };
  for (const cb of $$('[data-fuse]', root)) {
    cb.onchange = () => {
      const k = cb.dataset.fuse, b = +cb.dataset.bit;
      if (cb.checked) f[k] &= ~(1 << b); else f[k] |= 1 << b;
      renderFuses();
    };
  }
  $('#fuseStand').onclick = () => { fusePending = { low: 0xE2, high: 0xD7, ext: 0xFF }; renderFuses(); };
  $('#fuseRevert').onclick = () => { fusePending = { ...cpu.fuses }; renderFuses(); };
  $('#fuseWrite').onclick = writeFuses;
  $('#fuseHv').onclick = async () => {
    const ok = await confirmBox('Programator wysokonapięciowy (HVSP)',
      'Na zajęciach nie ma takiego programatora – to „ratunek” dla układu, którego USBasp już nie widzi.\n\nZostaną przywrócone fabryczne fusebity L:62 H:DF E:FF. Uwaga: fabrycznie CKDIV8 jest zaprogramowany, więc układ ruszy z zegarem 1 MHz.');
    if (!ok) return;
    cpu.fuses = { low: 0x62, high: 0xDF, ext: 0xFF };
    afterFuseChange();
    log('Programator HV: przywrócono fabryczne fusebity L:62 H:DF E:FF (zegar 1 MHz – zapisz E2, żeby wrócić do 8 MHz).', 'warn');
  };
}

async function writeFuses() {
  const f = fusePending;
  const prob = ispProblem();
  if (prob) { avrdudeError(prob); return; }
  const danger = [];
  if (!(f.high & 0x80) && (cpu.fuses.high & 0x80)) danger.push('RSTDISBL – pin RESET stanie się zwykłym pinem PB3 i USBasp nie zaprogramuje już układu.');
  if (!(f.high & 0x40) && (cpu.fuses.high & 0x40)) danger.push('DWEN – debugWIRE zablokuje programowanie przez ISP.');
  const base = { 0x2: 1, 0x4: 1 }[f.low & 0xF];
  if (!base) danger.push('CKSEL – wybrane źródło zegara nie istnieje na stanowisku, procesor stanie.');
  if (!(f.high & 0x10) && (cpu.fuses.high & 0x10)) danger.push('WDTON – watchdog będzie zawsze włączony.');
  if (danger.length && !await confirmBox('Na pewno zapisać fusebity?', danger.join('\n\n'))) return;
  f.high |= 0x00;
  if (cpu.fuses.high & 0x20) f.high |= 0x20; else f.high &= ~0x20;    // SPIEN nie zmienia się przez ISP
  log(`avrdude -c usbasp -p t24 -U lfuse:w:0x${hex2(f.low)}:m -U hfuse:w:0x${hex2(f.high)}:m -U efuse:w:0x${hex2(f.ext)}:m`, 'cmd');
  for (const k of ['low', 'high', 'ext']) {
    const n = { low: 'lfuse', high: 'hfuse', ext: 'efuse' }[k];
    log(`avrdude: writing ${n} (1 bytes): 0x${hex2(f[k])}`, 'out');
    log(`avrdude: 1 bytes of ${n} verified`, 'out');
  }
  log('avrdude done.  Thank you.', 'ok');
  cpu.fuses = { ...f };
  afterFuseChange();
}

function afterFuseChange() {
  store.set('fuses', cpu.fuses);
  fusePending = { ...cpu.fuses };
  cpu.reset('isp');
  cpu.updateOcPins();
  resetDiagnostics();
  renderFuses();
  checkFcpu();
  if (!cpu.clockOk) log('⚠ Procesor nie ma zegara – program nie działa.', 'diag e');
}

// ---------------------------------------------------------------- okno potwierdzenia

function confirmBox(title, text) {
  return new Promise((res) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal"><h3></h3><p></p><div class="actions"><button class="btn" data-r="0">Anuluj</button><button class="btn primary" data-r="1">Tak</button></div></div>`;
    back.querySelector('h3').textContent = title;
    back.querySelector('p').textContent = text;
    back.onclick = (e) => {
      const r = e.target.dataset.r;
      if (r === undefined && e.target !== back) return;
      back.remove();
      res(r === '1');
    };
    document.body.append(back);
  });
}

// ---------------------------------------------------------------- język, motyw, o programie

function applyTheme(name) {
  const t = THEMES.includes(name) ? name : 'dark';
  if (t === 'dark') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  $('#theme').value = t;
  store.set('theme', t);
  analyzer.colors = null;            // analizator i widok stanowiska czytają kolory motywu z CSS
  view.colors = null;
  analyzer.draw();
}

function applyUiLang(l) {
  setUiLang(l);
  store.set('uiLang', getLang());
  for (const b of $$('#uiLangSeg button')) b.classList.toggle('on', b.dataset.uiLang === getLang());
}

function showAbout() {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal about no-i18n">
    <h3><span class="chip-ico"></span>ATtiny24 POV <span data-ui="pl">– symulator</span><span data-ui="en">Simulator</span></h3>
    <div class="who"><span data-ui="pl">Autor:</span><span data-ui="en">Author:</span> <b>Mateusz Kania</b></div>
    <p data-ui="pl">Symulator stanowiska z Laboratorium techniki mikroprocesorowej (Politechnika Śląska): emulator ATtiny24 z dokładnością do cyklu, wirująca płytka POV, prawdziwy kompilator avr-gcc, tłumacz BASCOM-AVR i debuger.</p>
    <p data-ui="en">A simulator of the Microprocessor Technology Lab board (Silesian University of Technology): a cycle-accurate ATtiny24 emulator, a spinning POV board, the real avr-gcc compiler, a BASCOM-AVR translator and a debugger.</p>
    <p><span data-ui="pl">Kod źródłowy (licencja MIT):</span><span data-ui="en">Source code (MIT license):</span> <a href="${REPO_URL}" target="_blank" rel="noopener">${REPO_URL.replace('https://', '')}</a></p>
    <p class="note" data-ui="pl">Dołączone oprogramowanie:</p><p class="note" data-ui="en">Bundled software:</p>
    <ul><li>avr-gcc 7.3.0, GNU Binutils – GPL</li><li>avr-libc – BSD</li><li>ATTinyCore 1.5.2 (Arduino) – LGPL</li></ul>
    <div class="actions"><button class="btn primary" data-close><span data-ui="pl">Zamknij</span><span data-ui="en">Close</span></button></div>
  </div>`;
  back.onclick = (e) => { if (e.target === back || e.target.closest('[data-close]')) back.remove(); };
  document.body.append(back);
}

// ---------------------------------------------------------------- eksport do sprawozdań

function savedLog(name, bytes) {
  if (!bytes) return;
  log(`Zapisano plik ${name} (${Math.max(1, Math.round(bytes / 1024))} kB).`, 'ok');
}

async function saveStandPng() {
  savedLog('stanowisko.png', await savePng(view.canvas, 'stanowisko.png'));
}

function startGif() {
  if (gif.active) return;
  gif.start(4, 20, 360);
  $('#btnGif').classList.add('on');
}

// kwadrat wokół talerza; nagranie co klatkę ekranu, po 4 s kodowanie i pobranie pliku
function recordGifFrame() {
  const s = Math.min(Math.round(view.R * 2.36), view.w, view.h);
  const crop = { x: Math.max(0, Math.round(view.cx - s / 2)), y: Math.max(0, Math.round(view.cy - s / 2)), s };
  const done = gif.capture(view.canvas, crop);
  const btn = $('#btnGif');
  if (!done) { btn.textContent = `⏺ ${fmtNum(gif.elapsed())} s`; return; }
  btn.textContent = 'Kodowanie…';
  setTimeout(() => {
    const blob = gif.encode();
    download('stanowisko.gif', blob);
    savedLog('stanowisko.gif', blob.size);
    btn.textContent = '⏺ GIF';
    btn.classList.remove('on');
  }, 30);
}

analyzer.onExport = async (kind) => {
  if (kind === 'png') { savedLog('analizator.png', await savePng(analyzer.canvas, 'analizator.png')); return; }
  const blob = new Blob(['﻿' + analyzer.toCsv(getLang() !== 'en')], { type: 'text/csv;charset=utf-8' });
  download('analizator.csv', blob);
  savedLog('analizator.csv', blob.size);
};

// ---------------------------------------------------------------- sterowanie stanowiskiem

function setMotor(on) {
  $('#motor').checked = on;
  stand.motor.on = on;
  saveSettings();
}

function bindControls() {
  const s = store.get('settings', {});
  const bind = (id, apply, fmt) => {
    const el = $('#' + id);
    if (s[id] !== undefined) { if (el.type === 'checkbox') el.checked = s[id]; else el.value = s[id]; }
    const f = () => { apply(el.type === 'checkbox' ? el.checked : el.value); if (fmt) fmt(el.value); saveSettings(); };
    el.addEventListener('input', f);
    el.addEventListener('change', f);
    f();
  };
  bind('motor', (v) => { stand.motor.on = v; });
  bind('rps', (v) => { stand.motor.target = +v; }, (v) => { $('#rpsVal').textContent = `${fmtNum(+v)} obr/s`; });
  bind('jitter', (v) => { stand.motor.jitter = +v; }, (v) => { $('#jitterVal').textContent = `${fmtNum(v * 100)}%`; });
  bind('direction', (v) => { stand.cfg.direction = +v; stand.clearPov(); });
  bind('bounce', (v) => { stand.cfg.bounce = v; });
  bind('blocked', (v) => { stand.cfg.sensorBlocked = v; });
  bind('sensorWidth', (v) => { stand.cfg.sensorWidth = v / 360; }, (v) => { $('#widthVal').textContent = `${v}°`; });
  bind('exposure', (v) => { stand.exposure = 0.01 * Math.pow(100, +v); }, () => { $('#expVal').textContent = `${Math.round(stand.exposure * 1000)} ms`; });
  bind('pa0Inner', (v) => { stand.cfg.pa0Inner = v; stand.clearPov(); });
  bind('redOpposite', (v) => { stand.cfg.redArmOffset = v ? 0.5 : 0; stand.clearPov(); });
  bind('colors', (v) => {
    const R = [255, 48, 36], G = [52, 255, 96], W = [235, 240, 255];
    stand.cfg.colors = v === 'gr' ? [G, R] : v === 'ww' ? [W, W] : [R, G];
    schem.last = {};
    for (const l of schem.leds) l._b = null;
  });
  bind('showBoard', () => {});
  bind('strobe', () => {});
  bind('usbasp', () => {});
  $('#power').checked = s.power !== false;
  $('#power').onchange = () => {
    if ($('#power').checked) { cpu.powerOn(); resetDiagnostics(); log('Zasilanie włączone – start programu.', 'info'); }
    else { cpu.powerOff(); log('Zasilanie wyłączone – zawartość RAM jest tracona, flash i EEPROM zostają.', 'info'); }
    saveSettings();
  };
  $('#btnReset').onclick = () => {
    if (!cpu.powered) return;
    if (cpu.rstdisbl()) { log('Przycisk RESET nie działa – fusebit RSTDISBL zmienił pin RESET w zwykły PB3.', 'warn'); return; }
    cpu.reset('ext');
    resetDiagnostics();
    log('Reset (przycisk RESET na płytce).', 'info');
  };
  $('#btnClearPov').onclick = () => stand.clearPov();
  for (const b of $$('#speedSeg button')) {
    b.onclick = () => {
      app.speed = +b.dataset.speed;
      for (const x of $$('#speedSeg button')) x.classList.toggle('on', x === b);
      store.set('speed', app.speed);
    };
  }
  const sp = store.get('speed', 1);
  app.speed = sp;
  for (const x of $$('#speedSeg button')) x.classList.toggle('on', +x.dataset.speed === sp);
}

function saveSettings() {
  const s = {};
  for (const id of ['motor', 'rps', 'jitter', 'direction', 'bounce', 'blocked', 'sensorWidth', 'exposure', 'pa0Inner', 'redOpposite', 'colors', 'showBoard', 'strobe', 'usbasp']) {
    const el = $('#' + id);
    s[id] = el.type === 'checkbox' ? el.checked : el.value;
  }
  s.power = $('#power').checked;
  store.set('settings', s);
}

// ---------------------------------------------------------------- podziały okna

function bindSplitters() {
  const sizes = store.get('layout', {});
  if (sizes.colLeft) $('#colLeft').style.width = sizes.colLeft;
  if (sizes.leftBottom) $('#leftBottom').style.height = sizes.leftBottom;
  if (sizes.rightBottom) $('#rightBottom').style.height = sizes.rightBottom;
  for (const sp of $$('.splitter')) {
    sp.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const target = $('#' + sp.dataset.split);
      const vert = sp.classList.contains('v');
      const start = vert ? e.clientX : e.clientY;
      const size0 = vert ? target.getBoundingClientRect().width : target.getBoundingClientRect().height;
      sp.classList.add('drag');
      const move = (ev) => {
        const d = (vert ? ev.clientX : ev.clientY) - start;
        const v = vert ? Math.max(320, Math.min(window.innerWidth - 420, size0 + d)) : Math.max(80, Math.min(window.innerHeight - 200, size0 - d));
        if (vert) target.style.width = v + 'px'; else target.style.height = v + 'px';
      };
      const up = () => {
        sp.classList.remove('drag');
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        store.set('layout', { colLeft: $('#colLeft').style.width, leftBottom: $('#leftBottom').style.height, rightBottom: $('#rightBottom').style.height });
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  }
}

// ---------------------------------------------------------------- pozostałe

function hex2(v) {
  return v.toString(16).toUpperCase().padStart(2, '0');
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function pingServer() {
  try {
    const r = await fetch('/api/ping', { cache: 'no-store' });
    app.serverOk = r.ok;
  } catch {
    app.serverOk = false;
  }
  return app.serverOk;
}

function bindUi() {
  for (const b of $$('#langSeg button')) {
    b.onclick = () => { if (b.dataset.lang !== app.lang) setLang(b.dataset.lang); };
  }
  $('#examples').onchange = async (e) => {
    const i = e.target.value;
    e.target.value = '';
    if (i === '') return;
    const dirty = editor.getValue() !== (app.sources[app.lang] ?? '') || (app.lastBuildSrc !== null && editor.getValue() !== app.lastBuildSrc);
    if (dirty && !await confirmBox('Wczytać przykład?', 'Bieżący program w edytorze zostanie zastąpiony. Zapisz go wcześniej, jeśli jest potrzebny.')) return;
    await loadExample(+i);
  };
  $('#btnNew').onclick = async () => {
    if (!await confirmBox('Nowy program', `Wyczyścić edytor i wstawić szablon programu (${app.lang === 'bas' ? 'BASCOM' : 'C++'})?`)) return;
    app.files[app.lang] = DEFAULT_NAMES[app.lang];
    store.set('files', app.files);
    setLang(app.lang, TEMPLATES[app.lang]);
    saveSource();
  };
  for (const b of $$('#uiLangSeg button')) b.onclick = () => applyUiLang(b.dataset.uiLang);
  $('#theme').onchange = (e) => applyTheme(e.target.value);
  $('#btnAbout').onclick = showAbout;
  $('#btnShot').onclick = saveStandPng;
  $('#btnGif').onclick = startGif;
  $('#btnOpen').onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = (e) => { const f = e.target.files[0]; if (f) openFromDisk(f); e.target.value = ''; };
  $('#btnSave').onclick = saveToDisk;
  $('#btnCompile').onclick = doCompile;
  $('#btnUpload').onclick = doUpload;
  $('#btnRun').onclick = togglePause;
  $('#btnStep').onclick = stepInstruction;
  $('#btnStepLine').onclick = stepLineCmd;
  for (const tabs of $$('[data-tabs]')) {
    tabs.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'clearConsole') { consoleEl.innerHTML = ''; diagState.seen.clear(); return; }
      if (b.dataset.tab) showTab(tabs.dataset.tabs, b.dataset.tab);
    });
  }
  window.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'F5') { e.preventDefault(); doUpload(); }
    else if (k === 'F7') { e.preventDefault(); doCompile(); }
    else if (k === 'F8') { e.preventDefault(); togglePause(); }
    else if (k === 'F10') { e.preventDefault(); stepLineCmd(); }
    else if (k === 'F11') { e.preventDefault(); stepInstruction(); }
    else if (k === 's' && e.ctrlKey) { e.preventDefault(); saveToDisk(); }
  });
  window.addEventListener('beforeunload', () => { saveSource(); store.set('eeprom', Array.from(cpu.eeprom)); });
}

// ---------------------------------------------------------------- start

async function boot() {
  // adres może narzucić motyw i język, np. index.html#theme=light&lang=en
  const hp = new URLSearchParams(location.hash.slice(1));
  applyTheme(hp.get('theme') || store.get('theme', 'dark'));
  applyUiLang(hp.get('lang') || initialLang(store.get('uiLang')));
  onLangChange(() => { refreshPanels(true); analyzer.draw(); updateHud(); });
  bindUi();
  bindControls();
  bindSplitters();
  const fz = store.get('fuses');
  if (fz) cpu.fuses = fz;
  const ee = store.get('eeprom');
  if (ee && ee.length === 128) cpu.eeprom.set(ee);
  showTab('right', store.get('rightTab', 'schem'));
  showTab('left', store.get('leftTab', 'console'));
  setLang(app.lang);
  log('Symulator ATtiny24 – stanowisko LTM. Kompilator: avr-gcc 7.3.0 (jak w PlatformIO), rdzeń Arduino ATtiny. Autor: Mateusz Kania.', 'info');
  const ok = await pingServer();
  app.online = !ok && !['localhost', '127.0.0.1'].includes(location.hostname);
  if (app.online) {
    log('Wersja online: przykłady działają od razu, a własne programy skompilujesz w wersji do pobrania (Windows, Linux, macOS) – link w oknie ⓘ.', 'info');
  } else if (!ok) {
    log('Brak połączenia z serwerem symulatora – kompilacja nie zadziała. Uruchom symulator plikiem Symulator.bat.', 'err');
    setStatus('Brak serwera', 'err');
  }
  await loadExamplesList();
  restoreChip();
  if ($('#power').checked) cpu.powerOn();
  resetDiagnostics();
  setRunning(true);
  if (!app.chip) setStatus('Pamięć programu pusta – wgraj program (F5)', '');
  requestAnimationFrame(frame);
  // adres z #przyklad=plik (np. index.html#przyklad=03_fala.cpp) od razu wgrywa ten przykład;
  // pierwsze uruchomienie: fala na kręcącym się talerzu
  const fromHash = decodeURIComponent((location.hash.match(/przyklad=([^&]+)/) || [])[1] || '');
  const first = !store.get('started');
  if ((fromHash || first) && (ok || app.online)) {
    store.set('started', true);
    const i = app.examples.findIndex(x => x.file === (fromHash || '03_fala.cpp'));
    if (i >= 0) {
      await loadExample(i, true);
      setMotor(true);
    }
  }
}

boot();
