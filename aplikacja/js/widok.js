// widok.js - rysowanie wirującego talerza ze stanowiska (widok z przodu)

import { NB } from './stanowisko.js';

const TAU = Math.PI * 2;
const R_IN = 0.30, R_STEP = 0.088;      // promień pierwszej diody i odstęp diod [część promienia talerza]

export class StandView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.light = document.createElement('canvas');
    this.lctx = this.light.getContext('2d', { willReadFrequently: false });
    this.showBoard = true;
    this.strobe = false;
    this.mapKey = '';
    this.glow = null;
    this.gctx = null;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
  }

  resize() {
    const box = this.canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(50, Math.round(box.width * dpr));
    this.h = Math.max(50, Math.round(box.height * dpr));
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.canvas.style.width = box.width + 'px';
    this.canvas.style.height = box.height + 'px';
    this.dpr = dpr;
    this.R = Math.min(this.w, this.h) * 0.42;
    this.cx = this.w / 2;
    this.cy = this.h / 2 + this.R * 0.02;
    this.mapKey = '';
  }

  ringRadius(i) {
    return this.R * (R_IN + i * R_STEP);
  }

  // mapa pikseli warstwy światła: piksel -> (pierścień, przedział kąta, waga)
  buildMap(pa0Inner) {
    const sc = this.R > 260 ? 0.5 : 1;   // przy dużym talerzu światło liczone w połowie rozdzielczości
    const Rl = this.R * sc;
    this.lscale = sc;
    const S = Math.ceil(Rl * 2 * 1.02);
    this.light.width = S;
    this.light.height = S;
    this.img = this.lctx.createImageData(S, S);
    const half = S / 2;
    const ledR = Rl * R_STEP * 0.42;
    const pix = [], ring = [], bin = [], wt = [];
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = x + 0.5 - half, dy = y + 0.5 - half;
        const d = Math.hypot(dx, dy) / Rl;
        const ri = Math.round((d - R_IN) / R_STEP);
        if (ri < 0 || ri > 7) continue;
        const off = Math.abs(d * Rl - Rl * (R_IN + ri * R_STEP)) / ledR;
        if (off >= 1) continue;
        const fi = ((Math.atan2(dx, -dy) / TAU) + 1) % 1;
        pix.push((y * S + x) * 4);
        ring.push(pa0Inner ? ri : 7 - ri);
        bin.push(Math.floor(fi * NB) % NB);
        wt.push(Math.pow(1 - off * off, 0.6));
      }
    }
    this.mPix = Int32Array.from(pix);
    this.mPa = Uint8Array.from(ring);
    this.mBin = Uint16Array.from(bin);
    this.mW = Float32Array.from(wt);
    this.lightSize = S;
    this.mapKey = `${this.w}x${this.h}:${pa0Inner}`;
  }

  draw(stand, cpu) {
    const cfg = stand.cfg;
    const key = `${this.w}x${this.h}:${cfg.pa0Inner}`;
    if (key !== this.mapKey) this.buildMap(cfg.pa0Inner);
    const ctx = this.ctx, R = this.R, cx = this.cx, cy = this.cy;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    // tło
    const bg = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, Math.max(this.w, this.h) * 0.75);
    bg.addColorStop(0, '#171c26');
    bg.addColorStop(1, '#090b10');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.w, this.h);

    this.drawBase(stand);
    this.drawDisc(stand);
    if (this.showBoard) this.drawBoard(stand, cpu);
    this.drawLight(stand);
    if (this.showBoard) this.drawLedBodies(stand);
    this.drawSensor(stand);
  }

  drawBase(stand) {
    const ctx = this.ctx, R = this.R, cx = this.cx, cy = this.cy;
    // obudowa / podstawa
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.1, 0, TAU);
    const g = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.1);
    g.addColorStop(0, '#1d232f');
    g.addColorStop(1, '#141922');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(1, R * 0.006);
    ctx.strokeStyle = '#2b3342';
    ctx.stroke();
    // śruby
    ctx.fillStyle = '#323a49';
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * TAU + 0.26;
      ctx.beginPath();
      ctx.arc(cx + Math.sin(a) * R * 1.05, cy - Math.cos(a) * R * 1.05, R * 0.012, 0, TAU);
      ctx.fill();
    }
  }

  drawDisc(stand) {
    const ctx = this.ctx, R = this.R, cx = this.cx, cy = this.cy;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fillStyle = 'rgba(14,18,26,0.96)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,140,170,0.18)';
    ctx.lineWidth = Math.max(1, R * 0.004);
    ctx.stroke();
    // delikatne pierścienie torów diod
    ctx.strokeStyle = 'rgba(120,140,170,0.05)';
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, this.ringRadius(i), 0, TAU);
      ctx.stroke();
    }
  }

  armAlpha(stand) {
    if (this.strobe) return 1;
    const rps = stand.rpsNow;
    return Math.max(0.07, Math.min(1, 1.15 - rps / 4));
  }

  armPoint(turns, r) {
    const a = turns * TAU;
    return [this.cx + Math.sin(a) * r, this.cy - Math.cos(a) * r];
  }

  drawBoard(stand, cpu) {
    const ctx = this.ctx, R = this.R;
    const alpha = this.armAlpha(stand);
    const ang = stand.angle;
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.globalAlpha = alpha;
    // płytka drukowana: dwa ramiona
    for (const off of [0, stand.cfg.redArmOffset]) {
      ctx.save();
      ctx.rotate((ang + off) * TAU);
      ctx.fillStyle = '#0f3b2c';
      ctx.strokeStyle = '#1f6b4f';
      ctx.lineWidth = Math.max(1, R * 0.004);
      const w = R * 0.075;
      ctx.beginPath();
      ctx.roundRect(-w / 2, -R * 0.96, w, R * 0.96, w * 0.3);
      ctx.fill();
      ctx.stroke();
      // ścieżki
      ctx.strokeStyle = 'rgba(200,170,90,0.35)';
      ctx.lineWidth = Math.max(1, R * 0.003);
      ctx.beginPath();
      ctx.moveTo(-w * 0.25, -R * 0.2); ctx.lineTo(-w * 0.25, -R * 0.93);
      ctx.moveTo(w * 0.25, -R * 0.2); ctx.lineTo(w * 0.25, -R * 0.93);
      ctx.stroke();
      // rezystory
      ctx.fillStyle = '#c9b48a';
      for (let i = 0; i < 8; i++) {
        const r = this.ringRadius(i) - R * R_STEP * 0.5;
        ctx.fillRect(w * 0.12, -r - R * 0.012, w * 0.26, R * 0.024);
      }
      ctx.restore();
    }
    // środek: ATtiny24 i oś silnika
    ctx.rotate(ang * TAU);
    ctx.fillStyle = '#0f3b2c';
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.17, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#1f6b4f';
    ctx.stroke();
    ctx.fillStyle = '#16181d';
    ctx.fillRect(-R * 0.07, -R * 0.1, R * 0.14, R * 0.2);
    ctx.fillStyle = '#c0c6d0';
    for (let k = 0; k < 7; k++) {
      ctx.fillRect(-R * 0.085, -R * 0.09 + k * R * 0.029, R * 0.015, R * 0.012);
      ctx.fillRect(R * 0.07, -R * 0.09 + k * R * 0.029, R * 0.015, R * 0.012);
    }
    if (alpha > 0.5 && R > 120) {
      ctx.fillStyle = '#8b93a1';
      ctx.font = `${Math.round(R * 0.026)}px Consolas, monospace`;
      ctx.textAlign = 'center';
      ctx.save();
      ctx.rotate(-Math.PI / 2);
      ctx.fillText('ATtiny24', 0, R * 0.01);
      ctx.restore();
    }
    // fotodioda na płytce
    const pr = R * 0.97;
    const pa = stand.cfg.photoOffset * TAU;
    ctx.fillStyle = stand.photoLevel ? '#5a6474' : '#ffe08a';
    ctx.beginPath();
    ctx.arc(Math.sin(pa) * pr, -Math.cos(pa) * pr, R * 0.018, 0, TAU);
    ctx.fill();
    // oś
    ctx.fillStyle = '#2a2f3a';
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.03, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawLedBodies(stand) {
    const ctx = this.ctx;
    const alpha = this.armAlpha(stand);
    const ledR = this.R * R_STEP * 0.3;
    for (let arm = 0; arm < 2; arm++) {
      const off = arm === 0 ? stand.cfg.redArmOffset : 0;
      const col = stand.cfg.colors[arm];
      for (let pa = 0; pa < 8; pa++) {
        const ring = stand.cfg.pa0Inner ? pa : 7 - pa;
        const [x, y] = this.armPoint(stand.angle + off, this.ringRadius(ring));
        const b = stand.led[arm * 8 + pa];
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(x, y, ledR, 0, TAU);
        ctx.fillStyle = `rgb(${col[0] * 0.25 + 30},${col[1] * 0.25 + 30},${col[2] * 0.25 + 30})`;
        ctx.fill();
        if (b > 0) {
          ctx.globalAlpha = alpha * Math.min(1, 0.25 + b);
          ctx.globalCompositeOperation = 'lighter';
          const g = ctx.createRadialGradient(x, y, 0, x, y, ledR * 3.2);
          g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${Math.min(1, b * 1.2)})`);
          g.addColorStop(0.35, `rgba(${col[0]},${col[1]},${col[2]},${0.35 * b})`);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, ledR * 3.2, 0, TAU);
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  drawLight(stand) {
    const E = stand.energy, cfg = stand.cfg;
    const data = this.img.data;
    data.fill(0);
    const norm = NB / stand.exposure;
    const c1 = cfg.colors[0], c2 = cfg.colors[1];
    const P = this.mPix, A = this.mPa, B = this.mBin, W = this.mW;
    for (let i = 0; i < P.length; i++) {
      const bin = B[i], pa = A[i];
      let r = E[pa * NB + bin] * norm, g = E[(8 + pa) * NB + bin] * norm;
      if (r <= 0.002 && g <= 0.002) continue;
      r = 1 - Math.exp(-1.8 * r);
      g = 1 - Math.exp(-1.8 * g);
      const w = W[i];
      const R_ = (c1[0] * r + c2[0] * g) * w, G_ = (c1[1] * r + c2[1] * g) * w, B_ = (c1[2] * r + c2[2] * g) * w;
      const o = P[i];
      const m = Math.max(R_, G_, B_);
      data[o] = Math.min(255, R_ * 1.1);
      data[o + 1] = Math.min(255, G_ * 1.1);
      data[o + 2] = Math.min(255, B_ * 1.1);
      data[o + 3] = Math.min(255, m * 1.4);
    }
    this.lctx.putImageData(this.img, 0, 0);
    const ctx = this.ctx, Sd = this.lightSize / this.lscale;
    const x = this.cx - Sd / 2, y = this.cy - Sd / 2;
    // poświata: obraz pomniejszony 4x i powiększony z wygładzaniem (taniej niż filtr blur)
    const gs = Math.max(8, Math.round(this.lightSize / 4));
    if (!this.glow || this.glow.width !== gs) {
      this.glow = document.createElement('canvas');
      this.glow.width = gs; this.glow.height = gs;
      this.gctx = this.glow.getContext('2d');
    }
    this.gctx.clearRect(0, 0, gs, gs);
    this.gctx.imageSmoothingEnabled = true;
    this.gctx.drawImage(this.light, 0, 0, gs, gs);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.85;
    ctx.drawImage(this.glow, x, y, Sd, Sd);
    ctx.globalAlpha = 1;
    ctx.drawImage(this.light, x, y, Sd, Sd);
    ctx.restore();
  }

  drawSensor(stand) {
    const ctx = this.ctx, R = this.R;
    const a = stand.cfg.sensorAngle * TAU;
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(a);
    // nadajnik światła (nieruchomy) nad krawędzią talerza
    ctx.fillStyle = '#2a3140';
    ctx.strokeStyle = '#46506a';
    ctx.lineWidth = Math.max(1, R * 0.004);
    ctx.beginPath();
    ctx.roundRect(-R * 0.045, -R * 1.13, R * 0.09, R * 0.09, R * 0.012);
    ctx.fill();
    ctx.stroke();
    const blocked = stand.cfg.sensorBlocked;
    ctx.fillStyle = blocked ? '#444' : '#ff4f4f';
    ctx.beginPath();
    ctx.arc(0, -R * 1.06, R * 0.012, 0, TAU);
    ctx.fill();
    if (!blocked) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(0, -R * 1.05, 0, -R * 0.92);
      g.addColorStop(0, 'rgba(255,90,90,0.35)');
      g.addColorStop(1, 'rgba(255,90,90,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-R * 0.01, -R * 1.05);
      ctx.lineTo(R * 0.01, -R * 1.05);
      ctx.lineTo(R * 0.03, -R * 0.92);
      ctx.lineTo(-R * 0.03, -R * 0.92);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}
