// stanowisko.js - model fizyczny stanowiska LTM
//
// Elementy (wg schematu):
//   PA0..PA7 -> anody diod; katody przez 1K do linii Led1 (T1, bramka PB0) i Led2 (T2, bramka PB1),
//   BS170 bez rezystora do masy na bramce - bramka "pamięta" ostatni stan, gdy pin jest wejściem,
//   PB2 <- fotodioda z podciąganiem RD 1K do VCC (wykrycie znacznika = stan niski),
//   PB3 = RESET z podciąganiem 1K.
// Gałąź Led1 i Led2 leżą na przeciwnych ramionach wirującej płytki, PA0 przy środku.
//
// Obraz POV powstaje przez całkowanie: każda dioda dodaje swoje światło do przedziałów kąta,
// które mija, gdy świeci. Wartości wygasają wykładniczo ze stałą czasową "bezwładności oka".

export const NB = 1024;          // przedziałów kątowych na obrót
const SLICE = 0.0005;            // krok symulacji silnika i fotodiody [s]
const PULLUP_GLOW = 0.04;        // jasność diody zasilanej przez wewnętrzny pull-up (~0,1 mA)

export class Stand {
  constructor(cpu) {
    this.cpu = cpu;
    this.cfg = {
      colors: [[255, 48, 36], [52, 255, 96]],   // Led1 (T1) czerwone, Led2 (T2) zielone
      redArmOffset: 0.5,     // położenie ramienia Led1 względem Led2 [obroty]
      pa0Inner: true,        // PA0 przy środku płytki
      direction: 1,          // 1 = zgodnie z ruchem wskazówek zegara
      sensorAngle: 0,        // położenie nadajnika światła [obroty], 0 = góra
      sensorWidth: 4 / 360,  // szerokość okna detekcji [obroty]
      photoOffset: 0,        // położenie fotodiody na płytce względem ramienia Led2 [obroty]
      bounce: false,         // drgania zbocza sygnału z fotodiody
      sensorBlocked: false,  // fotodioda zasłonięta / odłączona
    };
    this.motor = { on: false, target: 15, rps: 0, tau: 0.7, jitter: 0, noise: 0 };
    this.rpsNow = 0;
    this.angle = 0;          // położenie ramienia Led2 [obroty], rośnie w kierunku obrotu
    this.exposure = 0.08;    // bezwładność oka [s]
    this.energy = new Float32Array(16 * NB);
    this.led = new Float32Array(16);           // bieżąca jasność diod: [Led1 PA0..PA7, Led2 PA0..PA7]
    this.ledT = 0;
    this.sliceT0 = 0; this.sliceA0 = 0; this.omega = 0;
    this.photoLevel = 1;     // stan PB2 wynikający z fotodiody
    this.photoDetect = false;
    this.ispActive = false;
    this.ledKey = -1;
    this.onLedChange = null;

    cpu.extMask = [0, 0b1100];
    cpu.extLevel = [0, 0b1100];
    cpu.keepMask = [0, 0b0011];
    cpu.hooks.pins = () => this.onPins();
  }

  angleAt(t) {
    return this.sliceA0 + this.omega * (t - this.sliceT0);
  }

  // ---------------------------------------------------------------- diody

  onPins() {
    const cpu = this.cpu;
    const ddrA = cpu.powered ? cpu.data[0x3A] : 0;
    const lvlA = cpu.lvl[0], extA = cpu.extMask[0];
    const strong = (ddrA | extA) & lvlA & 0xFF;
    const weak = ~ddrA & ~extA & lvlA & 0xFF;
    const key = strong | (weak << 8) | ((cpu.lvl[1] & 3) << 16);
    if (key === this.ledKey) return;
    this.ledKey = key;
    this.flush(cpu.time());
    const L = this.led;
    for (let arm = 0; arm < 2; arm++) {
      const on = (cpu.lvl[1] >> arm) & 1;
      for (let i = 0; i < 8; i++) {
        L[arm * 8 + i] = !on ? 0 : (strong >> i) & 1 ? 1 : (weak >> i) & 1 ? PULLUP_GLOW : 0;
      }
    }
    if (this.onLedChange) this.onLedChange();
  }

  // dodanie światła z przedziału czasu [ledT, t] do akumulatora POV
  flush(t) {
    const t0 = this.ledT;
    if (t <= t0) { this.ledT = t; return; }
    const a0 = this.angleAt(t0), a1 = this.angleAt(t), dt = t - t0;
    for (let L = 0; L < 16; L++) {
      const b = this.led[L];
      if (!b) continue;
      const off = L < 8 ? this.cfg.redArmOffset : 0;
      this.accumulate(L, a0 + off, a1 + off, dt * b);
    }
    this.ledT = t;
  }

  accumulate(L, s, e, energy) {
    const E = this.energy, base = L * NB;
    let x0 = s * NB, x1 = e * NB;
    if (x1 < x0) { const tmp = x0; x0 = x1; x1 = tmp; }
    const span = x1 - x0;
    if (span < 1e-6) {
      const b = ((Math.floor(x0) % NB) + NB) % NB;
      E[base + b] += energy;
      return;
    }
    const rate = energy / span;
    if (span >= NB) {
      const k = Math.floor(span / NB);
      const add = k * rate;
      for (let i = 0; i < NB; i++) E[base + i] += add;
      x0 += k * NB;
    }
    let b = Math.floor(x0);
    while (x0 < x1) {
      const nb = Math.min(x1, b + 1);
      E[base + (((b % NB) + NB) % NB)] += (nb - x0) * rate;
      x0 = nb;
      b++;
    }
  }

  decay(dtSim) {
    if (dtSim <= 0) return;
    const f = Math.exp(-dtSim / this.exposure);
    const E = this.energy;
    for (let i = 0; i < E.length; i++) E[i] *= f;
  }

  clearPov() {
    this.energy.fill(0);
  }

  // ---------------------------------------------------------------- silnik i fotodioda

  updateMotor(dt) {
    const m = this.motor;
    const target = m.on ? m.target : 0;
    m.rps += (target - m.rps) * (1 - Math.exp(-dt / m.tau));
    if (Math.abs(m.rps) < 1e-4 && !m.on) m.rps = 0;
    // nierównomierność obrotów: wolnozmienny szum
    if (m.jitter > 0) {
      const g = (Math.random() + Math.random() + Math.random() - 1.5) * 2;
      m.noise += g * Math.sqrt(dt) * 3 - m.noise * dt / 0.25;
    } else {
      m.noise = 0;
    }
    this.rpsNow = Math.max(0, m.rps * (1 + m.jitter * m.noise));
  }

  photoPhase(a) {
    return a + this.cfg.photoOffset - this.cfg.sensorAngle;
  }

  isDetect(a) {
    if (this.cfg.sensorBlocked) return false;
    const p = this.photoPhase(a);
    return Math.abs(p - Math.round(p)) < this.cfg.sensorWidth / 2;
  }

  setPhoto(level) {
    this.photoLevel = level;
    this.cpu.setExt(1, 4, level ? 4 : 0);
  }

  // zaplanowanie zboczy z fotodiody w przedziale [t0, t1] przy stałej prędkości kątowej
  schedulePhoto(t0, t1) {
    const cpu = this.cpu, a0 = this.angleAt(t0);
    const det0 = this.isDetect(a0);
    this.photoDetect = det0;
    const lvl0 = det0 ? 0 : 1;
    if (lvl0 !== this.photoLevel) this.setPhoto(lvl0);
    if (this.omega === 0 || this.cfg.sensorBlocked) return;
    const p0 = this.photoPhase(a0), p1 = this.photoPhase(this.angleAt(t1));
    const lo = Math.min(p0, p1), hi = Math.max(p0, p1), w = this.cfg.sensorWidth / 2;
    const crossings = [];
    for (let k = Math.floor(lo - w); k <= Math.ceil(hi + w); k++) {
      for (const edge of [k - w, k + w]) {
        if (edge > lo && edge <= hi) crossings.push(t0 + (edge - p0) / (p1 - p0) * (t1 - t0));
      }
    }
    crossings.sort((x, y) => x - y);
    let lvl = lvl0;
    for (const tc of crossings) {
      lvl ^= 1;
      if (this.cfg.bounce) {
        // kilka szybkich odbić przed ustaleniem się stanu
        for (let j = 0; j < 3; j++) {
          cpu.scheduleExt(tc + j * 9e-6, 1, 4, lvl ? 4 : 0);
          cpu.scheduleExt(tc + j * 9e-6 + 4e-6, 1, 4, lvl ? 0 : 4);
        }
        cpu.scheduleExt(tc + 27e-6, 1, 4, lvl ? 4 : 0);
      } else {
        cpu.scheduleExt(tc, 1, 4, lvl ? 4 : 0);
      }
    }
    this.photoLevel = lvl;
  }

  // ---------------------------------------------------------------- upływ czasu

  // Przesuwa symulację o dt sekund (czas symulowany). maxInstr ogranicza liczbę instrukcji
  // (krokowanie). Zwraca powód zatrzymania procesora albo null.
  advance(dt, maxInstr = Infinity) {
    const cpu = this.cpu;
    let t = cpu.time();
    const tEnd = t + dt;
    let left = maxInstr;
    while (t < tEnd - 1e-12) {
      const s = Math.min(SLICE, tEnd - t);
      this.updateMotor(s);
      this.sliceT0 = t;
      this.sliceA0 = this.angle;
      this.omega = this.rpsNow * this.cfg.direction;
      if (this.ledT < t) this.ledT = t;
      this.schedulePhoto(t, t + s);
      const before = cpu.stats.instr;
      const reason = cpu.run(cpu.cyclesAt(t + s), left);
      left -= cpu.stats.instr - before;
      const now = cpu.time();
      this.flush(now);
      this.angle = this.angleAt(now);
      if (reason) {
        cpu.clearExtQueue();
        this.photoLevel = cpu.lvl[1] & 4 ? 1 : 0;
        return reason;
      }
      t = now;
    }
    if (this.angle > 1e6 || this.angle < -1e6) this.angle -= Math.trunc(this.angle);
    return null;
  }

  // ---------------------------------------------------------------- programator ISP

  // podczas programowania układ jest w resecie, a programator steruje liniami PA4 (SCK) i PA6 (MOSI),
  // układ odpowiada na PA5 (MISO) - diody na tych liniach migoczą, jeśli bramki T1/T2 zostały naładowane
  startIsp() {
    this.ispActive = true;
    this.cpu.reset('isp');
    this.cpu.haltUntil = Infinity;
    this.cpu.updateGate();
  }

  ispNoise() {
    if (!this.ispActive) return;
    const r = (Math.random() * 256) | 0;
    this.cpu.setExt(0, 0x70, r & 0x70);
  }

  endIsp() {
    this.ispActive = false;
    this.cpu.extMask[0] = 0;
    this.cpu.extLevel[0] = 0;
  }
}
