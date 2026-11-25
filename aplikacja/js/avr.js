// avr.js - emulator mikrokontrolera ATtiny24
//
// Wykonuje prawdziwy kod maszynowy (plik .hex z avr-gcc) instrukcja po instrukcji,
// z dokładnością do cyklu zegara. Odwzorowane bloki ATtiny24:
//   rdzeń AVR (avr25, bez MUL), 2 KB flash, 128 B RAM, 128 B EEPROM,
//   porty A i B (DDR/PORT/PIN, pull-upy, przełączanie przez zapis do PINx),
//   Timer0 (8 bit) i Timer1 (16 bit) we wszystkich trybach WGM, z wyjściami OC,
//   INT0, PCINT0/1, watchdog, EEPROM, ADC (uproszczony), tryby uśpienia,
//   preskaler zegara CLKPR oraz fusebity (CKSEL, CKDIV8, CKOUT, RSTDISBL, WDTON, EESAVE).

export const FLASH_WORDS = 1024;
export const RAM_START = 0x60;
export const RAM_END = 0xDF;

// Adresy rejestrów w przestrzeni danych (adres I/O + 0x20)
export const REG = {
  PRR: 0x20, DIDR0: 0x21, ADCSRB: 0x23, ADCL: 0x24, ADCH: 0x25, ADCSRA: 0x26, ADMUX: 0x27,
  ACSR: 0x28, TIFR1: 0x2B, TIMSK1: 0x2C, USICR: 0x2D, USISR: 0x2E, USIDR: 0x2F, USIBR: 0x30,
  PCMSK0: 0x32, GPIOR0: 0x33, GPIOR1: 0x34, GPIOR2: 0x35, PINB: 0x36, DDRB: 0x37, PORTB: 0x38,
  PINA: 0x39, DDRA: 0x3A, PORTA: 0x3B, EECR: 0x3C, EEDR: 0x3D, EEARL: 0x3E, EEARH: 0x3F,
  PCMSK1: 0x40, WDTCSR: 0x41, TCCR1C: 0x42, GTCCR: 0x43, ICR1L: 0x44, ICR1H: 0x45, CLKPR: 0x46,
  DWDR: 0x47, OCR1BL: 0x48, OCR1BH: 0x49, OCR1AL: 0x4A, OCR1AH: 0x4B, TCNT1L: 0x4C, TCNT1H: 0x4D,
  TCCR1B: 0x4E, TCCR1A: 0x4F, TCCR0A: 0x50, OSCCAL: 0x51, TCNT0: 0x52, TCCR0B: 0x53, MCUSR: 0x54,
  MCUCR: 0x55, OCR0A: 0x56, SPMCSR: 0x57, TIFR0: 0x58, TIMSK0: 0x59, GIFR: 0x5A, GIMSK: 0x5B,
  OCR0B: 0x5C, SPL: 0x5D, SPH: 0x5E, SREG: 0x5F,
};

// Opis rejestrów I/O dla podglądu (nazwy bitów od bitu 7 do 0)
export const IO_GROUPS = [
  ['Porty', [
    ['DDRA', ['DDA7', 'DDA6', 'DDA5', 'DDA4', 'DDA3', 'DDA2', 'DDA1', 'DDA0']],
    ['PORTA', ['PA7', 'PA6', 'PA5', 'PA4', 'PA3', 'PA2', 'PA1', 'PA0']],
    ['PINA', ['PINA7', 'PINA6', 'PINA5', 'PINA4', 'PINA3', 'PINA2', 'PINA1', 'PINA0']],
    ['DDRB', ['', '', '', '', 'DDB3', 'DDB2', 'DDB1', 'DDB0']],
    ['PORTB', ['', '', '', '', 'PB3', 'PB2', 'PB1', 'PB0']],
    ['PINB', ['', '', '', '', 'PINB3', 'PINB2', 'PINB1', 'PINB0']],
  ]],
  ['Przerwania', [
    ['SREG', ['I', 'T', 'H', 'S', 'V', 'N', 'Z', 'C']],
    ['MCUCR', ['BODS', 'PUD', 'SE', 'SM1', 'SM0', 'BODSE', 'ISC01', 'ISC00']],
    ['GIMSK', ['', 'INT0', 'PCIE1', 'PCIE0', '', '', '', '']],
    ['GIFR', ['', 'INTF0', 'PCIF1', 'PCIF0', '', '', '', '']],
    ['PCMSK0', ['PCINT7', 'PCINT6', 'PCINT5', 'PCINT4', 'PCINT3', 'PCINT2', 'PCINT1', 'PCINT0']],
    ['PCMSK1', ['', '', '', '', 'PCINT11', 'PCINT10', 'PCINT9', 'PCINT8']],
  ]],
  ['Timer0', [
    ['TCCR0A', ['COM0A1', 'COM0A0', 'COM0B1', 'COM0B0', '', '', 'WGM01', 'WGM00']],
    ['TCCR0B', ['FOC0A', 'FOC0B', '', '', 'WGM02', 'CS02', 'CS01', 'CS00']],
    ['TCNT0', null], ['OCR0A', null], ['OCR0B', null],
    ['TIMSK0', ['', '', '', '', '', 'OCIE0B', 'OCIE0A', 'TOIE0']],
    ['TIFR0', ['', '', '', '', '', 'OCF0B', 'OCF0A', 'TOV0']],
  ]],
  ['Timer1', [
    ['TCCR1A', ['COM1A1', 'COM1A0', 'COM1B1', 'COM1B0', '', '', 'WGM11', 'WGM10']],
    ['TCCR1B', ['ICNC1', 'ICES1', '', 'WGM13', 'WGM12', 'CS12', 'CS11', 'CS10']],
    ['TCNT1', 16], ['OCR1A', 16], ['OCR1B', 16], ['ICR1', 16],
    ['TIMSK1', ['', '', 'ICIE1', '', '', 'OCIE1B', 'OCIE1A', 'TOIE1']],
    ['TIFR1', ['', '', 'ICF1', '', '', 'OCF1B', 'OCF1A', 'TOV1']],
  ]],
  ['System', [
    ['WDTCSR', ['WDIF', 'WDIE', 'WDP3', 'WDCE', 'WDE', 'WDP2', 'WDP1', 'WDP0']],
    ['MCUSR', ['', '', '', '', 'WDRF', 'BORF', 'EXTRF', 'PORF']],
    ['CLKPR', ['CLKPCE', '', '', '', 'CLKPS3', 'CLKPS2', 'CLKPS1', 'CLKPS0']],
    ['PRR', ['', '', '', '', 'PRTIM1', 'PRTIM0', 'PRUSI', 'PRADC']],
    ['GTCCR', ['TSM', '', '', '', '', '', '', 'PSR10']],
    ['EECR', ['', '', 'EEPM1', 'EEPM0', 'EERIE', 'EEMPE', 'EEPE', 'EERE']],
    ['EEARL', null], ['EEDR', null],
    ['ADMUX', ['REFS1', 'REFS0', 'MUX5', 'MUX4', 'MUX3', 'MUX2', 'MUX1', 'MUX0']],
    ['ADCSRA', ['ADEN', 'ADSC', 'ADATE', 'ADIF', 'ADIE', 'ADPS2', 'ADPS1', 'ADPS0']],
  ]],
];

export const VECTOR_NAMES = ['RESET', 'INT0', 'PCINT0', 'PCINT1', 'WDT', 'TIM1_CAPT', 'TIM1_COMPA',
  'TIM1_COMPB', 'TIM1_OVF', 'TIM0_COMPA', 'TIM0_COMPB', 'TIM0_OVF', 'ANA_COMP', 'ADC', 'EE_RDY',
  'USI_STR', 'USI_OVF'];

const SREG = 0x5F, SPL = 0x5D;
// rejestry, których zapis może zmienić stan zgłoszeń przerwań
const IRQ_REGS = new Uint8Array(0x60);
for (const a of [0x5B, 0x5A, 0x59, 0x58, 0x2C, 0x2B, 0x55, 0x41, 0x28, 0x26, 0x3C, 0x2D, 0x2E]) IRQ_REGS[a] = 1;
const FC = 1, FZ = 2, FN = 4, FV = 8, FS = 16, FH = 32, FT = 64, FI = 128;

// Kody operacji po zdekodowaniu
const ILL = 0, NOP = 1, MOVW = 2, CPC = 3, SBC = 4, ADD = 5, CPSE = 6, CP = 7, SUB = 8, ADC = 9,
  AND = 10, EOR = 11, OR = 12, MOV = 13, CPI = 14, SBCI = 15, SUBI = 16, ORI = 17, ANDI = 18,
  LDDZ = 19, LDDY = 20, STDZ = 21, STDY = 22, LDS = 23, LDZP = 24, LDMZ = 25, LPMZ = 26, LPMZP = 27,
  LDYP = 28, LDMY = 29, LDX = 30, LDXP = 31, LDMX = 32, POP = 33, STS = 34, STZP = 35, STMZ = 36,
  STYP = 37, STMY = 38, STX = 39, STXP = 40, STMX = 41, PUSH = 42, COM = 43, NEG = 44, SWAP = 45,
  INC = 46, ASR = 47, LSR = 48, ROR = 49, DEC = 50, JMP = 51, CALL = 52, BSET = 53, BCLR = 54,
  RET = 55, RETI = 56, SLEEP = 57, BREAK = 58, WDR = 59, LPM0 = 60, SPM = 61, IJMP = 62, ICALL = 63,
  ADIW = 64, SBIW = 65, CBI = 66, SBIC = 67, SBI = 68, SBIS = 69, IN = 70, OUT = 71, RJMP = 72,
  RCALL = 73, LDI = 74, BRBS = 75, BRBC = 76, BLD = 77, BST = 78, SBRC = 79, SBRS = 80;

function decode(w, next, pc) {
  const d5 = (w >> 4) & 0x1F, r5 = (w & 0xF) | ((w >> 5) & 0x10);
  const d4 = 16 + ((w >> 4) & 0xF), k8 = ((w >> 4) & 0xF0) | (w & 0xF);
  switch (w >> 12) {
    case 0x0:
      if (w === 0) return [NOP, 0, 0];
      switch ((w >> 10) & 3) {
        case 0: return (w & 0xFF00) === 0x0100 ? [MOVW, ((w >> 4) & 0xF) * 2, (w & 0xF) * 2] : [ILL, 0, 0];
        case 1: return [CPC, d5, r5];
        case 2: return [SBC, d5, r5];
        default: return [ADD, d5, r5];
      }
    case 0x1: return [[CPSE, CP, SUB, ADC][(w >> 10) & 3], d5, r5];
    case 0x2: return [[AND, EOR, OR, MOV][(w >> 10) & 3], d5, r5];
    case 0x3: return [CPI, d4, k8];
    case 0x4: return [SBCI, d4, k8];
    case 0x5: return [SUBI, d4, k8];
    case 0x6: return [ORI, d4, k8];
    case 0x7: return [ANDI, d4, k8];
    case 0x8: case 0xA: {
      const q = (w & 7) | ((w >> 7) & 0x18) | ((w >> 8) & 0x20);
      const y = w & 8;
      if (w & 0x200) return [y ? STDY : STDZ, d5, q];
      return [y ? LDDY : LDDZ, d5, q];
    }
    case 0x9: {
      const g = w & 0xFE00, lo = w & 0xF;
      if (g === 0x9000) {
        const t = [LDS, LDZP, LDMZ, ILL, LPMZ, LPMZP, ILL, ILL, ILL, LDYP, LDMY, ILL, LDX, LDXP, LDMX, POP][lo];
        return [t, d5, t === LDS ? next : 0];
      }
      if (g === 0x9200) {
        const t = [STS, STZP, STMZ, ILL, ILL, ILL, ILL, ILL, ILL, STYP, STMY, ILL, STX, STXP, STMX, PUSH][lo];
        return [t, d5, t === STS ? next : 0];
      }
      if (g === 0x9400) {
        switch (lo) {
          case 0: return [COM, d5, 0];
          case 1: return [NEG, d5, 0];
          case 2: return [SWAP, d5, 0];
          case 3: return [INC, d5, 0];
          case 5: return [ASR, d5, 0];
          case 6: return [LSR, d5, 0];
          case 7: return [ROR, d5, 0];
          case 0xA: return [DEC, d5, 0];
          case 0xC: case 0xD: case 0xE: case 0xF: {
            const k = ((((w >> 3) & 0x3E) | (w & 1)) * 65536 + next) & (FLASH_WORDS - 1);
            return [lo < 0xE ? JMP : CALL, 0, k];
          }
          case 8:
            if ((w & 0xFF8F) === 0x9408) return [BSET, (w >> 4) & 7, 0];
            if ((w & 0xFF8F) === 0x9488) return [BCLR, (w >> 4) & 7, 0];
            switch (w) {
              case 0x9508: return [RET, 0, 0];
              case 0x9518: return [RETI, 0, 0];
              case 0x9588: return [SLEEP, 0, 0];
              case 0x9598: return [BREAK, 0, 0];
              case 0x95A8: return [WDR, 0, 0];
              case 0x95C8: return [LPM0, 0, 0];
              case 0x95E8: return [SPM, 0, 0];
            }
            return [ILL, 0, 0];
          case 9:
            if (w === 0x9409) return [IJMP, 0, 0];
            if (w === 0x9509) return [ICALL, 0, 0];
            return [ILL, 0, 0];
        }
        return [ILL, 0, 0];
      }
      const h = w & 0xFF00;
      if (h === 0x9600 || h === 0x9700) {
        return [h === 0x9600 ? ADIW : SBIW, 24 + ((w >> 4) & 3) * 2, ((w >> 2) & 0x30) | (w & 0xF)];
      }
      if (h >= 0x9800 && h <= 0x9B00) {
        return [[CBI, SBIC, SBI, SBIS][(w >> 8) & 3], ((w >> 3) & 0x1F) + 0x20, w & 7];
      }
      return [ILL, 0, 0]; // MUL - brak w ATtiny24
    }
    case 0xB: return [(w & 0x800) ? OUT : IN, d5, (((w >> 5) & 0x30) | (w & 0xF)) + 0x20];
    case 0xC: case 0xD: {
      let k = w & 0xFFF;
      if (k & 0x800) k -= 0x1000;
      return [(w >> 12) === 0xC ? RJMP : RCALL, 0, (pc + 1 + k) & (FLASH_WORDS - 1)];
    }
    case 0xE: return [LDI, d4, k8];
    default: {
      const sub = (w >> 9) & 7;
      if (sub < 4) {
        let k = (w >> 3) & 0x7F;
        if (k & 0x40) k -= 0x80;
        return [(w & 0x400) ? BRBC : BRBS, w & 7, (pc + 1 + k) & (FLASH_WORDS - 1)];
      }
      return [[BLD, BST, SBRC, SBRS][sub - 4], d5, w & 7];
    }
  }
}

const PRESCALE_DIV = [0, 1, 8, 64, 256, 1024, 0, 0];
const PRESCALE_SH = [0, 0, 3, 6, 8, 10, 0, 0];

// Timer0 (8 bit) i Timer1 (16 bit) - wspólna logika
class Timer {
  constructor(cpu, n) {
    this.cpu = cpu;
    this.n = n;
    this.max = n ? 0xFFFF : 0xFF;
    this.flagAddr = n ? REG.TIFR1 : REG.TIFR0;
    // wyjścia OC: [port, bit]  (T0: OC0A=PB2, OC0B=PA7; T1: OC1A=PA6, OC1B=PA5)
    this.ocPin = n ? [[0, 6], [0, 5]] : [[1, 2], [0, 7]];
    this.reset();
  }

  reset() {
    this.cnt = 0; this.dir = 1;
    this.ocr = [0, 0]; this.act = [0, 0];
    this.icr = 0; this.block = false;
    this.oc = [0, 0]; this.com = [0, 0]; this.ocOn = [false, false];
    this.div = 0; this.sh = 0; this.ext = 0; this.nextTick = Infinity;
    this.kind = 0; this.topSrc = 0; this.fixedTop = this.max; this.toggleA = false; this.wgm = 0;
  }

  // kind: 0 normal, 1 CTC, 2 fast PWM, 3 phase correct, 4 phase+frequency correct
  // topSrc: 0 stała, 1 OCRxA (natychmiast), 2 OCRxA (buforowany), 3 ICR1
  configure() {
    const D = this.cpu.data;
    let a, b;
    if (this.n === 0) {
      a = D[REG.TCCR0A]; b = D[REG.TCCR0B];
      this.wgm = ((b >> 1) & 4) | (a & 3);
      const t = [[0, 0, 0xFF], [3, 0, 0xFF], [1, 1, 0], [2, 0, 0xFF], [0, 0, 0xFF], [3, 2, 0], [0, 0, 0xFF], [2, 2, 0]][this.wgm];
      this.kind = t[0]; this.topSrc = t[1]; this.fixedTop = t[2];
      this.toggleA = this.wgm === 5 || this.wgm === 7;
    } else {
      a = D[REG.TCCR1A]; b = D[REG.TCCR1B];
      this.wgm = ((b >> 1) & 0xC) | (a & 3);
      const t = [[0, 0, 0xFFFF], [3, 0, 0xFF], [3, 0, 0x1FF], [3, 0, 0x3FF], [1, 1, 0], [2, 0, 0xFF],
        [2, 0, 0x1FF], [2, 0, 0x3FF], [4, 3, 0], [4, 2, 0], [3, 3, 0], [3, 2, 0], [1, 3, 0],
        [0, 0, 0xFFFF], [2, 3, 0], [2, 2, 0]][this.wgm];
      this.kind = t[0]; this.topSrc = t[1]; this.fixedTop = t[2];
      this.toggleA = this.wgm === 9 || this.wgm === 11 || this.wgm === 15;
    }
    if (this.kind < 2) { this.act[0] = this.ocr[0]; this.act[1] = this.ocr[1]; }
    this.com = [(a >> 6) & 3, (a >> 4) & 3];
    for (let ch = 0; ch < 2; ch++) {
      const c = this.com[ch];
      this.ocOn[ch] = c !== 0 && !(this.kind >= 2 && c === 1 && !(ch === 0 && this.toggleA));
    }
    const cs = b & 7;
    const stopped = (D[REG.PRR] >> (this.n ? 3 : 2)) & 1;
    this.div = stopped ? 0 : PRESCALE_DIV[cs];
    this.sh = PRESCALE_SH[cs];
    this.ext = stopped ? 0 : (cs >= 6 ? cs : 0);
    this.nextTick = this.div ? this.cpu.nextBoundary(this.div) : Infinity;
    this.cpu.recalcTick();
    this.cpu.updateOcPins();
  }

  top() {
    switch (this.topSrc) {
      case 0: return this.fixedTop;
      case 1: return this.ocr[0];
      case 2: return this.act[0];
      default: return this.icr;
    }
  }

  writeOcr(ch, v) {
    this.ocr[ch] = v;
    if (this.kind < 2) this.act[ch] = v;
  }

  writeCnt(v) {
    this.cnt = v;
    this.block = true;
  }

  update() {
    this.act[0] = this.ocr[0];
    this.act[1] = this.ocr[1];
  }

  setOc(ch, v) {
    if (this.oc[ch] !== v) {
      this.oc[ch] = v;
      if (this.ocOn[ch]) this.cpu.updateOcPins();
    }
  }

  // reakcja wyjścia OC na zgodność porównania; up = kierunek liczenia
  matchOutput(ch, up, top) {
    const c = this.com[ch];
    if (!c || !this.ocOn[ch]) return;
    if (this.kind < 2) {
      this.setOc(ch, c === 1 ? this.oc[ch] ^ 1 : c === 2 ? 0 : 1);
    } else if (c === 1) {
      this.setOc(ch, this.oc[ch] ^ 1);
    } else if (this.kind === 2) {
      this.setOc(ch, c === 2 ? 0 : 1);
    } else if (this.act[ch] === top) {
      this.setOc(ch, c === 2 ? 1 : 0);     // OCR = TOP: wyjście stale aktywne
    } else if (this.act[ch] === 0) {
      this.setOc(ch, c === 2 ? 0 : 1);     // OCR = BOTTOM: wyjście stale nieaktywne
    } else {
      this.setOc(ch, (c === 2) === up ? 0 : 1);
    }
  }

  force(ch) {
    if (this.kind < 2) this.matchOutput(ch, true, this.top());
  }

  tick() {
    const D = this.cpu.data, F = this.flagAddr;
    const f0 = D[F];
    const old = this.cnt, top = this.top(), up = this.dir > 0;
    // w fast PWM zgodność na TOP pokrywa się z ustawieniem wyjścia na BOTTOM - wygrywa BOTTOM
    const atFastTop = this.kind === 2 && old === top;
    if (this.block) {
      this.block = false;
    } else {
      if (old === this.act[0]) { D[F] |= 2; if (!atFastTop) this.matchOutput(0, up, top); }
      if (old === this.act[1]) { D[F] |= 4; if (!atFastTop) this.matchOutput(1, up, top); }
    }
    switch (this.kind) {
      case 0:
        this.cnt = (old + 1) & this.max;
        if (old === this.max) D[F] |= 1;
        break;
      case 1:
        if (old === top) {
          this.cnt = 0;
          if (this.topSrc === 3) D[F] |= 0x20;
        } else {
          this.cnt = (old + 1) & this.max;
        }
        if (old === this.max) D[F] |= 1;
        break;
      case 2:
        if (old === top) {
          this.cnt = 0;
          D[F] |= 1;
          if (this.topSrc === 3) D[F] |= 0x20;
          this.update();
          for (let ch = 0; ch < 2; ch++) {
            const c = this.com[ch];
            if (this.ocOn[ch] && c >= 2) this.setOc(ch, c === 2 ? 1 : 0);
          }
        } else {
          this.cnt = (old + 1) & this.max;
        }
        break;
      default:
        if (top === 0) { this.cnt = 0; break; }
        if (up) {
          if (old >= top) {
            this.dir = -1;
            this.cnt = top - 1;
            if (this.kind === 3) this.update();
            if (this.topSrc === 3) D[F] |= 0x20;
          } else {
            this.cnt = old + 1;
          }
        } else if (old === 0) {
          this.dir = 1;
          this.cnt = 1;
          D[F] |= 1;
          if (this.kind === 4) this.update();
        } else {
          this.cnt = old - 1;
        }
    }
    if (D[F] !== f0) this.cpu.irqDirty = true;
  }
}

export class ATtiny24 {
  constructor() {
    this.flash = new Uint16Array(FLASH_WORDS).fill(0xFFFF);
    this.op = new Uint8Array(FLASH_WORDS);
    this.oa = new Uint16Array(FLASH_WORDS);
    this.ob = new Uint16Array(FLASH_WORDS);
    this.data = new Uint8Array(0x100);
    this.eeprom = new Uint8Array(128).fill(0xFF);
    this.bp = new Uint8Array(FLASH_WORDS);
    this.fuses = { low: 0xE2, high: 0xD7, ext: 0xFF };
    this.t0 = new Timer(this, 0);
    this.t1 = new Timer(this, 1);

    // stan pinów: [port A, port B]
    this.lvl = [0, 0];          // poziomy logiczne
    this.extMask = [0, 0];      // piny sterowane z zewnątrz (gdy są wejściami)
    this.extLevel = [0, 0];
    this.keepMask = [0, 0];     // piny pływające, które pamiętają ostatni stan (np. bramka MOSFET-a)
    this.ocMask = [0, 0];       // piny przejęte przez wyjścia OC timerów
    this.ocLevel = [0, 0];

    this.hooks = { pins: null, isr: null, diag: null, reset: null };
    this.extQueue = [];
    this.badIrqAddr = -1;
    this.stopAddr = -1;
    this.heapStart = 0;

    this.powered = false;
    this.cycles = 0;
    this.freq = 8e6;
    this.tRef = 0; this.cRef = 0;
    this.pres = 0;
    this.pc = 0;
    this.irqHold = 0;
    this.irqDirty = true;
    this.sleeping = false; this.sleepMode = 0;
    this.haltUntil = 0;
    this.stopReason = null;
    this.bpResume = false;
    this.isrDepth = 0;
    this.minSp = RAM_END;
    this.stats = this.newStats();
    this.evWdt = Infinity; this.evEe = Infinity; this.evAdc = Infinity;
    this.nextEvent = Infinity;
    this.gate = -Infinity;
    this.bpCount = 0;
    this.clockOk = true;
    this.t1temp = 0;
    this.presBase = 0;
    this.nextTick = Infinity;
    this.wdtStart = 0;
    this.wdceUntil = -1; this.clkpceUntil = -1; this.eempeUntil = -1;
    this.eeWrite = null;
    this.adcFirst = true;
    this.decodeAll();
    // puste wywołanie: V8 zbiera informacje o typach dla kodu za pętlą, zanim zoptymalizuje
    // run() w trakcie pętli (bez tego każde wyjście z run() cofało optymalizację)
    this.run(-1);
  }

  newStats() {
    // profMain / profIsr: cykle zużyte przez instrukcję pod danym adresem słowa,
    // osobno w programie głównym i w przerwaniach (zakładka "Wykorzystanie")
    return { isrCycles: 0, sleepCycles: 0, irqCount: new Uint32Array(17), resets: 0, lostIrq: new Uint32Array(17), instr: 0,
      profMain: new Float64Array(FLASH_WORDS), profIsr: new Float64Array(FLASH_WORDS) };
  }

  // ---------------------------------------------------------------- program i pamięć

  loadFlash(words) {
    this.flash.fill(0xFFFF);
    this.flash.set(words.subarray(0, FLASH_WORDS));
    this.decodeAll();
  }

  decodeAll() {
    for (let pc = 0; pc < FLASH_WORDS; pc++) {
      const [o, a, b] = decode(this.flash[pc], this.flash[(pc + 1) & (FLASH_WORDS - 1)], pc);
      this.op[pc] = o; this.oa[pc] = a; this.ob[pc] = b;
    }
  }

  is2(pc) {
    const o = this.op[pc & (FLASH_WORDS - 1)];
    return o === LDS || o === STS || o === JMP || o === CALL;
  }

  // ---------------------------------------------------------------- zegar i czas

  // częstotliwość wynikająca z fusebitów i CLKPR; 0 = brak zegara
  baseFreq() {
    const cksel = this.fuses.low & 0x0F;
    if (cksel === 0x2) return 8e6;
    if (cksel === 0x4) return 128e3;
    return 0; // zegar zewnętrzny / kwarc - na stanowisku ich nie ma
  }

  time(c = this.cycles) {
    return this.tRef + (c - this.cRef) / this.freq;
  }

  cyclesAt(t) {
    return this.cRef + (t - this.tRef) * this.freq;
  }

  setFreq(f) {
    const t = this.time();
    this.tRef = t; this.cRef = this.cycles;
    this.freq = f || 8e6;
    for (const e of this.extQueue) e.c = this.cyclesAt(e.t);
    if (this.evWdt !== Infinity) this.scheduleWdt();
    this.recalcNext();
  }

  // ---------------------------------------------------------------- reset i zasilanie

  powerOn() {
    this.powered = true;
    for (let i = 0; i < 0x100; i++) this.data[i] = (Math.random() * 256) | 0;
    this.reset('por');
  }

  powerOff() {
    this.powered = false;
    this.sleeping = false;
    this.gate = -Infinity;
    this.data.fill(0, 0x20, 0x60);
    this.updateOcPins();
    this.pinsChanged();
  }

  // źródła: 'por' (włączenie zasilania), 'ext' (przycisk RESET), 'wdt', 'isp' (po programowaniu)
  reset(src) {
    const D = this.data;
    const mcusr = src === 'por' ? 1 : (D[REG.MCUSR] & 0x0F) | (src === 'ext' || src === 'isp' ? 2 : src === 'wdt' ? 8 : 0);
    D.fill(0, 0x00, 0x20);
    D.fill(0, 0x20, 0x60);
    D[REG.MCUSR] = mcusr;
    D[REG.OSCCAL] = 0x8A;
    D[SPL] = RAM_END;
    const wdton = !(this.fuses.high & 0x10);
    D[REG.WDTCSR] = (mcusr & 8) || wdton ? 0x08 : 0;
    D[REG.CLKPR] = (this.fuses.low & 0x80) ? 0 : 3;
    this.t0.reset(); this.t1.reset();
    this.t1temp = 0;
    this.pres = 0;
    this.presBase = this.cycles;
    this.nextTick = Infinity;
    this.pc = 0;
    this.irqHold = 0;
    this.irqDirty = true;
    this.sleeping = false;
    this.isrDepth = 0;
    this.minSp = RAM_END;
    this.wdceUntil = -1; this.clkpceUntil = -1; this.eempeUntil = -1;
    this.evEe = Infinity; this.evAdc = Infinity;
    this.eeWrite = null;
    this.stats.resets++;
    this.updateFreq();
    // czas startu: SUT1:0 przy wewnętrznym RC (00: 6 CK, 01: +4 ms, 10: +64 ms);
    // przez ten czas układ jest w resecie, a watchdog zaczyna liczyć dopiero po nim
    const sut = (this.fuses.low >> 4) & 3;
    const delay = sut === 0 ? 0 : sut === 1 ? 0.004 : 0.064;
    this.haltUntil = this.cycles + 14 + delay * this.freq;
    this.wdtStart = this.haltUntil;
    this.scheduleWdt();
    this.recalcNext();
    this.updateOcPins();
    this.pinsChanged();
    if (this.hooks.reset) this.hooks.reset(src);
  }

  updateFreq() {
    const base = this.baseFreq();
    this.clockOk = base > 0;
    const ps = this.data[REG.CLKPR] & 0x0F;
    this.setFreq(base / (1 << Math.min(ps, 8)));
  }

  rstdisbl() {
    return !(this.fuses.high & 0x80);
  }

  // ---------------------------------------------------------------- piny

  updateOcPins() {
    const m = [0, 0], l = [0, 0];
    for (const t of [this.t0, this.t1]) {
      for (let ch = 0; ch < 2; ch++) {
        if (t.ocOn[ch]) {
          const [p, b] = t.ocPin[ch];
          m[p] |= 1 << b;
          if (t.oc[ch]) l[p] |= 1 << b;
        }
      }
    }
    // CKOUT: zegar systemowy na PB2
    if (!(this.fuses.low & 0x40)) { m[1] |= 4; l[1] |= 4; }
    const changed = m[0] !== this.ocMask[0] || m[1] !== this.ocMask[1] || l[0] !== this.ocLevel[0] || l[1] !== this.ocLevel[1];
    this.ocMask = m; this.ocLevel = l;
    if (changed) this.pinsChanged();
  }

  levelOf(p) {
    const D = this.data;
    if (!this.powered) {
      const ext = this.extMask[p];
      return (this.extLevel[p] & ext) | (this.lvl[p] & this.keepMask[p] & ~ext);
    }
    const mask = p ? 0x0F : 0xFF;
    let ddr = D[p ? REG.DDRB : REG.DDRA], port = D[p ? REG.PORTB : REG.PORTA];
    if (p === 1 && !this.rstdisbl()) { ddr &= 0x07; port &= 0x07; }
    let out = (port & ~this.ocMask[p]) | (this.ocLevel[p] & this.ocMask[p]);
    let drv = ddr;
    if (p === 1 && !(this.fuses.low & 0x40)) drv |= 4; // CKOUT wymusza wyjście
    const pull = (D[REG.MCUCR] & 0x40) ? 0 : ~ddr & port;
    const ext = ~drv & this.extMask[p];
    const lvlOut = out & drv;
    const lvlExt = this.extLevel[p] & ext;
    const lvlPull = pull & ~drv & ~ext;
    const fl = ~drv & ~ext & ~pull;
    const lvlKeep = this.lvl[p] & fl & this.keepMask[p];
    return (lvlOut | lvlExt | lvlPull | lvlKeep) & mask;
  }

  pinsChanged() {
    const nA = this.levelOf(0), nB = this.levelOf(1);
    const chA = nA ^ this.lvl[0], chB = nB ^ this.lvl[1];
    this.lvl[0] = nA; this.lvl[1] = nB;
    if ((chA | chB) && this.powered) { this.edges(chA, chB, nA, nB); this.irqDirty = true; }
    if (this.hooks.pins) this.hooks.pins(this);
  }

  edges(chA, chB, nA, nB) {
    const D = this.data;
    // INT0 na PB2 (w power-down zbocza nie są wykrywane - brak zegara I/O)
    if (chB & 4) {
      const isc = D[REG.MCUCR] & 3;
      const fall = !(nB & 4);
      const clkIo = !(this.sleeping && this.sleepMode !== 0);
      if (clkIo && (isc === 1 || (isc === 2 && fall) || (isc === 3 && !fall))) {
        if (D[REG.GIFR] & 0x40) this.stats.lostIrq[1]++;
        D[REG.GIFR] |= 0x40;
      }
    }
    if (chA & D[REG.PCMSK0]) D[REG.GIFR] |= 0x10;
    if (chB & D[REG.PCMSK1] & 0x0F) D[REG.GIFR] |= 0x20;
    // Input capture na PA7 (ICP)
    if ((chA & 0x80) && this.t1.topSrc !== 3) {
      const rising = !!(nA & 0x80);
      if (rising === !!(D[REG.TCCR1B] & 0x40)) {
        this.t1.icr = this.t1.cnt;
        D[REG.TIFR1] |= 0x20;
      }
    }
    // zewnętrzne zegary timerów: T0 = PA3, T1 = PA4 (6 = zbocze opadające, 7 = narastające)
    if ((chA & 0x08) && this.t0.ext && ((this.t0.ext === 7) === !!(nA & 0x08))) this.t0.tick();
    if ((chA & 0x10) && this.t1.ext && ((this.t1.ext === 7) === !!(nA & 0x10))) this.t1.tick();
  }

  // ustawienie stanu linii sterowanej z zewnątrz (natychmiast)
  setExt(p, mask, level) {
    this.extMask[p] = (this.extMask[p] & ~mask) | mask;
    this.extLevel[p] = (this.extLevel[p] & ~mask) | (level & mask);
    this.pinsChanged();
  }

  // zaplanowanie zmiany stanu linii zewnętrznej na chwilę t [s]
  scheduleExt(t, p, mask, level) {
    const e = { t, c: this.cyclesAt(t), p, mask, level };
    const q = this.extQueue;
    let i = q.length;
    while (i > 0 && q[i - 1].c > e.c) i--;
    q.splice(i, 0, e);
    this.recalcNext();
  }

  clearExtQueue() {
    this.extQueue.length = 0;
    this.recalcNext();
  }

  recalcNext() {
    const q = this.extQueue;
    this.nextEvent = Math.min(q.length ? q[0].c : Infinity, this.evWdt, this.evEe, this.evAdc);
    this.updateGate();
  }

  // próg cykli, od którego pętla wykonania musi wejść w wolną ścieżkę
  updateGate() {
    const blocked = !this.powered || !this.clockOk || this.sleeping || this.cycles < this.haltUntil;
    this.gate = blocked ? -Infinity : Math.min(this.nextEvent, this.haltUntil > this.cycles ? this.haltUntil : Infinity);
  }

  processEvents() {
    this.irqDirty = true;
    const q = this.extQueue;
    while (q.length && q[0].c <= this.cycles) {
      const e = q.shift();
      this.extMask[e.p] |= e.mask;
      this.extLevel[e.p] = (this.extLevel[e.p] & ~e.mask) | (e.level & e.mask);
      this.pinsChanged();
    }
    if (this.cycles >= this.evWdt) this.wdtTimeout();
    if (this.cycles >= this.evEe) this.eeDone();
    if (this.cycles >= this.evAdc) this.adcDone();
    this.recalcNext();
  }

  // ---------------------------------------------------------------- watchdog

  scheduleWdt() {
    const w = this.data[REG.WDTCSR];
    const wdton = !(this.fuses.high & 0x10);
    if (!this.powered || !((w & 0x48) || wdton)) { this.evWdt = Infinity; return; }
    const wdp = ((w >> 2) & 8) | (w & 7);
    const sec = (2048 << Math.min(wdp, 9)) / 128000;
    this.evWdt = this.wdtStart + sec * this.freq;
  }

  wdtReset() {
    this.wdtStart = this.cycles;
    this.scheduleWdt();
    this.recalcNext();
  }

  wdtTimeout() {
    const D = this.data;
    const w = D[REG.WDTCSR];
    const wdton = !(this.fuses.high & 0x10);
    this.wdtStart = this.cycles;
    if ((w & 0x40) && !wdton) {
      D[REG.WDTCSR] |= 0x80;
      this.scheduleWdt();
      return;
    }
    if ((w & 0x08) || wdton) {
      if (this.hooks.diag) this.hooks.diag('wdt', {});
      this.reset('wdt');
      return;
    }
    this.scheduleWdt();
  }

  writeWdtcsr(v) {
    const D = this.data;
    let w = D[REG.WDTCSR];
    const wdton = !(this.fuses.high & 0x10);
    if (v & 0x80) w &= ~0x80;
    w = (w & ~0x40) | (v & 0x40);
    if (this.cycles <= this.wdceUntil) {
      w = (w & 0xC0) | (v & 0x2F);
      this.wdceUntil = -1;
    } else if ((v & 0x18) === 0x18) {
      this.wdceUntil = this.cycles + 4;
      w |= 0x08;
    } else if (v & 0x08) {
      w |= 0x08;
    }
    if ((D[REG.MCUSR] & 8) || wdton) w |= 0x08;
    D[REG.WDTCSR] = w & ~0x10;
    this.scheduleWdt();
    this.recalcNext();
  }

  // ---------------------------------------------------------------- EEPROM

  writeEecr(v) {
    const D = this.data;
    let e = this.rd(REG.EECR);
    const busy = e & 2;
    if (!busy) e = (e & ~0x30) | (v & 0x30);
    e = (e & ~0x08) | (v & 0x08);
    const addr = D[REG.EEARL] & 0x7F;
    if ((v & 2) && !busy && (e & 4) && this.cycles <= this.eempeUntil) {
      const mode = (e >> 4) & 3;
      this.eeWrite = { addr, val: D[REG.EEDR], mode };
      e |= 2;
      e &= ~4;
      this.evEe = this.cycles + (mode === 0 ? 0.0034 : 0.0018) * this.freq;
      this.haltUntil = Math.max(this.haltUntil, this.cycles + 2);
      this.gate = -Infinity;
      this.recalcNext();
    } else if (v & 4) {
      e |= 4;
      this.eempeUntil = this.cycles + 4;
    }
    if ((v & 1) && !busy) {
      D[REG.EEDR] = this.eeprom[addr];
      this.haltUntil = Math.max(this.haltUntil, this.cycles + 4);
      this.gate = -Infinity;
    }
    D[REG.EECR] = e & ~1;
  }

  eeDone() {
    const w = this.eeWrite;
    if (w) {
      if (w.mode === 0) this.eeprom[w.addr] = w.val;
      else if (w.mode === 1) this.eeprom[w.addr] = 0xFF;
      else if (w.mode === 2) this.eeprom[w.addr] &= w.val;
      if (this.hooks.diag) this.hooks.diag('eeprom', { addr: w.addr, val: this.eeprom[w.addr] });
    }
    this.eeWrite = null;
    this.data[REG.EECR] &= ~2;
    this.evEe = Infinity;
  }

  // ---------------------------------------------------------------- ADC (uproszczony)

  writeAdcsra(v) {
    const D = this.data;
    let a = D[REG.ADCSRA];
    if (v & 0x10) a &= ~0x10;
    a = (a & 0x50) | (v & 0xAF);
    if ((v & 0x40) && (a & 0x80) && !(D[REG.ADCSRA] & 0x40)) {
      a |= 0x40;
      const ps = Math.max(2, 1 << (a & 7));
      this.evAdc = this.cycles + (this.adcFirst === false ? 13 : 25) * ps;
      this.adcFirst = false;
      this.recalcNext();
    }
    if (!(a & 0x80)) { a &= ~0x40; this.adcFirst = true; this.evAdc = Infinity; }
    D[REG.ADCSRA] = a;
  }

  adcDone() {
    const D = this.data;
    const mux = D[REG.ADMUX] & 0x3F;
    let v = 0;
    if (mux < 8) v = (this.lvl[0] >> mux) & 1 ? 1023 : 0;
    else if (mux === 0x21) v = 225;
    else if (mux === 0x22) v = 300;
    if (D[REG.ADCSRB] & 0x10) v <<= 6;
    D[REG.ADCL] = v & 0xFF;
    D[REG.ADCH] = (v >> 8) & 0xFF;
    D[REG.ADCSRA] = (D[REG.ADCSRA] & ~0x40) | 0x10;
    this.evAdc = Infinity;
    if (D[REG.ADCSRA] & 0x20) this.writeAdcsra(D[REG.ADCSRA] | 0x40);
  }

  // ---------------------------------------------------------------- dostęp do pamięci

  rd(addr) {
    const D = this.data;
    if (addr >= RAM_START) {
      if (addr <= RAM_END) return D[addr];
      if (this.hooks.diag) this.hooks.diag('ram', { addr, write: false, pc: this.pc });
      return 0;
    }
    if (addr < 0x20) return D[addr];
    switch (addr) {
      case 0x39: /* PINA */ return this.lvl[0] & ~D[REG.DIDR0];
      case 0x36: /* PINB */
        if (!(this.fuses.low & 0x40)) return (this.lvl[1] & ~4) | ((this.cycles & 1) << 2);
        return this.lvl[1];
      case 0x52: /* TCNT0 */ return this.t0.cnt;
      case 0x56: /* OCR0A */ return this.t0.ocr[0];
      case 0x5C: /* OCR0B */ return this.t0.ocr[1];
      case 0x4C: /* TCNT1L */ this.t1temp = this.t1.cnt >> 8; return this.t1.cnt & 0xFF;
      case 0x4D: /* TCNT1H */ return this.t1temp;
      case 0x44: /* ICR1L */ this.t1temp = this.t1.icr >> 8; return this.t1.icr & 0xFF;
      case 0x45: /* ICR1H */ return this.t1temp;
      case 0x4A: /* OCR1AL */ return this.t1.ocr[0] & 0xFF;
      case 0x4B: /* OCR1AH */ return this.t1.ocr[0] >> 8;
      case 0x48: /* OCR1BL */ return this.t1.ocr[1] & 0xFF;
      case 0x49: /* OCR1BH */ return this.t1.ocr[1] >> 8;
      case 0x5E: /* SPH */ return 0;
      case 0x3C: /* EECR */ return this.cycles > this.eempeUntil ? D[addr] & ~4 : D[addr];
      default: return D[addr];
    }
  }

  wr(addr, v) {
    const D = this.data;
    if (addr >= RAM_START) {
      if (addr <= RAM_END) { D[addr] = v; return; }
      if (this.hooks.diag) this.hooks.diag('ram', { addr, write: true, pc: this.pc });
      return;
    }
    if (addr < 0x20) { D[addr] = v; return; }
    if (IRQ_REGS[addr]) this.irqDirty = true;
    switch (addr) {
      case 0x39: /* PINA */ if (v) { D[REG.PORTA] ^= v; this.pinsChanged(); } return;
      case 0x36: /* PINB */ if (v & 0x0F) { D[REG.PORTB] ^= v & 0x0F; this.pinsChanged(); } return;
      case 0x3B: /* PORTA */ case 0x3A: /* DDRA */ if (D[addr] !== v) { D[addr] = v; this.pinsChanged(); } return;
      case 0x38: /* PORTB */ case 0x37: /* DDRB */ v &= 0x0F; if (D[addr] !== v) { D[addr] = v; this.pinsChanged(); } return;
      case 0x55: /* MCUCR */ {
        const old = D[addr];
        D[addr] = v;
        if ((old ^ v) & 0x40) this.pinsChanged();
        return;
      }
      case 0x5B: /* GIMSK */ D[addr] = v & 0x70; return;
      case 0x5A: /* GIFR */ D[addr] &= ~(v & 0x70); return;
      case 0x58: /* TIFR0 */ D[addr] &= ~(v & 0x07); return;
      case 0x2B: /* TIFR1 */ D[addr] &= ~(v & 0x27); return;
      case 0x59: /* TIMSK0 */ D[addr] = v & 0x07; return;
      case 0x2C: /* TIMSK1 */ D[addr] = v & 0x27; return;
      case 0x50: /* TCCR0A */ D[addr] = v & 0xF3; this.t0.configure(); return;
      case 0x53: /* TCCR0B */
        D[addr] = v & 0x0F;
        this.t0.configure();
        if (v & 0x80) this.t0.force(0);
        if (v & 0x40) this.t0.force(1);
        return;
      case 0x52: /* TCNT0 */ this.t0.writeCnt(v); return;
      case 0x56: /* OCR0A */ this.t0.writeOcr(0, v); return;
      case 0x5C: /* OCR0B */ this.t0.writeOcr(1, v); return;
      case 0x4F: /* TCCR1A */ D[addr] = v & 0xF3; this.t1.configure(); return;
      case 0x4E: /* TCCR1B */ D[addr] = v & 0xDF; this.t1.configure(); return;
      case 0x42: /* TCCR1C */
        if (v & 0x80) this.t1.force(0);
        if (v & 0x40) this.t1.force(1);
        return;
      case 0x4D: /* TCNT1H */ case 0x4B: /* OCR1AH */ case 0x49: /* OCR1BH */ case 0x45: /* ICR1H */ this.t1temp = v; return;
      case 0x4C: /* TCNT1L */ this.t1.writeCnt((this.t1temp << 8) | v); return;
      case 0x4A: /* OCR1AL */ this.t1.writeOcr(0, (this.t1temp << 8) | v); return;
      case 0x48: /* OCR1BL */ this.t1.writeOcr(1, (this.t1temp << 8) | v); return;
      case 0x44: /* ICR1L */ this.t1.icr = (this.t1temp << 8) | v; return;
      case 0x43: /* GTCCR */
        D[addr] = v & 0x80;
        if (v & 1) {
          this.presBase = this.cycles;
          for (const t of [this.t0, this.t1]) t.nextTick = t.div ? this.nextBoundary(t.div) : Infinity;
          this.recalcTick();
        }
        return;
      case 0x20: /* PRR */ D[addr] = v & 0x0F; this.t0.configure(); this.t1.configure(); return;
      case 0x41: /* WDTCSR */ this.writeWdtcsr(v); return;
      case 0x46: /* CLKPR */
        if (v === 0x80) {
          this.clkpceUntil = this.cycles + 4;
        } else if (!(v & 0x80) && this.cycles <= this.clkpceUntil) {
          D[addr] = v & 0x0F;
          this.clkpceUntil = -1;
          this.updateFreq();
          if (this.hooks.diag) this.hooks.diag('clkpr', { div: 1 << (v & 0x0F) });
        }
        return;
      case 0x54: /* MCUSR */ D[addr] = v & 0x0F; return;
      case 0x3C: /* EECR */ this.writeEecr(v); return;
      case 0x3E: /* EEARL */ D[addr] = v & 0x7F; return;
      case 0x3F: /* EEARH */ return;
      case 0x26: /* ADCSRA */ this.writeAdcsra(v); return;
      case 0x28: /* ACSR */ D[addr] = (D[addr] & ~0x10 & ~(v & 0x10)) | (v & 0xCF); return;
      case 0x2E: /* USISR */ D[addr] = (D[addr] & ~(v & 0xE0)) | (v & 0x0F); return;
      case 0x5E: /* SPH */ return;
      case 0x5D: /* SPL */
        D[addr] = v;
        if (v < this.minSp) this.minSp = v;
        return;
      default: D[addr] = v;
    }
  }

  // bitowe instrukcje SBI/CBI: na rejestrach flag i PINx działają tylko na wskazany bit
  bitIo(addr, bit, set) {
    if (addr === REG.TIFR1 || addr === REG.PINA || addr === REG.PINB) {
      if (set) this.wr(addr, 1 << bit);
      return;
    }
    const v = this.rd(addr);
    this.wr(addr, set ? v | (1 << bit) : v & ~(1 << bit));
  }

  push(v) {
    const sp = this.data[SPL];
    this.wr(sp, v);
    const n = (sp - 1) & 0xFF;
    this.data[SPL] = n;
    if (n < this.minSp) this.minSp = n;
  }

  pop() {
    const sp = (this.data[SPL] + 1) & 0xFF;
    this.data[SPL] = sp;
    return this.rd(sp);
  }

  pushPC(v) {
    this.push(v & 0xFF);
    this.push((v >> 8) & 0xFF);
  }

  popPC() {
    const hi = this.pop();
    return ((hi << 8) | this.pop()) & (FLASH_WORDS - 1);
  }

  lpm(z) {
    const w = this.flash[(z >> 1) & (FLASH_WORDS - 1)];
    return z & 1 ? w >> 8 : w & 0xFF;
  }

  // ---------------------------------------------------------------- flagi

  fAdd(a, b, r) {
    let s = this.data[SREG] & 0xC0;
    const c = (a & b) | (b & ~r) | (~r & a);
    if (c & 0x80) s |= FC;
    if (c & 0x08) s |= FH;
    if (((a & b & ~r) | (~a & ~b & r)) & 0x80) s |= FV;
    if (r & 0x80) s |= FN;
    if (((s >> 2) ^ (s >> 3)) & 1) s |= FS;
    if (r === 0) s |= FZ;
    this.data[SREG] = s;
  }

  fSub(a, b, r, keepZ) {
    const old = this.data[SREG];
    let s = old & 0xC0;
    const c = (~a & b) | (b & r) | (r & ~a);
    if (c & 0x80) s |= FC;
    if (c & 0x08) s |= FH;
    if (((a & ~b & ~r) | (~a & b & r)) & 0x80) s |= FV;
    if (r & 0x80) s |= FN;
    if (((s >> 2) ^ (s >> 3)) & 1) s |= FS;
    if (r === 0 && (!keepZ || (old & FZ))) s |= FZ;
    this.data[SREG] = s;
  }

  fLogic(r) {
    let s = this.data[SREG] & 0xE1;
    if (r & 0x80) s |= FN | FS;
    if (r === 0) s |= FZ;
    this.data[SREG] = s;
  }

  fShift(r, c) {
    let s = this.data[SREG] & 0xE0;
    if (c) s |= FC;
    if (r & 0x80) s |= FN;
    if (((r >> 7) ^ c) & 1) s |= FV;
    if (((s >> 2) ^ (s >> 3)) & 1) s |= FS;
    if (r === 0) s |= FZ;
    this.data[SREG] = s;
  }

  // ---------------------------------------------------------------- przerwania

  irqVector() {
    const D = this.data;
    const gm = D[REG.GIMSK], gf = D[REG.GIFR];
    if (gm & 0x40) {
      if ((D[REG.MCUCR] & 3) === 0) { if (!(this.lvl[1] & 4)) return 1; } else if (gf & 0x40) return 1;
    }
    if (gm & gf & 0x10) return 2;
    if (gm & gf & 0x20) return 3;
    if ((D[REG.WDTCSR] & 0xC0) === 0xC0) return 4;
    const t1 = D[REG.TIFR1] & D[REG.TIMSK1];
    if (t1) { if (t1 & 0x20) return 5; if (t1 & 2) return 6; if (t1 & 4) return 7; return 8; }
    const t0 = D[REG.TIFR0] & D[REG.TIMSK0];
    if (t0) { if (t0 & 2) return 9; if (t0 & 4) return 10; return 11; }
    if ((D[REG.ACSR] & 0x18) === 0x18) return 12;
    if ((D[REG.ADCSRA] & 0x18) === 0x18) return 13;
    if ((D[REG.EECR] & 0x0A) === 0x08) return 14;
    const us = D[REG.USISR], uc = D[REG.USICR];
    if (us & uc & 0x80) return 15;
    if (us & uc & 0x40) return 16;
    return 0;
  }

  enterIrq(v) {
    const D = this.data;
    switch (v) {
      case 1: if (D[REG.MCUCR] & 3) D[REG.GIFR] &= ~0x40; break;
      case 2: D[REG.GIFR] &= ~0x10; break;
      case 3: D[REG.GIFR] &= ~0x20; break;
      case 4: D[REG.WDTCSR] &= ~0x80; if (D[REG.WDTCSR] & 0x08) D[REG.WDTCSR] &= ~0x40; break;
      case 5: D[REG.TIFR1] &= ~0x20; break;
      case 6: D[REG.TIFR1] &= ~0x02; break;
      case 7: D[REG.TIFR1] &= ~0x04; break;
      case 8: D[REG.TIFR1] &= ~0x01; break;
      case 9: D[REG.TIFR0] &= ~0x02; break;
      case 10: D[REG.TIFR0] &= ~0x04; break;
      case 11: D[REG.TIFR0] &= ~0x01; break;
      case 12: D[REG.ACSR] &= ~0x10; break;
      case 13: D[REG.ADCSRA] &= ~0x10; break;
    }
    if (this.hooks.diag && this.op[v] === RJMP && this.ob[v] === this.badIrqAddr) {
      this.hooks.diag('badirq', { vector: v });
    }
    this.pushPC(this.pc);
    D[SREG] &= ~FI;
    this.pc = v;
    this.stats.irqCount[v]++;
    this.isrDepth++;
    if (this.hooks.isr) this.hooks.isr(this, v);
    this.advance(4);
  }

  // ---------------------------------------------------------------- upływ czasu

  // upływ n cykli; timery są doliczane dopiero, gdy minie cykl ich najbliższego tiku
  advance(n) {
    this.cycles += n;
    if (this.isrDepth) this.stats.isrCycles += n;
    if (this.cycles >= this.nextTick) this.timerCatchUp();
  }

  timerCatchUp() {
    const c = this.cycles;
    const clkIo = !this.sleeping || this.sleepMode === 0;
    const t0 = this.t0, t1 = this.t1;
    if (t0.div) while (t0.nextTick <= c) { if (clkIo) t0.tick(); t0.nextTick += t0.div; }
    if (t1.div) while (t1.nextTick <= c) { if (clkIo) t1.tick(); t1.nextTick += t1.div; }
    this.recalcTick();
  }

  // pierwszy cykl po bieżącym, w którym preskaler osiąga wielokrotność div
  nextBoundary(div) {
    return this.presBase + (Math.floor((this.cycles - this.presBase) / div) + 1) * div;
  }

  recalcTick() {
    this.nextTick = Math.min(this.t0.div ? this.t0.nextTick : Infinity, this.t1.div ? this.t1.nextTick : Infinity);
  }

  cyclesToTick() {
    if (this.sleeping && this.sleepMode !== 0) return Infinity;
    return Math.max(1, this.nextTick - this.cycles);
  }

  // ---------------------------------------------------------------- pętla wykonania

  // Wykonuje program do osiągnięcia cyklu `until`.
  // Zwraca null albo powód zatrzymania: 'bp' (pułapka), 'break' (instrukcja BREAK), 'step'.
  run(until, maxInstr = Infinity) {
    this.stopReason = null;
    this.updateGate();
    this.stats.instr += this.loop(until, maxInstr);
    return this.stopReason;
  }

  // właściwa pętla wykonania; za pętlą jest tylko "return", żeby wyjście z niej
  // nie cofało optymalizacji kodu skompilowanego w trakcie pętli (OSR)
  loop(until, maxInstr) {
    const D = this.data, bp = this.bp;
    const profMain = this.stats.profMain, profIsr = this.stats.profIsr;
    let count = 0;
    while (this.cycles < until) {
      if (this.cycles >= this.gate) {
        if (this.cycles >= this.nextEvent) this.processEvents();
        if (!this.powered || !this.clockOk) {
          this.cycles = Math.max(this.cycles, Math.ceil(Math.min(until, this.nextEvent)));
          this.updateGate();
          continue;
        }
        if (this.cycles < this.haltUntil) {
          const to = Math.min(until, this.nextEvent, this.haltUntil);
          this.advance(Math.max(1, Math.ceil(to - this.cycles)));
          this.updateGate();
          continue;
        }
        if (this.sleeping) {
          const v = this.irqVector();
          if (v) {
            this.sleeping = false;
            this.advance(this.sleepMode === 0 ? 4 : 10);
            if (this.hooks.pins) this.hooks.pins(this);
          } else {
            const step = Math.max(1, Math.min(this.cyclesToTick(), Math.ceil(Math.min(until, this.nextEvent) - this.cycles)));
            this.stats.sleepCycles += step;
            this.advance(step);
          }
          this.updateGate();
          continue;
        }
        this.updateGate();
      }
      if (this.irqHold) {
        this.irqHold = 0;
      } else if (this.irqDirty && (D[SREG] & FI)) {
        const v = this.irqVector();
        if (v) { this.enterIrq(v); continue; }
        this.irqDirty = false;
      }
      if (bp[this.pc] && this.bpCount) {
        if (!this.bpResume) { this.stopReason = 'bp'; break; }
      }
      if (this.bpResume) this.bpResume = false;
      const pc0 = this.pc, c0 = this.cycles, inIsr = this.isrDepth;
      this.exec();
      (inIsr ? profIsr : profMain)[pc0] += this.cycles - c0;
      count++;
      if (this.stopReason) break;
      if (count >= maxInstr) { this.stopReason = 'step'; break; }
    }
    return count;
  }

  setBreakpoints(addrs) {
    this.bp.fill(0);
    for (const a of addrs) this.bp[a & (FLASH_WORDS - 1)] = 1;
    this.bpCount = addrs.length;
  }

  exec() {
    const D = this.data;
    const pc = this.pc, a = this.oa[pc], b = this.ob[pc];
    let npc = pc + 1, n = 1;
    switch (this.op[pc]) {
      case 1: /* NOP */ break;
      case 2: /* MOVW */ D[a] = D[b]; D[a + 1] = D[b + 1]; break;
      case 5: /* ADD */ { const x = D[a], y = D[b], r = (x + y) & 0xFF; this.fAdd(x, y, r); D[a] = r; break; }
      case 9: /* ADC */ { const x = D[a], y = D[b], r = (x + y + (D[SREG] & 1)) & 0xFF; this.fAdd(x, y, r); D[a] = r; break; }
      case 8: /* SUB */ { const x = D[a], y = D[b], r = (x - y) & 0xFF; this.fSub(x, y, r, false); D[a] = r; break; }
      case 4: /* SBC */ { const x = D[a], y = D[b], r = (x - y - (D[SREG] & 1)) & 0xFF; this.fSub(x, y, r, true); D[a] = r; break; }
      case 16: /* SUBI */ { const x = D[a], r = (x - b) & 0xFF; this.fSub(x, b, r, false); D[a] = r; break; }
      case 15: /* SBCI */ { const x = D[a], r = (x - b - (D[SREG] & 1)) & 0xFF; this.fSub(x, b, r, true); D[a] = r; break; }
      case 7: /* CP */ { const x = D[a], y = D[b]; this.fSub(x, y, (x - y) & 0xFF, false); break; }
      case 3: /* CPC */ { const x = D[a], y = D[b]; this.fSub(x, y, (x - y - (D[SREG] & 1)) & 0xFF, true); break; }
      case 14: /* CPI */ { const x = D[a]; this.fSub(x, b, (x - b) & 0xFF, false); break; }
      case 10: /* AND */ { const r = D[a] & D[b]; D[a] = r; this.fLogic(r); break; }
      case 18: /* ANDI */ { const r = D[a] & b; D[a] = r; this.fLogic(r); break; }
      case 12: /* OR */ { const r = D[a] | D[b]; D[a] = r; this.fLogic(r); break; }
      case 17: /* ORI */ { const r = D[a] | b; D[a] = r; this.fLogic(r); break; }
      case 11: /* EOR */ { const r = D[a] ^ D[b]; D[a] = r; this.fLogic(r); break; }
      case 13: /* MOV */ D[a] = D[b]; break;
      case 74: /* LDI */ D[a] = b; break;
      case 6: /* CPSE */ if (D[a] === D[b]) { const s = this.is2(pc + 1) ? 2 : 1; npc += s; n += s; } break;
      case 79: /* SBRC */ if (!(D[a] & (1 << b))) { const s = this.is2(pc + 1) ? 2 : 1; npc += s; n += s; } break;
      case 80: /* SBRS */ if (D[a] & (1 << b)) { const s = this.is2(pc + 1) ? 2 : 1; npc += s; n += s; } break;
      case 67: /* SBIC */ if (!(this.rd(a) & (1 << b))) { const s = this.is2(pc + 1) ? 2 : 1; npc += s; n += s; } break;
      case 69: /* SBIS */ if (this.rd(a) & (1 << b)) { const s = this.is2(pc + 1) ? 2 : 1; npc += s; n += s; } break;
      case 68: /* SBI */ this.bitIo(a, b, true); n = 2; break;
      case 66: /* CBI */ this.bitIo(a, b, false); n = 2; break;
      case 70: /* IN */ D[a] = this.rd(b); break;
      case 71: /* OUT */ this.wr(b, D[a]); break;
      case 19: /* LDDZ */ D[a] = this.rd(((D[31] << 8) | D[30]) + b); n = 2; break;
      case 20: /* LDDY */ D[a] = this.rd(((D[29] << 8) | D[28]) + b); n = 2; break;
      case 21: /* STDZ */ this.wr(((D[31] << 8) | D[30]) + b, D[a]); n = 2; break;
      case 22: /* STDY */ this.wr(((D[29] << 8) | D[28]) + b, D[a]); n = 2; break;
      case 23: /* LDS */ D[a] = this.rd(b); npc = pc + 2; n = 2; break;
      case 34: /* STS */ this.wr(b, D[a]); npc = pc + 2; n = 2; break;
      case 30: /* LDX */ D[a] = this.rd((D[27] << 8) | D[26]); n = 2; break;
      case 31: /* LDXP */ { const x = (D[27] << 8) | D[26]; D[a] = this.rd(x); const y = (x + 1) & 0xFFFF; D[26] = y & 0xFF; D[27] = y >> 8; n = 2; break; }
      case 32: /* LDMX */ { const x = (((D[27] << 8) | D[26]) - 1) & 0xFFFF; D[26] = x & 0xFF; D[27] = x >> 8; D[a] = this.rd(x); n = 2; break; }
      case 28: /* LDYP */ { const x = (D[29] << 8) | D[28]; D[a] = this.rd(x); const y = (x + 1) & 0xFFFF; D[28] = y & 0xFF; D[29] = y >> 8; n = 2; break; }
      case 29: /* LDMY */ { const x = (((D[29] << 8) | D[28]) - 1) & 0xFFFF; D[28] = x & 0xFF; D[29] = x >> 8; D[a] = this.rd(x); n = 2; break; }
      case 24: /* LDZP */ { const x = (D[31] << 8) | D[30]; D[a] = this.rd(x); const y = (x + 1) & 0xFFFF; D[30] = y & 0xFF; D[31] = y >> 8; n = 2; break; }
      case 25: /* LDMZ */ { const x = (((D[31] << 8) | D[30]) - 1) & 0xFFFF; D[30] = x & 0xFF; D[31] = x >> 8; D[a] = this.rd(x); n = 2; break; }
      case 39: /* STX */ this.wr((D[27] << 8) | D[26], D[a]); n = 2; break;
      case 40: /* STXP */ { const x = (D[27] << 8) | D[26]; this.wr(x, D[a]); const y = (x + 1) & 0xFFFF; D[26] = y & 0xFF; D[27] = y >> 8; n = 2; break; }
      case 41: /* STMX */ { const x = (((D[27] << 8) | D[26]) - 1) & 0xFFFF; D[26] = x & 0xFF; D[27] = x >> 8; this.wr(x, D[a]); n = 2; break; }
      case 37: /* STYP */ { const x = (D[29] << 8) | D[28]; this.wr(x, D[a]); const y = (x + 1) & 0xFFFF; D[28] = y & 0xFF; D[29] = y >> 8; n = 2; break; }
      case 38: /* STMY */ { const x = (((D[29] << 8) | D[28]) - 1) & 0xFFFF; D[28] = x & 0xFF; D[29] = x >> 8; this.wr(x, D[a]); n = 2; break; }
      case 35: /* STZP */ { const x = (D[31] << 8) | D[30]; this.wr(x, D[a]); const y = (x + 1) & 0xFFFF; D[30] = y & 0xFF; D[31] = y >> 8; n = 2; break; }
      case 36: /* STMZ */ { const x = (((D[31] << 8) | D[30]) - 1) & 0xFFFF; D[30] = x & 0xFF; D[31] = x >> 8; this.wr(x, D[a]); n = 2; break; }
      case 60: /* LPM0 */ D[0] = this.lpm((D[31] << 8) | D[30]); n = 3; break;
      case 26: /* LPMZ */ D[a] = this.lpm((D[31] << 8) | D[30]); n = 3; break;
      case 27: /* LPMZP */ { const z = (D[31] << 8) | D[30]; D[a] = this.lpm(z); const y = (z + 1) & 0xFFFF; D[30] = y & 0xFF; D[31] = y >> 8; n = 3; break; }
      case 42: /* PUSH */ this.push(D[a]); n = 2; break;
      case 33: /* POP */ D[a] = this.pop(); n = 2; break;
      case 43: /* COM */ { const r = (~D[a]) & 0xFF; D[a] = r; this.fLogic(r); D[SREG] |= FC; break; }
      case 44: /* NEG */ {
        const x = D[a], r = (-x) & 0xFF;
        let s = D[SREG] & 0xC0;
        if ((r | x) & 0x08) s |= FH;
        if (r === 0x80) s |= FV;
        if (r !== 0) s |= FC;
        if (r & 0x80) s |= FN;
        if (((s >> 2) ^ (s >> 3)) & 1) s |= FS;
        if (r === 0) s |= FZ;
        D[SREG] = s; D[a] = r;
        break;
      }
      case 45: /* SWAP */ { const x = D[a]; D[a] = ((x << 4) | (x >> 4)) & 0xFF; break; }
      case 46: /* INC */ {
        const r = (D[a] + 1) & 0xFF;
        let s = D[SREG] & 0xE1;
        if (r === 0x80) s |= FV;
        if (r & 0x80) s |= FN;
        if (((s >> 2) ^ (s >> 3)) & 1) s |= FS;
        if (r === 0) s |= FZ;
        D[SREG] = s; D[a] = r;
        break;
      }
      case 50: /* DEC */ {
        const r = (D[a] - 1) & 0xFF;
        let s = D[SREG] & 0xE1;
        if (r === 0x7F) s |= FV;
        if (r & 0x80) s |= FN;
        if (((s >> 2) ^ (s >> 3)) & 1) s |= FS;
        if (r === 0) s |= FZ;
        D[SREG] = s; D[a] = r;
        break;
      }
      case 47: /* ASR */ { const x = D[a], r = (x >> 1) | (x & 0x80); D[a] = r; this.fShift(r, x & 1); break; }
      case 48: /* LSR */ { const x = D[a], r = x >> 1; D[a] = r; this.fShift(r, x & 1); break; }
      case 49: /* ROR */ { const x = D[a], r = (x >> 1) | ((D[SREG] & 1) << 7); D[a] = r; this.fShift(r, x & 1); break; }
      case 64: /* ADIW */ {
        const x = D[a] | (D[a + 1] << 8), r = (x + b) & 0xFFFF;
        let s = D[SREG] & 0xE0;
        if (~x & r & 0x8000) s |= FV;
        if (x & ~r & 0x8000) s |= FC;
        if (r & 0x8000) s |= FN;
        if (((s >> 2) ^ (s >> 3)) & 1) s |= FS;
        if (r === 0) s |= FZ;
        D[SREG] = s; D[a] = r & 0xFF; D[a + 1] = r >> 8; n = 2;
        break;
      }
      case 65: /* SBIW */ {
        const x = D[a] | (D[a + 1] << 8), r = (x - b) & 0xFFFF;
        let s = D[SREG] & 0xE0;
        if (x & ~r & 0x8000) s |= FV;
        if (r & ~x & 0x8000) s |= FC;
        if (r & 0x8000) s |= FN;
        if (((s >> 2) ^ (s >> 3)) & 1) s |= FS;
        if (r === 0) s |= FZ;
        D[SREG] = s; D[a] = r & 0xFF; D[a + 1] = r >> 8; n = 2;
        break;
      }
      case 53: /* BSET */ D[SREG] |= 1 << a; if (a === 7) this.irqHold = 1; break;
      case 54: /* BCLR */ D[SREG] &= ~(1 << a); break;
      case 78: /* BST */ if (D[a] & (1 << b)) D[SREG] |= FT; else D[SREG] &= ~FT; break;
      case 77: /* BLD */ if (D[SREG] & FT) D[a] |= 1 << b; else D[a] &= ~(1 << b); break;
      case 72: /* RJMP */ npc = b; n = 2; break;
      case 73: /* RCALL */ this.pushPC(pc + 1); npc = b; n = 3; break;
      case 51: /* JMP */ npc = b; n = 3; break;
      case 52: /* CALL */ this.pushPC(pc + 2); npc = b; n = 4; break;
      case 62: /* IJMP */ npc = (D[31] << 8) | D[30]; n = 2; break;
      case 63: /* ICALL */ this.pushPC(pc + 1); npc = (D[31] << 8) | D[30]; n = 3; break;
      case 55: /* RET */ npc = this.popPC(); n = 4; break;
      case 56: /* RETI */
        npc = this.popPC(); n = 4;
        D[SREG] |= FI;
        this.irqHold = 1;
        if (this.isrDepth > 0) this.isrDepth--;
        if (this.hooks.isr) this.hooks.isr(this, 0);
        break;
      case 75: /* BRBS */ if (D[SREG] & (1 << a)) { npc = b; n = 2; } break;
      case 76: /* BRBC */ if (!(D[SREG] & (1 << a))) { npc = b; n = 2; } break;
      case 57: /* SLEEP */
        if (D[REG.MCUCR] & 0x20) {
          this.sleeping = true;
          this.gate = -Infinity;
          this.sleepMode = (D[REG.MCUCR] >> 3) & 3;
          if (this.hooks.diag) this.hooks.diag('sleep', { mode: this.sleepMode });
        }
        break;
      case 59: /* WDR */ this.wdtReset(); break;
      case 58: /* BREAK */ this.stopReason = 'break'; break;
      case 61: /* SPM */ n = 4; break;
      default:
        if (this.hooks.diag) this.hooks.diag('illegal', { pc, word: this.flash[pc] });
    }
    if (pc === this.stopAddr && this.hooks.diag) this.hooks.diag('exit', {});
    if (npc === 0 && this.isrDepth) {
      // skok pod adres 0 (np. z __bad_interrupt) - program startuje od nowa bez RETI
      this.isrDepth = 0;
      if (this.hooks.isr) this.hooks.isr(this, 0);
    }
    this.pc = npc & (FLASH_WORDS - 1);
    this.advance(n);
  }

  // ---------------------------------------------------------------- pomocnicze dla interfejsu

  get sp() { return this.data[SPL]; }

  readIo16(name) {
    switch (name) {
      case 'TCNT1': return this.t1.cnt;
      case 'OCR1A': return this.t1.ocr[0];
      case 'OCR1B': return this.t1.ocr[1];
      case 'ICR1': return this.t1.icr;
    }
    return 0;
  }

  // odczyt rejestru I/O bez efektów ubocznych (dla podglądu)
  peekIo(name) {
    const D = this.data;
    switch (name) {
      case 'PINA': return this.lvl[0] & ~D[REG.DIDR0];
      case 'PINB': return this.lvl[1];
      case 'TCNT0': return this.t0.cnt;
      case 'OCR0A': return this.t0.ocr[0];
      case 'OCR0B': return this.t0.ocr[1];
    }
    return D[REG[name]];
  }
}
