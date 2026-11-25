// schemat.js - schemat stanowiska z kolorowaniem stanów logicznych na żywo

const PA_PIN = [13, 12, 11, 10, 9, 8, 7, 6];   // numery wyprowadzeń ATtiny24 (DIP/SOIC-14)
const ROW = (i) => 104 + i * 46;
const BUS1 = 540, BUS2 = 690, TY = 520;

function line(x1, y1, x2, y2, net, extra = '') {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${net ? `data-net="${net}"` : 'class="w-static"'} ${extra}/>`;
}
function poly(pts, net) {
  return `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" ${net ? `data-net="${net}"` : 'class="w-static"'}/>`;
}
function dot(x, y, net) {
  return `<circle cx="${x}" cy="${y}" r="3.2" ${net ? `data-net-fill="${net}"` : 'class="d-static"'}/>`;
}
function resH(x, y, label) {
  return `<rect x="${x}" y="${y - 6}" width="34" height="12" class="res"/><text x="${x + 17}" y="${y - 10}" class="lbl-s" text-anchor="middle">${label}</text>`;
}
function resV(x, y, label) {
  return `<rect x="${x - 6}" y="${y}" width="12" height="34" class="res"/><text x="${x + 10}" y="${y + 21}" class="lbl-s">${label}</text>`;
}
function led(x, y, id, name) {
  // dioda skierowana w prawo: anoda x, katoda x+26
  return `<g data-led="${id}"><title>${name}</title>
    <circle cx="${x + 12}" cy="${y}" r="15" class="led-glow"/>
    <polygon points="${x},${y - 9} ${x},${y + 9} ${x + 20},${y}" class="led-body"/>
    <line x1="${x + 20}" y1="${y - 9}" x2="${x + 20}" y2="${y + 9}" class="led-bar"/>
    <path d="M${x + 8} ${y - 12} l6 -7 m-3 0 h3 v3 M${x + 15} ${y - 10} l6 -7 m-3 0 h3 v3" class="led-arrow"/></g>`;
}
function mosfet(x, y, id, label) {
  // x = linia kanału, y = środek; dren u góry (y-26), źródło na dole (y+26), bramka z lewej
  return `<g data-fet="${id}"><title>${label}: BS170 (MOSFET N). Przewodzi, gdy na bramce jest stan wysoki.</title>
    <line x1="${x - 14}" y1="${y - 14}" x2="${x - 14}" y2="${y + 14}" class="fet"/>
    <line x1="${x - 8}" y1="${y - 16}" x2="${x - 8}" y2="${y - 6}" class="fet-ch"/>
    <line x1="${x - 8}" y1="${y - 4}" x2="${x - 8}" y2="${y + 4}" class="fet-ch"/>
    <line x1="${x - 8}" y1="${y + 6}" x2="${x - 8}" y2="${y + 16}" class="fet-ch"/>
    <polyline points="${x - 8},${y - 11} ${x},${y - 11} ${x},${y - 26}" fill="none" class="fet"/>
    <polyline points="${x - 8},${y + 11} ${x},${y + 11} ${x},${y + 26}" fill="none" class="fet"/>
    <polyline points="${x - 8},${y} ${x},${y} ${x},${y + 11}" fill="none" class="fet"/>
    <polygon points="${x - 7},${y} ${x - 2},${y - 3} ${x - 2},${y + 3}" class="fet-arrow"/>
    <text x="${x + 10}" y="${y - 4}" class="lbl">${label}</text><text x="${x + 10}" y="${y + 10}" class="lbl-s">BS170</text></g>`;
}

export class Schematic {
  constructor(root) {
    this.root = root;
    const s = [];
    s.push(`<svg viewBox="0 0 800 620" class="schem" xmlns="http://www.w3.org/2000/svg">`);
    // szyny zasilania
    s.push(line(40, 24, 780, 24, null, 'class="w-vcc"'), `<text x="44" y="18" class="lbl vcc">VCC +5 V</text>`);
    s.push(line(40, 598, 780, 598, null, 'class="w-gnd"'), `<text x="44" y="614" class="lbl gnd">GND</text>`);
    // układ scalony
    s.push(`<rect x="230" y="70" width="120" height="440" rx="6" class="ic"/>`);
    s.push(`<text x="290" y="96" class="ic-name" text-anchor="middle">ATtiny24</text>`);
    s.push(line(290, 70, 290, 24, null, 'class="w-vcc"'), `<text x="296" y="64" class="pin-n">1</text>`);
    s.push(line(290, 510, 290, 598, null, 'class="w-gnd"'), `<text x="296" y="524" class="pin-n">14</text>`);
    for (let i = 0; i < 8; i++) {
      const y = ROW(i);
      s.push(`<text x="342" y="${y + 4}" class="pin" text-anchor="end">PA${i}</text><text x="352" y="${y - 4}" class="pin-n">${PA_PIN[i]}</text>`);
      s.push(line(350, y, 400, y, 'pa' + i), dot(400, y, 'pa' + i));
      s.push(`<text x="356" y="${y + 15}" class="badge" data-badge="pa${i}"></text>`);
      // gałąź Led1 (T1)
      s.push(line(400, y, 420, y, 'pa' + i), led(420, y, i, `LED1${i + 1} - PA${i}, gałąź Led1 (T1)`));
      s.push(line(440, y, 458, y, 'k1' + i), resH(458, y, '1K'), line(492, y, BUS1, y, 'bus1'), dot(BUS1, y, 'bus1'));
      // gałąź Led2 (T2)
      s.push(poly([[400, y], [400, y + 18], [570, y + 18]], 'pa' + i), led(570, y + 18, 8 + i, `LED2${i + 1} - PA${i}, gałąź Led2 (T2)`));
      s.push(line(590, y + 18, 608, y + 18, 'k2' + i), resH(608, y + 18, '1K'), line(642, y + 18, BUS2, y + 18, 'bus2'), dot(BUS2, y + 18, 'bus2'));
    }
    // linie wspólne i tranzystory
    s.push(line(BUS1, ROW(0), BUS1, TY - 26, 'bus1'), `<text x="${BUS1 + 6}" y="${ROW(0) - 12}" class="lbl">Led1</text>`);
    s.push(line(BUS2, ROW(0) + 18, BUS2, TY - 26, 'bus2'), `<text x="${BUS2 + 6}" y="${ROW(0) + 6}" class="lbl">Led2</text>`);
    s.push(mosfet(BUS1, TY, 1, 'T1'), mosfet(BUS2, TY, 2, 'T2'));
    s.push(line(BUS1, TY + 26, BUS1, 598, null, 'class="w-gnd"'), line(BUS2, TY + 26, BUS2, 598, null, 'class="w-gnd"'));
    // PB0 -> R1 -> bramka T1, PB1 -> R2 -> bramka T2
    const PB_Y = [140, 210, 300, 400];
    s.push(`<text x="238" y="${PB_Y[0] + 4}" class="pin">PB0</text><text x="214" y="${PB_Y[0] - 4}" class="pin-n">2</text>`);
    s.push(`<text x="238" y="${PB_Y[1] + 4}" class="pin">PB1</text><text x="214" y="${PB_Y[1] - 4}" class="pin-n">3</text>`);
    s.push(`<text x="238" y="${PB_Y[2] + 4}" class="pin">PB2</text><text x="214" y="${PB_Y[2] - 4}" class="pin-n">5</text>`);
    s.push(`<text x="238" y="${PB_Y[3] + 4}" class="pin">PB3</text><text x="238" y="${PB_Y[3] + 18}" class="pin-s">RESET</text><text x="214" y="${PB_Y[3] - 4}" class="pin-n">4</text>`);
    for (let k = 0; k < 4; k++) s.push(`<text x="226" y="${PB_Y[k] + 15}" class="badge" text-anchor="end" data-badge="pb${k}"></text>`);
    s.push(poly([[230, PB_Y[0]], [180, PB_Y[0]], [180, TY]], 'pb0'), line(180, TY, 420, TY, 'pb0'), resH(420, TY, 'R1 10Ω'),
      line(454, TY, BUS1 - 14, TY, 'pb0'));
    s.push(poly([[230, PB_Y[1]], [196, PB_Y[1]], [196, 566]], 'pb1'), line(196, 566, 640, 566, 'pb1'), resH(570, 566, 'R2 10Ω'),
      poly([[604, 566], [650, 566], [650, TY], [BUS2 - 14, TY]], 'pb1'));
    // PB2: fotodioda + RD 1K do VCC
    s.push(line(230, PB_Y[2], 100, PB_Y[2], 'pb2'), dot(100, PB_Y[2], 'pb2'));
    s.push(line(100, 24, 100, 150, null, 'class="w-vcc"'), resV(100, 150, 'RD 1K'), line(100, 184, 100, PB_Y[2], 'pb2'));
    s.push(line(100, PB_Y[2], 100, 450, 'pb2'));
    s.push(`<g class="photo" data-photo="1"><title>Fotodioda: oświetlona przez nadajnik przewodzi i ściąga PB2 do masy (stan niski = wykrycie znacznika).</title>
      <polygon points="88,450 112,450 100,472" class="pd-body"/><line x1="88" y1="472" x2="112" y2="472" class="led-bar"/>
      <path d="M70 446 l12 8 m-4 -1 l4 1 l-1 -4 M66 458 l12 8 m-4 -1 l4 1 l-1 -4" class="pd-arrow"/></g>`);
    s.push(line(100, 472, 100, 598, null, 'class="w-gnd"'), `<text x="116" y="462" class="lbl">Foto</text>`);
    // PB3: RESET z podciąganiem 1K
    s.push(line(230, PB_Y[3], 150, PB_Y[3], 'pb3'), dot(150, PB_Y[3], 'pb3'));
    s.push(line(150, 24, 150, 330, null, 'class="w-vcc"'), resV(150, 330, '1K'), line(150, 364, 150, PB_Y[3], 'pb3'));
    s.push(line(150, PB_Y[3], 150, 470, 'pb3'), `<g><title>Przycisk RESET</title><line x1="150" y1="470" x2="150" y2="478" class="w-static"/>
      <line x1="140" y1="490" x2="160" y2="478" class="w-static"/><line x1="150" y1="492" x2="150" y2="598" class="w-gnd"/></g>`);
    s.push(`<text x="120" y="512" class="lbl-s">RESET</text>`);
    s.push(`<text x="26" y="${PB_Y[2] - 8}" class="lbl-s" data-photo-txt="1"></text>`);
    s.push('</svg>');
    root.innerHTML = `<div class="schem-wrap">${s.join('\n')}</div>
      <div class="schem-legend"><span class="lg hi"></span>stan wysoki <span class="lg lo"></span>stan niski
      <span class="lg pu"></span>pull-up <span class="lg fl"></span>pływający (wejście bez podciągania)
      <span class="badge-help">WY = wyjście, WE = wejście, PU = wejście z pull-upem, OC = wyjście timera</span></div>`;
    this.nets = {};
    for (const el of root.querySelectorAll('[data-net]')) (this.nets[el.dataset.net] ||= []).push(el);
    this.netFills = {};
    for (const el of root.querySelectorAll('[data-net-fill]')) (this.netFills[el.dataset.netFill] ||= []).push(el);
    this.badges = {};
    for (const el of root.querySelectorAll('[data-badge]')) this.badges[el.dataset.badge] = el;
    this.leds = [...root.querySelectorAll('[data-led]')].sort((a, b) => a.dataset.led - b.dataset.led);
    this.fets = [...root.querySelectorAll('[data-fet]')];
    this.photoTxt = root.querySelector('[data-photo-txt]');
    this.last = {};
  }

  setNet(net, state) {
    if (this.last[net] === state) return;
    this.last[net] = state;
    for (const el of this.nets[net] || []) el.setAttribute('class', 'w-' + state);
    for (const el of this.netFills[net] || []) el.setAttribute('class', 'd-' + state);
  }

  // tryb pinu: { state: 'hi'|'lo'|'pu'|'fl', badge }
  pinState(cpu, p, b) {
    const D = cpu.data;
    const lvl = (cpu.lvl[p] >> b) & 1;
    if (!cpu.powered) return { state: (cpu.extMask[p] >> b) & 1 ? (lvl ? 'hi' : 'lo') : 'fl', badge: '' };
    const ddr = (D[p ? 0x37 : 0x3A] >> b) & 1;
    const port = (D[p ? 0x38 : 0x3B] >> b) & 1;
    const oc = (cpu.ocMask[p] >> b) & 1;
    const pud = D[0x55] & 0x40;
    if (p === 1 && b === 3 && !cpu.rstdisbl()) return { state: lvl ? 'hi' : 'lo', badge: 'RESET' };
    if (ddr) return { state: lvl ? 'hi' : 'lo', badge: (oc ? 'OC ' : 'WY ') + lvl };
    if ((cpu.extMask[p] >> b) & 1) return { state: lvl ? 'hi' : 'lo', badge: 'WE ' + lvl };
    if (port && !pud) return { state: 'pu', badge: 'PU ' + lvl };
    return { state: 'fl', badge: 'WE ' + lvl };
  }

  update(cpu, stand) {
    for (let i = 0; i < 8; i++) {
      const st = this.pinState(cpu, 0, i);
      this.setNet('pa' + i, st.state);
      this.badges['pa' + i].textContent = st.badge;
    }
    for (let k = 0; k < 4; k++) {
      const st = this.pinState(cpu, 1, k);
      this.setNet('pb' + k, k < 2 && st.state === 'fl' ? ((cpu.lvl[1] >> k) & 1 ? 'pu' : 'fl') : st.state);
      this.badges['pb' + k].textContent = st.badge;
    }
    const t1 = cpu.lvl[1] & 1, t2 = (cpu.lvl[1] >> 1) & 1;
    this.setNet('bus1', t1 ? 'lo' : 'fl');
    this.setNet('bus2', t2 ? 'lo' : 'fl');
    for (let i = 0; i < 8; i++) {
      this.setNet('k1' + i, stand.led[i] > 0 ? 'lo' : 'fl');
      this.setNet('k2' + i, stand.led[8 + i] > 0 ? 'lo' : 'fl');
    }
    this.fets[0].classList.toggle('on', !!t1);
    this.fets[1].classList.toggle('on', !!t2);
    for (let i = 0; i < 16; i++) {
      const b = stand.led[i];
      const c = stand.cfg.colors[i < 8 ? 0 : 1];
      const el = this.leds[i];
      const key = b.toFixed(2);
      if (el._b === key) continue;
      el._b = key;
      el.style.setProperty('--led', `rgb(${c[0]},${c[1]},${c[2]})`);
      el.style.setProperty('--on', b > 0 ? Math.max(0.35, Math.min(1, b * 1.5)) : 0);
      el.classList.toggle('on', b > 0);
    }
    const det = !(cpu.lvl[1] & 4);
    this.photoTxt.textContent = det ? 'wykrycie (0)' : 'brak znacznika (1)';
    this.photoTxt.setAttribute('class', det ? 'lbl-s hot' : 'lbl-s');
  }
}
