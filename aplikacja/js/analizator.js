// analizator.js - analizator stanów logicznych pinów ATtiny24

import { tr } from './i18n.js';

const N = 1 << 18;
const CHANNELS = [
  ['PA0', 0], ['PA1', 1], ['PA2', 2], ['PA3', 3], ['PA4', 4], ['PA5', 5], ['PA6', 6], ['PA7', 7],
  ['PB0 → T1', 8], ['PB1 → T2', 9], ['PB2 foto/INT0', 10], ['PB3 RESET', 11], ['w przerwaniu', 12],
];
const COLORS = { pa: '#5fd38d', pb: '#5ab0ff', isr: '#ffb347' };

export function fmtTime(s) {
  const a = Math.abs(s);
  if (a === 0) return '0';
  if (a < 1e-6) return (s * 1e9).toFixed(0) + ' ns';
  if (a < 1e-3) return +(s * 1e6).toPrecision(4) + ' µs';
  if (a < 1) return +(s * 1e3).toPrecision(4) + ' ms';
  return +s.toPrecision(4) + ' s';
}

export class Analyzer {
  constructor(root) {
    this.root = root;
    this.t = new Float64Array(N);
    this.v = new Uint16Array(N);
    this.head = 0;
    this.count = 0;
    this.lastV = -1;
    this.isr = 0;
    this.live = true;
    this.span = 0.02;
    this.tEnd = 0;
    this.now = 0;
    this.measure = null;
    this.hover = null;
    root.innerHTML = `<div class="an-bar">
        <button class="btn sm" data-a="live" title="Podążaj za bieżącym czasem">● Na żywo</button>
        <button class="btn sm" data-a="in" title="Przybliż (kółko myszy)">＋</button>
        <button class="btn sm" data-a="out" title="Oddal">－</button>
        <span class="an-span"></span>
        <span class="an-meas"></span>
        <span class="spacer"></span>
        <button class="btn sm" data-a="png" title="Zapisz widoczne przebiegi do pliku PNG">PNG</button>
        <button class="btn sm" data-a="csv" title="Zapisz zmiany stanów z widocznego okna do pliku CSV (Excel)">CSV</button>
        <button class="btn sm" data-a="clear">Wyczyść</button>
      </div>
      <div class="an-canvas"><canvas></canvas></div>
      <div class="an-help">Kółko myszy: zoom · Shift + kółko lub przeciąganie prawym przyciskiem: przesuwanie · przeciągnięcie lewym: pomiar czasu</div>`;
    this.canvas = root.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.spanEl = root.querySelector('.an-span');
    this.measEl = root.querySelector('.an-meas');
    this.liveBtn = root.querySelector('[data-a="live"]');
    root.querySelector('.an-bar').addEventListener('click', (e) => {
      const a = e.target.dataset.a;
      if (a === 'live') this.setLive(!this.live);
      if (a === 'in') this.zoom(0.5);
      if (a === 'out') this.zoom(2);
      if (a === 'clear') this.clear();
      if ((a === 'png' || a === 'csv') && this.onExport) this.onExport(a);
      this.draw();
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        this.setLive(false);
        this.tEnd += (e.deltaY || e.deltaX) / 600 * this.span;
      } else {
        const t = this.timeAt(e.offsetX);
        this.zoom(e.deltaY > 0 ? 1.25 : 0.8, t);
      }
      this.draw();
    }, { passive: false });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 2) {
        this.setLive(false);
        this.pan = { x: e.offsetX, t: this.tEnd };
      } else if (e.offsetX > this.labelW) {
        this.measure = { a: this.timeAt(e.offsetX), b: null };
      }
    });
    window.addEventListener('mouseup', () => { this.pan = null; if (this.measure && this.measure.b === null) this.measure = null; this.dragging = false; });
    this.canvas.addEventListener('mousemove', (e) => {
      this.hover = e.offsetX > this.labelW ? e.offsetX : null;
      if (this.pan) {
        const w = this.canvas.clientWidth - this.labelW;
        this.tEnd = this.pan.t - (e.offsetX - this.pan.x) / w * this.span;
      } else if (this.measure && (e.buttons & 1)) {
        this.measure.b = this.timeAt(e.offsetX);
      }
      this.draw();
    });
    this.canvas.addEventListener('mouseleave', () => { this.hover = null; this.draw(); });
    new ResizeObserver(() => this.draw()).observe(this.canvas.parentElement);
  }

  get labelW() { return 118; }

  // kolory tła i opisów z bieżącego motywu (zmienne --an-* w style.css)
  themeColors() {
    if (!this.colors) {
      const cs = getComputedStyle(document.documentElement);
      const v = (n) => cs.getPropertyValue('--an-' + n).trim();
      this.colors = { bg: v('bg'), bg2: v('bg2'), grid: v('grid'), text: v('text'), label: v('label'), cursor: v('cursor'), cursorLine: v('cursor-line') };
    }
    return this.colors;
  }

  setLive(on) {
    this.live = on;
    this.liveBtn.classList.toggle('on', on);
  }

  zoom(f, at) {
    const span = Math.min(10, Math.max(2e-6, this.span * f));
    if (at !== undefined && !this.live) {
      const frac = (this.tEnd - at) / this.span;
      this.tEnd = at + frac * span;
    }
    this.span = span;
  }

  clear() {
    this.head = 0;
    this.count = 0;
    this.lastV = -1;
    this.measure = null;
  }

  // zapis stanu pinów (wywoływane przy każdej zmianie)
  record(cpu) {
    const v = cpu.lvl[0] | (cpu.lvl[1] << 8) | (this.isr ? 0x1000 : 0);
    if (v === this.lastV) return;
    this.lastV = v;
    this.t[this.head] = cpu.time();
    this.v[this.head] = v;
    this.head = (this.head + 1) & (N - 1);
    if (this.count < N) this.count++;
  }

  setIsr(cpu, inIsr) {
    this.isr = inIsr ? 1 : 0;
    this.record(cpu);
  }

  idx(k) {
    // k-te zdarzenie od najstarszego
    return (this.head - this.count + k + N) & (N - 1);
  }

  // indeks ostatniego zdarzenia o czasie <= t
  find(t) {
    let lo = 0, hi = this.count - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.t[this.idx(mid)] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  timeAt(x) {
    const w = this.canvas.clientWidth - this.labelW;
    return this.tEnd - this.span + (x - this.labelW) / w * this.span;
  }

  draw(now) {
    if (now !== undefined) this.now = now;
    if (this.live) this.tEnd = this.now;
    const box = this.canvas.parentElement.getBoundingClientRect();
    if (box.width < 10 || box.height < 10) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(box.width), H = Math.round(box.height);
    if (this.canvas.width !== W * dpr || this.canvas.height !== H * dpr) {
      this.canvas.width = W * dpr; this.canvas.height = H * dpr;
      this.canvas.style.width = W + 'px'; this.canvas.style.height = H + 'px';
    }
    const ctx = this.ctx;
    const K = this.themeColors();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = K.bg;
    ctx.fillRect(0, 0, W, H);
    const LW = this.labelW, top = 22;
    const rowH = Math.max(16, Math.min(30, (H - top - 4) / CHANNELS.length));
    const t0 = this.tEnd - this.span, t1 = this.tEnd;
    const sx = (W - LW) / this.span;
    const X = (t) => LW + (t - t0) * sx;
    // siatka czasu
    const step = niceStep(this.span / 8);
    ctx.font = '11px Consolas, monospace';
    ctx.textAlign = 'center';
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
      const x = X(t);
      ctx.fillStyle = K.grid;
      ctx.fillRect(Math.round(x), top, 1, H - top);
      ctx.fillStyle = K.text;
      ctx.fillText(fmtTime(t), x, 14);
    }
    // kanały
    const first = Math.max(0, this.find(t0));
    const last = this.find(t1);
    for (let c = 0; c < CHANNELS.length; c++) {
      const [name, bit] = CHANNELS[c];
      const y = top + c * rowH;
      const hiY = y + 4, loY = y + rowH - 4;
      ctx.fillStyle = c % 2 ? K.bg2 : K.bg;
      ctx.fillRect(0, y, W, rowH);
      ctx.fillStyle = K.label;
      ctx.textAlign = 'left';
      ctx.fillText(tr(name), 8, y + rowH / 2 + 4);
      const col = bit < 8 ? COLORS.pa : bit < 12 ? COLORS.pb : COLORS.isr;
      ctx.strokeStyle = col;
      ctx.fillStyle = col + '55';
      ctx.lineWidth = 1.2;
      if (this.count === 0 || last < 0) continue;
      ctx.beginPath();
      let k = first;
      let val = (this.v[this.idx(k)] >> bit) & 1;
      let x = LW;
      ctx.moveTo(x, val ? hiY : loY);
      let lastPx = -1, dense = 0;
      for (k = first + 1; k <= last; k++) {
        const vv = (this.v[this.idx(k)] >> bit) & 1;
        if (vv === val) continue;
        const nx = X(this.t[this.idx(k)]);
        const px = Math.floor(nx);
        if (px === lastPx) {
          dense++;
          if (dense === 2) ctx.fillRect(px, hiY, 1, loY - hiY);
        } else {
          dense = 0;
        }
        lastPx = px;
        ctx.lineTo(nx, val ? hiY : loY);
        ctx.lineTo(nx, vv ? hiY : loY);
        val = vv;
      }
      const endX = Math.min(W, X(Math.min(t1, this.now)));
      ctx.lineTo(endX, val ? hiY : loY);
      ctx.stroke();
    }
    ctx.fillStyle = K.grid;
    ctx.fillRect(LW - 1, top, 1, H - top);
    // pomiar
    if (this.measure && this.measure.b !== null) {
      const xa = X(this.measure.a), xb = X(this.measure.b);
      ctx.fillStyle = 'rgba(62,199,255,0.12)';
      ctx.fillRect(Math.min(xa, xb), top, Math.abs(xb - xa), H - top);
      ctx.fillStyle = '#3ec7ff';
      ctx.fillRect(xa, top, 1, H - top);
      ctx.fillRect(xb, top, 1, H - top);
      const dt = Math.abs(this.measure.b - this.measure.a);
      this.measEl.textContent = `Δt = ${fmtTime(dt)}   f = ${dt > 0 ? fmtFreq(1 / dt) : '-'}`;
    } else {
      this.measEl.textContent = '';
    }
    // kursor
    if (this.hover !== null) {
      ctx.fillStyle = K.cursorLine;
      ctx.fillRect(this.hover, top, 1, H - top);
      ctx.fillStyle = K.cursor;
      ctx.textAlign = 'left';
      ctx.fillText(fmtTime(this.timeAt(this.hover)), this.hover + 4, top + 10);
    }
    this.spanEl.textContent = `okno: ${fmtTime(this.span)}`;
  }
}

// zmiany stanów pinów w oknie [t0, t1] jako CSV; pl = true: średnik i przecinek dziesiętny (Excel po polsku)
Analyzer.prototype.toCsv = function (pl) {
  const sep = pl ? ';' : ',';
  const num = (t) => (pl ? t.toFixed(9).replace('.', ',') : t.toFixed(9));
  const t0 = this.tEnd - this.span, t1 = this.tEnd;
  const rows = [['t [s]', ...CHANNELS.map(([n]) => (n === 'w przerwaniu' ? (pl ? 'w przerwaniu' : 'in interrupt') : n))].join(sep)];
  const row = (t, v) => rows.push([num(t), ...CHANNELS.map(([, bit]) => (v >> bit) & 1)].join(sep));
  const first = this.find(t0);
  if (first >= 0) row(t0, this.v[this.idx(first)]);
  for (let k = Math.max(0, first + 1); k < this.count; k++) {
    const t = this.t[this.idx(k)];
    if (t > t1) break;
    row(t, this.v[this.idx(k)]);
  }
  return rows.join('\r\n') + '\r\n';
};

function niceStep(x) {
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const m = x / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

function fmtFreq(f) {
  if (f >= 1e6) return +(f / 1e6).toPrecision(4) + ' MHz';
  if (f >= 1e3) return +(f / 1e3).toPrecision(4) + ' kHz';
  return +f.toPrecision(4) + ' Hz';
}
