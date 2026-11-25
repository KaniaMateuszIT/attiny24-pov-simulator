// bascom.js - translator podzbioru języka BASCOM-AVR na C (avr-gcc) dla ATtiny24
//
// Program w BASIC-u jest tłumaczony na C, a każda instrukcja dostaje dyrektywę #line,
// dzięki czemu błędy kompilatora i informacje dla debugera wskazują linie programu .bas.
// Zmienne globalne są "volatile" - tak jak w BASCOM-ie nie znikają przez optymalizację
// i można ich bezpiecznie używać w procedurach przerwań.

const TYPES = {
  BIT: { c: 'uint8_t', bits: 1, signed: false, bool: true },
  BYTE: { c: 'uint8_t', bits: 8, signed: false },
  INTEGER: { c: 'int16_t', bits: 16, signed: true },
  WORD: { c: 'uint16_t', bits: 16, signed: false },
  LONG: { c: 'int32_t', bits: 32, signed: true },
  DWORD: { c: 'uint32_t', bits: 32, signed: false },
  SINGLE: { c: 'float', bits: 32, signed: true, float: true },
};

// rejestry ATtiny24 dostępne pod swoimi nazwami (8 bit, chyba że podano 16)
const REGS = {};
for (const r of ('PORTA DDRA PINA PORTB DDRB PINB TCCR0A TCCR0B TCNT0 OCR0A OCR0B TIMSK0 TIFR0 TCCR1A TCCR1B TCCR1C ' +
  'TCNT1H TCNT1L OCR1AH OCR1AL OCR1BH OCR1BL ICR1H ICR1L TIMSK1 TIFR1 GIMSK GIFR MCUCR MCUSR PCMSK0 PCMSK1 WDTCSR ' +
  'CLKPR GTCCR PRR EECR EEDR EEARL ADMUX ADCSRA ADCSRB ADCL ADCH ACSR DIDR0 USICR USISR USIDR USIBR OSCCAL GPIOR0 ' +
  'GPIOR1 GPIOR2 SREG SPL').split(' ')) REGS[r] = { c: r, bits: 8 };
for (const r of ['TCNT1', 'OCR1A', 'OCR1B', 'ICR1', 'ADC', 'ADCW']) REGS[r] = { c: r, bits: 16 };
// nazwy zastępcze znane z BASCOM-a
Object.assign(REGS, {
  TIMER0: { c: 'TCNT0', bits: 8 }, COUNTER0: { c: 'TCNT0', bits: 8 },
  TIMER1: { c: 'TCNT1', bits: 16 }, COUNTER1: { c: 'TCNT1', bits: 16 },
  COMPARE0A: { c: 'OCR0A', bits: 8 }, COMPARE0B: { c: 'OCR0B', bits: 8 }, PWM0A: { c: 'OCR0A', bits: 8 }, PWM0B: { c: 'OCR0B', bits: 8 },
  COMPARE1A: { c: 'OCR1A', bits: 16 }, COMPARE1B: { c: 'OCR1B', bits: 16 }, PWM1A: { c: 'OCR1A', bits: 16 }, PWM1B: { c: 'OCR1B', bits: 16 },
  CAPTURE1: { c: 'ICR1', bits: 16 },
});

// nazwy bitów rejestrów (np. Tifr1.tov1, Gimsk.int0)
const BIT_NAMES = new Set(('PA0 PA1 PA2 PA3 PA4 PA5 PA6 PA7 PB0 PB1 PB2 PB3 DDA0 DDA1 DDA2 DDA3 DDA4 DDA5 DDA6 DDA7 DDB0 DDB1 ' +
  'DDB2 DDB3 PINA0 PINA1 PINA2 PINA3 PINA4 PINA5 PINA6 PINA7 PINB0 PINB1 PINB2 PINB3 TOV0 OCF0A OCF0B TOIE0 OCIE0A OCIE0B ' +
  'TOV1 OCF1A OCF1B ICF1 TOIE1 OCIE1A OCIE1B ICIE1 INT0 PCIE0 PCIE1 INTF0 PCIF0 PCIF1 ISC00 ISC01 SE SM0 SM1 PUD ' +
  'WGM00 WGM01 WGM02 WGM10 WGM11 WGM12 WGM13 CS00 CS01 CS02 CS10 CS11 CS12 COM0A0 COM0A1 COM0B0 COM0B1 COM1A0 COM1A1 ' +
  'COM1B0 COM1B1 ICES1 ICNC1 WDIF WDIE WDP0 WDP1 WDP2 WDP3 WDCE WDE PORF EXTRF BORF WDRF ADEN ADSC ADATE ADIF ADIE ' +
  'EERE EEPE EEMPE EERIE PSR10 TSM CLKPCE PRADC PRUSI PRTIM0 PRTIM1').split(' '));

const VECTORS = {
  INT0: ['INT0_vect', 'GIMSK', 'INT0'], PCINT0: ['PCINT0_vect', 'GIMSK', 'PCIE0'], PCINT1: ['PCINT1_vect', 'GIMSK', 'PCIE1'],
  WDT: ['WDT_vect', 'WDTCSR', 'WDIE'], WATCHDOG: ['WDT_vect', 'WDTCSR', 'WDIE'],
  ICP1: ['TIM1_CAPT_vect', 'TIMSK1', 'ICIE1'], CAPTURE1: ['TIM1_CAPT_vect', 'TIMSK1', 'ICIE1'],
  COMPARE1A: ['TIM1_COMPA_vect', 'TIMSK1', 'OCIE1A'], OC1A: ['TIM1_COMPA_vect', 'TIMSK1', 'OCIE1A'],
  COMPARE1B: ['TIM1_COMPB_vect', 'TIMSK1', 'OCIE1B'], OC1B: ['TIM1_COMPB_vect', 'TIMSK1', 'OCIE1B'],
  TIMER1: ['TIM1_OVF_vect', 'TIMSK1', 'TOIE1'], OVF1: ['TIM1_OVF_vect', 'TIMSK1', 'TOIE1'],
  COMPARE0A: ['TIM0_COMPA_vect', 'TIMSK0', 'OCIE0A'], OC0A: ['TIM0_COMPA_vect', 'TIMSK0', 'OCIE0A'],
  COMPARE0B: ['TIM0_COMPB_vect', 'TIMSK0', 'OCIE0B'], OC0B: ['TIM0_COMPB_vect', 'TIMSK0', 'OCIE0B'],
  TIMER0: ['TIM0_OVF_vect', 'TIMSK0', 'TOIE0'], OVF0: ['TIM0_OVF_vect', 'TIMSK0', 'TOIE0'],
  ADC: ['ADC_vect', 'ADCSRA', 'ADIE'], ACI: ['ANA_COMP_vect', 'ACSR', 'ACIE'],
};

const KEYWORDS = new Set(('IF THEN ELSE ELSEIF END DO LOOP UNTIL WHILE WEND FOR TO STEP NEXT SELECT CASE IS SUB FUNCTION ' +
  'DIM AS CONST CONFIG GOSUB GOTO RETURN ON ENABLE DISABLE START STOP RESET SET TOGGLE INCR DECR WAITMS WAITUS WAIT ' +
  'AND OR XOR NOT MOD CALL DECLARE LOCAL BYVAL BYREF EXIT DATA RESTORE READ LOOKUP SHIFT ROTATE BITWAIT DEBOUNCE ' +
  'REM ALIAS SWAP NOP IDLE POWERDOWN PRINT WRITEEEPROM READEEPROM').split(' '));

class BasError extends Error {
  constructor(line, msg) { super(msg); this.line = line; }
}

// ---------------------------------------------------------------- lekser

function lexLine(text, line) {
  const toks = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t') { i++; continue; }
    if (ch === "'") break;
    if (ch === '"') {
      const j = text.indexOf('"', i + 1);
      if (j < 0) throw new BasError(line, 'Niezamknięty cudzysłów w napisie');
      toks.push({ t: 'str', v: text.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (ch === '&' && /[hHbB]/.test(text[i + 1] || '')) {
      const hex = /[hH]/.test(text[i + 1]);
      const m = text.slice(i + 2).match(hex ? /^[0-9a-fA-F]+/ : /^[01]+/);
      if (!m) throw new BasError(line, `Błędny zapis liczby: ${text.slice(i, i + 6)}`);
      toks.push({ t: 'num', v: parseInt(m[0], hex ? 16 : 2), text: (hex ? '0x' : '0b') + m[0].toUpperCase() });
      i += 2 + m[0].length;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(text[i + 1] || '') && !(toks.length && toks[toks.length - 1].t === 'id'))) {
      const m = text.slice(i).match(/^[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?|^[0-9]+/);
      const s = m[0];
      toks.push({ t: 'num', v: parseFloat(s), text: s, float: /[.eE]/.test(s) });
      i += s.length;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const m = text.slice(i).match(/^[A-Za-z_$][A-Za-z0-9_]*/);
      const w = m[0];
      if (w.toUpperCase() === 'REM') break;
      toks.push({ t: 'id', v: w, u: w.toUpperCase() });
      i += w.length;
      continue;
    }
    const two = text.substr(i, 2);
    if (two === '<>' || two === '<=' || two === '>=') { toks.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/\\^=<>(),.;:'.includes(ch)) { toks.push({ t: ch === ':' ? 'sep' : 'op', v: ch }); i++; continue; }
    throw new BasError(line, `Niedozwolony znak „${ch}”`);
  }
  return toks;
}

// ---------------------------------------------------------------- parser instrukcji

class TokStream {
  constructor(toks, line) { this.toks = toks; this.i = 0; this.line = line; }
  peek(o = 0) { return this.toks[this.i + o]; }
  next() { return this.toks[this.i++]; }
  done() { return this.i >= this.toks.length; }
  isKw(u, o = 0) { const t = this.peek(o); return t && t.t === 'id' && t.u === u; }
  isOp(v, o = 0) { const t = this.peek(o); return t && t.t === 'op' && t.v === v; }
  acceptKw(u) { if (this.isKw(u)) { this.i++; return true; } return false; }
  acceptOp(v) { if (this.isOp(v)) { this.i++; return true; } return false; }
  expectKw(u, msg) { if (!this.acceptKw(u)) throw new BasError(this.line, msg || `Oczekiwano słowa ${u}`); }
  expectOp(v, msg) { if (!this.acceptOp(v)) throw new BasError(this.line, msg || `Oczekiwano „${v}”`); }
  ident(msg) {
    const t = this.next();
    if (!t || t.t !== 'id') throw new BasError(this.line, msg || 'Oczekiwano nazwy');
    return t;
  }
  rest() { return this.toks.slice(this.i); }
}

const PREC = { OR: 1, XOR: 1, AND: 2, '=': 4, '<>': 4, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '\\': 6, MOD: 6 };

function parseExpr(ts, minPrec = 0) {
  let left = parseUnary(ts);
  for (;;) {
    const t = ts.peek();
    if (!t) break;
    const op = t.t === 'op' ? t.v : t.t === 'id' ? t.u : null;
    const p = PREC[op];
    if (p === undefined || p < minPrec) break;
    ts.next();
    const right = parseExpr(ts, p + 1);
    left = { k: 'bin', op, l: left, r: right };
  }
  return left;
}

function parseUnary(ts) {
  if (ts.acceptKw('NOT')) return { k: 'not', e: parseExpr(ts, 3) };
  if (ts.acceptOp('-')) return { k: 'neg', e: parseUnary(ts) };
  if (ts.acceptOp('+')) return parseUnary(ts);
  return parsePrimary(ts);
}

function parsePrimary(ts) {
  const t = ts.next();
  if (!t) throw new BasError(ts.line, 'Niepełne wyrażenie');
  if (t.t === 'num') return { k: 'num', v: t.v, text: t.text, float: t.float };
  if (t.t === 'str') return { k: 'str', v: t.v };
  if (t.t === 'op' && t.v === '(') {
    const e = parseExpr(ts);
    ts.expectOp(')', 'Brakuje nawiasu zamykającego )');
    return { k: 'paren', e };
  }
  if (t.t === 'id') {
    let node = { k: 'name', name: t.v, u: t.u };
    if (ts.isOp('(')) {
      ts.next();
      const args = [];
      if (!ts.isOp(')')) {
        do { args.push(parseExpr(ts)); } while (ts.acceptOp(','));
      }
      ts.expectOp(')', 'Brakuje nawiasu zamykającego )');
      node = { k: 'call', name: t.v, u: t.u, args };
    }
    if (ts.isOp('.')) {
      ts.next();
      const b = ts.next();
      if (!b) throw new BasError(ts.line, 'Po kropce oczekiwano numeru bitu');
      let bit;
      if (b.t === 'num') bit = { k: 'num', v: b.v, text: String(b.v) };
      else if (b.t === 'id') bit = { k: 'bitname', name: b.v, u: b.u };
      else if (b.t === 'op' && b.v === '(') { bit = parseExpr(ts); ts.expectOp(')'); }
      else throw new BasError(ts.line, 'Po kropce oczekiwano numeru bitu');
      node = { k: 'bit', base: node, bit };
    }
    return node;
  }
  throw new BasError(ts.line, `Nieoczekiwany symbol „${t.v}”`);
}

// ---------------------------------------------------------------- translator

export function transpile(src) {
  return new Translator(src).run();
}

class Translator {
  constructor(src) {
    this.src = src.replace(/\r/g, '');
    this.errors = [];
    this.warnings = [];
    this.fcpu = 8000000;
    this.vars = new Map();      // nazwa (wielkie litery) -> { c, type, arr, name }
    this.consts = new Map();
    this.aliases = new Map();
    this.labels = new Map();    // nazwa -> { name, line, kind: 'main'|'sub'|'data', fn }
    this.subs = new Map();      // nazwa -> { name, params, ret, line, body }
    this.vectors = new Map();   // nazwa wektora C -> etykieta
    this.dataTables = [];
    this.timerCfg = { 0: null, 1: null };
    this.wdtMs = null;
    this.arrayBase = 1;
    this.debounceMs = 25;
    this.uid = 0;
    this.helpers = new Set();
    this.scope = null;          // bieżąca procedura (zmienne lokalne)
    this.fnName = 'main';
  }

  err(line, msg) { this.errors.push({ line, msg }); }
  warn(line, msg) { this.warnings.push({ line, msg }); }

  run() {
    let stmts = [];
    try {
      stmts = this.splitStatements();
    } catch (e) {
      if (e instanceof BasError) this.err(e.line, e.message); else throw e;
      return this.result('');
    }
    // deklaracje (Dim, Const, Alias, Declare, Sub/Function, etykiety) - pierwszy przebieg
    let nodes;
    try {
      nodes = this.parseBlock(stmts, { i: 0 }, null);
    } catch (e) {
      if (e instanceof BasError) { this.err(e.line, e.message); return this.result(''); }
      throw e;
    }
    this.collectDecls(nodes);
    const { main, routines } = this.organize(nodes);
    let c = '';
    try {
      c = this.generate(main, routines);
    } catch (e) {
      if (e instanceof BasError) this.err(e.line, e.message); else throw e;
    }
    return this.result(c);
  }

  result(c) {
    const vars = [];
    for (const v of this.vars.values()) vars.push({ c: v.c, name: v.name, type: v.typeName, arr: v.arr || 0 });
    return { ok: this.errors.length === 0, c, errors: this.errors, warnings: this.warnings, fcpu: this.fcpu, vars };
  }

  // podział na instrukcje: { line, toks, label?, dir? }
  splitStatements() {
    const out = [];
    const lines = this.src.split('\n');
    for (let n = 0; n < lines.length; n++) {
      const line = n + 1;
      let text = lines[n];
      const lm = text.match(/^\s*([A-Za-z_][A-Za-z0-9_]*):(?=\s|$|')/);
      if (lm && !KEYWORDS.has(lm[1].toUpperCase())) {
        out.push({ line, label: lm[1] });
        text = text.slice(lm[0].length);
      }
      const dm = text.match(/^\s*\$(\w+)\s*(?:=\s*(.*?))?\s*(?:'.*)?$/);
      if (dm) {
        out.push({ line, dir: dm[1].toUpperCase(), value: (dm[2] || '').trim() });
        continue;
      }
      const toks = lexLine(text, line);
      // instrukcje rozdzielone dwukropkiem; jednowierszowe If zabiera resztę linii
      let cur = [];
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (t.t === 'sep') {
          const isIf = cur.length && cur[0].t === 'id' && cur[0].u === 'IF' && cur.some(x => x.t === 'id' && x.u === 'THEN') &&
            cur[cur.length - 1].u !== 'THEN';
          if (isIf) { cur.push(t); continue; }
          if (cur.length) out.push({ line, toks: cur });
          cur = [];
        } else {
          cur.push(t);
        }
      }
      if (cur.length) out.push({ line, toks: cur });
    }
    return out;
  }

  // ---------------------------------------------------------------- struktura blokowa

  parseBlock(stmts, pos, endFn, ctx = null) {
    const body = [];
    while (pos.i < stmts.length) {
      const s = stmts[pos.i];
      if (endFn && s.toks && endFn(s)) return body;
      if (ctx && s.toks && isCloser(s.toks)) {
        const found = s.toks.slice(0, 2).filter(t => t.t === 'id').map(t => t.v).join(' ');
        throw new BasError(ctx.line, `Brak ${ctx.expected} dla ${ctx.what} z linii ${ctx.line} (w linii ${s.line} jest ${found})`);
      }
      pos.i++;
      if (s.label) { body.push({ k: 'label', name: s.label, line: s.line }); continue; }
      if (s.dir) { body.push({ k: 'dir', dir: s.dir, value: s.value, line: s.line }); continue; }
      body.push(this.parseStatement(s, stmts, pos));
    }
    if (endFn) return Object.assign(body, { unterminated: true });
    return body;
  }

  block(stmts, pos, startLine, ends, what, expected) {
    const body = this.parseBlock(stmts, pos, (s) => ends.some(e => matchStart(s.toks, e)), { line: startLine, what, expected });
    if (body.unterminated) throw new BasError(startLine, `Brak ${expected} dla ${what} z linii ${startLine}`);
    return body;
  }

  parseStatement(s, stmts, pos) {
    const ts = new TokStream(s.toks, s.line);
    const line = s.line;
    const first = ts.peek();
    if (first.t !== 'id') throw new BasError(line, `Instrukcja nie może zaczynać się od „${first.v}”`);
    const kw = first.u;

    switch (kw) {
      case 'IF': {
        ts.next();
        const condToks = [];
        while (!ts.done() && !ts.isKw('THEN')) condToks.push(ts.next());
        if (!ts.acceptKw('THEN')) throw new BasError(line, 'Brak słowa Then w instrukcji If');
        const cond = this.exprOf(condToks, line);
        if (!ts.done()) {
          // If ... Then instrukcje [Else instrukcje] w jednej linii
          const rest = ts.rest();
          let elseAt = rest.findIndex(t => t.t === 'id' && t.u === 'ELSE');
          const thenToks = elseAt < 0 ? rest : rest.slice(0, elseAt);
          const elseToks = elseAt < 0 ? [] : rest.slice(elseAt + 1);
          return { k: 'if', line, arms: [{ cond, body: this.inline(thenToks, line) }], els: elseAt < 0 ? null : this.inline(elseToks, line) };
        }
        const arms = [];
        let els = null;
        let cur = { cond, body: null };
        for (;;) {
          cur.body = this.block(stmts, pos, line, [['ELSEIF'], ['ELSE'], ['END', 'IF'], ['ENDIF']], 'If', 'End If');
          arms.push(cur);
          const st = stmts[pos.i++];
          const t2 = new TokStream(st.toks, st.line);
          if (t2.acceptKw('ELSEIF')) {
            const ct = [];
            while (!t2.done() && !t2.isKw('THEN')) ct.push(t2.next());
            if (!t2.acceptKw('THEN')) throw new BasError(st.line, 'Brak słowa Then w ElseIf');
            cur = { cond: this.exprOf(ct, st.line), body: null };
            continue;
          }
          if (t2.acceptKw('ELSE')) {
            els = this.block(stmts, pos, st.line, [['END', 'IF'], ['ENDIF']], 'Else', 'End If');
            pos.i++;
          }
          break;
        }
        return { k: 'if', line, arms, els };
      }
      case 'DO': {
        ts.next();
        let pre = null;
        if (ts.acceptKw('WHILE')) pre = { cond: this.exprOf(ts.rest(), line), until: false };
        else if (ts.acceptKw('UNTIL')) pre = { cond: this.exprOf(ts.rest(), line), until: true };
        const body = this.block(stmts, pos, line, [['LOOP']], 'Do', 'Loop');
        const st = stmts[pos.i++];
        const t2 = new TokStream(st.toks, st.line);
        t2.next();
        let post = null;
        if (t2.acceptKw('UNTIL')) post = { cond: this.exprOf(t2.rest(), st.line), until: true };
        else if (t2.acceptKw('WHILE')) post = { cond: this.exprOf(t2.rest(), st.line), until: false };
        return { k: 'do', line, pre, post, body };
      }
      case 'WHILE': {
        ts.next();
        const cond = this.exprOf(ts.rest(), line);
        const body = this.block(stmts, pos, line, [['WEND']], 'While', 'Wend');
        pos.i++;
        return { k: 'while', line, cond, body };
      }
      case 'FOR': {
        ts.next();
        const v = ts.ident('Po For oczekiwano nazwy zmiennej');
        ts.expectOp('=', 'Oczekiwano „=” w pętli For');
        const fromT = [];
        while (!ts.done() && !ts.isKw('TO') && !ts.isKw('DOWNTO')) fromT.push(ts.next());
        let down = false;
        if (ts.acceptKw('DOWNTO')) down = true; else ts.expectKw('TO', 'Brak słowa To w pętli For');
        const toT = [];
        while (!ts.done() && !ts.isKw('STEP')) toT.push(ts.next());
        let step = null;
        if (ts.acceptKw('STEP')) step = this.exprOf(ts.rest(), line);
        const body = this.block(stmts, pos, line, [['NEXT']], 'For', 'Next');
        pos.i++;
        return { k: 'for', line, v, from: this.exprOf(fromT, line), to: this.exprOf(toT, line), step, down, body };
      }
      case 'SELECT': {
        ts.next();
        ts.expectKw('CASE', 'Oczekiwano Select Case');
        const expr = this.exprOf(ts.rest(), line);
        const cases = [];
        let els = null;
        // pomiń puste linie do pierwszego Case
        const firstBody = this.block(stmts, pos, line, [['CASE'], ['END', 'SELECT']], 'Select Case', 'Case');
        if (firstBody.length) throw new BasError(line, 'Po Select Case musi być Case');
        for (;;) {
          const st = stmts[pos.i++];
          const t2 = new TokStream(st.toks, st.line);
          if (t2.isKw('END')) break;
          t2.expectKw('CASE');
          if (t2.acceptKw('ELSE')) {
            els = this.block(stmts, pos, line, [['END', 'SELECT']], 'Select Case', 'End Select');
            pos.i++;
            break;
          }
          const conds = [];
          const parts = splitTop(t2.rest(), ',');
          for (const p of parts) {
            const pt = new TokStream(p, st.line);
            if (pt.acceptKw('IS')) {
              const op = pt.next();
              if (!op || op.t !== 'op' || !['=', '<>', '<', '>', '<=', '>='].includes(op.v)) throw new BasError(st.line, 'Po Case Is oczekiwano porównania');
              conds.push({ is: op.v, e: this.exprOf(pt.rest(), st.line) });
            } else {
              const toAt = p.findIndex(x => x.t === 'id' && x.u === 'TO');
              if (toAt >= 0) conds.push({ lo: this.exprOf(p.slice(0, toAt), st.line), hi: this.exprOf(p.slice(toAt + 1), st.line) });
              else conds.push({ eq: this.exprOf(p, st.line) });
            }
          }
          const body = this.block(stmts, pos, line, [['CASE'], ['END', 'SELECT']], 'Select Case', 'End Select');
          cases.push({ conds, body, line: st.line });
        }
        return { k: 'select', line, expr, cases, els };
      }
      case 'SUB': case 'FUNCTION': {
        ts.next();
        const name = ts.ident('Oczekiwano nazwy procedury').v;
        const params = this.parseParams(ts, line);
        let ret = null;
        if (kw === 'FUNCTION') {
          ts.expectKw('AS', 'Funkcja musi mieć typ: Function Nazwa(...) As Byte');
          ret = this.typeOf(ts.ident('Oczekiwano typu').u, line);
        }
        const body = this.block(stmts, pos, line, [['END', kw]], kw === 'SUB' ? 'Sub' : 'Function', kw === 'SUB' ? 'End Sub' : 'End Function');
        pos.i++;
        return { k: 'subdef', line, name, params, ret, isFn: kw === 'FUNCTION', body };
      }
      case 'ELSE': case 'ELSEIF': case 'ENDIF': case 'LOOP': case 'WEND': case 'NEXT': case 'CASE':
        throw new BasError(line, `${first.v} bez odpowiadającego początku bloku`);
      case 'END':
        if (ts.isKw('IF', 1) || ts.isKw('SELECT', 1) || ts.isKw('SUB', 1) || ts.isKw('FUNCTION', 1)) {
          throw new BasError(line, `End ${ts.peek(1).v} bez odpowiadającego początku bloku`);
        }
        return { k: 'end', line };
    }
    return this.parseSimple(ts, line);
  }

  inline(toks, line) {
    return splitTop(toks, ':', 'sep').filter(p => p.length).map(p => this.parseSimple(new TokStream(p, line), line));
  }

  exprOf(toks, line) {
    if (!toks.length) throw new BasError(line, 'Brakuje wyrażenia');
    const ts = new TokStream(toks, line);
    const e = parseExpr(ts);
    if (!ts.done()) throw new BasError(line, `Nieoczekiwane „${ts.peek().v}” w wyrażeniu`);
    return e;
  }

  parseParams(ts, line) {
    const params = [];
    if (!ts.acceptOp('(')) return params;
    if (ts.acceptOp(')')) return params;
    do {
      let byref = false;
      if (ts.acceptKw('BYVAL')) byref = false;
      else if (ts.acceptKw('BYREF')) byref = true;
      const n = ts.ident('Oczekiwano nazwy parametru').v;
      ts.expectKw('AS', `Parametr ${n} musi mieć typ (np. ${n} As Byte)`);
      const type = this.typeOf(ts.ident().u, line);
      params.push({ name: n, type, byref });
    } while (ts.acceptOp(','));
    ts.expectOp(')');
    return params;
  }

  typeOf(u, line) {
    if (u === 'STRING') throw new BasError(line, 'Typ String nie jest obsługiwany (ATtiny24 ma tylko 128 B RAM)');
    const t = TYPES[u];
    if (!t) throw new BasError(line, `Nieznany typ „${u}” (dostępne: Bit, Byte, Integer, Word, Long, Dword, Single)`);
    return Object.assign({ name: u }, t);
  }

  // instrukcje jednowierszowe
  parseSimple(ts, line) {
    const t = ts.peek();
    const kw = t.u;
    const node = (k, o) => Object.assign({ k, line }, o);
    switch (kw) {
      case 'DIM': {
        ts.next();
        const decls = [];
        do {
          const n = ts.ident('Oczekiwano nazwy zmiennej').v;
          let arr = 0;
          if (ts.acceptOp('(')) {
            const sz = ts.next();
            if (!sz || sz.t !== 'num') throw new BasError(line, 'Rozmiar tablicy musi być liczbą');
            arr = sz.v;
            ts.expectOp(')');
          }
          ts.expectKw('AS', `Brak typu zmiennej: Dim ${n} As Byte`);
          if (ts.acceptKw('ERAM') || ts.acceptKw('SRAM') || ts.acceptKw('XRAM')) this.warn(line, 'Eram/Sram pominięto - zmienna jest w RAM');
          const type = this.typeOf(ts.ident('Oczekiwano typu').u, line);
          if (ts.acceptOp('*')) ts.next();
          decls.push({ name: n, arr, type });
        } while (ts.acceptOp(','));
        return node('dim', { decls });
      }
      case 'LOCAL': {
        ts.next();
        const n = ts.ident().v;
        ts.expectKw('AS', `Brak typu zmiennej: Local ${n} As Byte`);
        return node('local', { name: n, type: this.typeOf(ts.ident().u, line) });
      }
      case 'CONST': {
        ts.next();
        const n = ts.ident().v;
        ts.expectOp('=', 'Oczekiwano Const Nazwa = wartość');
        return node('const', { name: n, e: this.exprOf(ts.rest(), line) });
      }
      case 'DECLARE': return node('nop');
      case 'CONFIG': return this.parseConfig(ts, line);
      case 'GOSUB': ts.next(); return node('gosub', { target: ts.ident('Oczekiwano nazwy etykiety').v });
      case 'GOTO': ts.next(); return node('goto', { target: ts.ident('Oczekiwano nazwy etykiety').v });
      case 'RETURN': return node('return');
      case 'ON': {
        ts.next();
        const src = ts.ident('Oczekiwano nazwy przerwania (np. On Int0 Etykieta)').u;
        if (!VECTORS[src]) throw new BasError(line, `Nieznane przerwanie „${src}”. Dostępne: Int0, Pcint0, Pcint1, Timer0, Timer1, Compare1a, Compare1b, Compare0a, Compare0b, Capture1, Wdt, Adc`);
        const target = ts.ident('Oczekiwano etykiety procedury przerwania').v;
        ts.acceptKw('NOSAVE'); ts.acceptKw('SAVEALL');
        return node('on', { src, target });
      }
      case 'ENABLE': case 'DISABLE': {
        ts.next();
        return node(kw === 'ENABLE' ? 'enable' : 'disable', { what: ts.ident('Oczekiwano nazwy przerwania').u });
      }
      case 'START': case 'STOP': {
        ts.next();
        if (ts.done()) return node('stop');
        return node(kw === 'START' ? 'start' : 'halt', { what: ts.ident().u });
      }
      case 'RESET': case 'SET': case 'TOGGLE': case 'INCR': case 'DECR': {
        ts.next();
        if (kw === 'RESET' && ts.isKw('WATCHDOG')) return node('wdr');
        return node(kw.toLowerCase(), { target: this.exprOf(ts.rest(), line) });
      }
      case 'WAITMS': case 'WAITUS': case 'WAIT': ts.next(); return node(kw.toLowerCase(), { e: this.exprOf(ts.rest(), line) });
      case 'EXIT': ts.next(); return node('exit', { what: ts.ident('Exit For / Do / While / Sub / Function').u });
      case 'CALL': {
        ts.next();
        const n = ts.ident('Oczekiwano nazwy procedury').v;
        let args = [];
        if (ts.acceptOp('(')) {
          if (!ts.isOp(')')) args = splitTop(collectUntilClose(ts, line), ',').map(p => this.exprOf(p, line));
          else ts.next();
        }
        return node('call', { name: n, args });
      }
      case 'DATA': {
        ts.next();
        const vals = splitTop(ts.rest(), ',').map(p => this.exprOf(p, line));
        return node('data', { vals });
      }
      case 'RESTORE': ts.next(); return node('restore', { target: ts.ident().v });
      case 'READ': ts.next(); return node('read', { target: this.exprOf(ts.rest(), line) });
      case 'SHIFT': case 'ROTATE': {
        ts.next();
        const parts = splitTop(ts.rest(), ',');
        if (parts.length < 2) throw new BasError(line, `${t.v} zmienna, Left|Right [, ile]`);
        const dir = parts[1][0] && parts[1][0].u;
        if (dir !== 'LEFT' && dir !== 'RIGHT') throw new BasError(line, 'Kierunek musi być Left albo Right');
        return node(kw.toLowerCase(), { target: this.exprOf(parts[0], line), left: dir === 'LEFT', n: parts[2] ? this.exprOf(parts[2], line) : { k: 'num', v: 1, text: '1' } });
      }
      case 'BITWAIT': {
        ts.next();
        const parts = splitTop(ts.rest(), ',');
        const st = parts[1] && parts[1][0] && parts[1][0].u;
        if (st !== 'SET' && st !== 'RESET') throw new BasError(line, 'Bitwait Pinb.2, Set|Reset');
        return node('bitwait', { target: this.exprOf(parts[0], line), set: st === 'SET' });
      }
      case 'DEBOUNCE': {
        ts.next();
        const parts = splitTop(ts.rest(), ',');
        if (parts.length < 3) throw new BasError(line, 'Debounce Pinb.2, 0, Etykieta [, Sub]');
        return node('debounce', { pin: this.exprOf(parts[0], line), state: this.exprOf(parts[1], line), target: parts[2][0].v, sub: !!(parts[3] && parts[3][0] && parts[3][0].u === 'SUB') });
      }
      case 'SWAP': {
        ts.next();
        const parts = splitTop(ts.rest(), ',');
        return node('swap', { a: this.exprOf(parts[0], line), b: parts[1] ? this.exprOf(parts[1], line) : null });
      }
      case 'WRITEEEPROM': case 'READEEPROM': {
        ts.next();
        const parts = splitTop(ts.rest(), ',');
        if (parts.length < 2) throw new BasError(line, `${t.v} zmienna, adres`);
        return node(kw === 'WRITEEEPROM' ? 'eewrite' : 'eeread', { v: this.exprOf(parts[0], line), addr: this.exprOf(parts[1], line) });
      }
      case 'NOP': return node('asmnop');
      case 'IDLE': return node('sleep', { mode: 'SLEEP_MODE_IDLE' });
      case 'POWERDOWN': case 'POWERSAVE': return node('sleep', { mode: 'SLEEP_MODE_PWR_DOWN' });
      case 'PRINT': case 'INPUT': case 'LCD': case 'CLS': case 'LOCATE':
        throw new BasError(line, `${t.v} - stanowisko nie ma wyświetlacza ani portu szeregowego (ATtiny24 nie ma UART)`);
    }
    // Nazwa Alias Portb.0
    if (ts.isKw('ALIAS', 1)) {
      const n = ts.next().v;
      ts.next();
      return node('alias', { name: n, e: this.exprOf(ts.rest(), line) });
    }
    // przypisanie: cel = wyrażenie
    const eqAt = findTopOp(ts.toks, '=');
    if (eqAt > 0) {
      return node('assign', { target: this.exprOf(ts.toks.slice(0, eqAt), line), e: this.exprOf(ts.toks.slice(eqAt + 1), line) });
    }
    // wywołanie procedury bez Call: Nazwa arg1, arg2  albo Nazwa(arg1, arg2)
    if (t.t === 'id') {
      ts.next();
      let argToks = ts.rest();
      if (argToks.length && argToks[0].t === 'op' && argToks[0].v === '(' && argToks[argToks.length - 1].v === ')') argToks = argToks.slice(1, -1);
      const args = argToks.length ? splitTop(argToks, ',').map(p => this.exprOf(p, line)) : [];
      return node('call', { name: t.v, args, implicit: true });
    }
    throw new BasError(line, 'Nierozpoznana instrukcja');
  }

  parseConfig(ts, line) {
    ts.next();
    const what = ts.ident('Oczekiwano: Config Porta / Timer0 / Timer1 / Int0 / Watchdog ...');
    let bit = null;
    if (ts.acceptOp('.')) {
      const b = ts.next();
      bit = b.t === 'num' ? b.v : b.u;
    }
    ts.expectOp('=', 'Oczekiwano „=” po Config ...');
    const parts = splitTop(ts.rest(), ',');
    const opts = {};
    const first = parts.shift();
    for (const p of parts) {
      const eq = p.findIndex(x => x.t === 'op' && x.v === '=');
      if (eq < 0) throw new BasError(line, 'Opcja Config musi mieć postać Nazwa = wartość');
      opts[p.slice(0, eq).map(x => x.u || x.v).join(' ')] = p.slice(eq + 1);
    }
    return { k: 'config', line, what: what.u, bit, value: first, opts };
  }

  // ---------------------------------------------------------------- deklaracje

  collectDecls(nodes, inSub = null) {
    for (const n of nodes) {
      switch (n.k) {
        case 'dim':
          if (inSub) { this.err(n.line, 'Wewnątrz Sub/Function używaj Local zamiast Dim'); break; }
          for (const d of n.decls) this.declareVar(d, n.line);
          break;
        case 'const':
          this.consts.set(n.name.toUpperCase(), { c: 'C_' + n.name.toUpperCase(), e: n.e, line: n.line });
          break;
        case 'alias':
          this.aliases.set(n.name.toUpperCase(), n.e);
          break;
        case 'label':
          if (this.labels.has(n.name.toUpperCase())) this.err(n.line, `Etykieta ${n.name} jest zdefiniowana dwa razy`);
          this.labels.set(n.name.toUpperCase(), { name: n.name, line: n.line, c: 'L_' + n.name.toLowerCase(),
            kind: inSub ? 'inner' : undefined, fn: inSub ? '#SUB' : undefined });
          break;
        case 'subdef':
          if (this.subs.has(n.name.toUpperCase())) this.err(n.line, `Procedura ${n.name} jest zdefiniowana dwa razy`);
          this.subs.set(n.name.toUpperCase(), { name: n.name, params: n.params, ret: n.ret, isFn: n.isFn, node: n, c: (n.isFn ? 'F_' : 'S_') + n.name.toLowerCase() });
          this.collectDecls(n.body, n);
          break;
        case 'dir':
          this.directive(n);
          break;
        case 'config':
          if (n.what === 'BASE') this.arrayBase = this.constVal(n.value, n.line);
          if (n.what === 'DEBOUNCE') this.debounceMs = this.constVal(n.value, n.line);
          break;
        case 'if':
          for (const a of n.arms) this.collectDecls(a.body, inSub);
          if (n.els) this.collectDecls(n.els, inSub);
          break;
        case 'do': case 'while': case 'for':
          this.collectDecls(n.body, inSub);
          break;
        case 'select':
          for (const c of n.cases) this.collectDecls(c.body, inSub);
          if (n.els) this.collectDecls(n.els, inSub);
          break;
      }
    }
  }

  declareVar(d, line) {
    const u = d.name.toUpperCase();
    if (this.vars.has(u)) { this.err(line, `Zmienna ${d.name} jest zadeklarowana dwa razy`); return; }
    if (REGS[u]) { this.err(line, `Nazwa ${d.name} jest zarezerwowana dla rejestru`); return; }
    this.vars.set(u, { c: 'v_' + d.name.toLowerCase(), type: d.type, typeName: d.type.name, arr: d.arr, name: d.name });
  }

  directive(n) {
    switch (n.dir) {
      case 'REGFILE': {
        const f = n.value.replace(/"/g, '').toLowerCase();
        this.hasRegfile = true;
        if (!/^attiny24a?\.dat$/.test(f) && !/^tn24a?def\.dat$/.test(f)) {
          this.err(n.line, `Stanowisko ma mikrokontroler ATtiny24 - użyj $regfile = "attiny24.dat" (podano ${n.value})`);
        }
        break;
      }
      case 'CRYSTAL': {
        const v = parseInt(n.value, 10);
        if (!v) { this.err(n.line, '$crystal = częstotliwość w Hz, np. $crystal = 8000000'); break; }
        this.fcpu = v;
        if (v !== 8000000) this.warn(n.line, `$crystal = ${v}, a układ na stanowisku pracuje z 8 MHz (fusebit CKDIV8 wyłączony) - opóźnienia będą złe`);
        break;
      }
      case 'HWSTACK': case 'SWSTACK': case 'FRAMESIZE': case 'SIM': case 'BAUD': case 'PROG': case 'NOINIT': case 'NORAMCLEAR':
        break;
      default:
        this.warn(n.line, `Dyrektywa $${n.dir.toLowerCase()} została pominięta`);
    }
  }

  constVal(toks, line) {
    const e = this.exprOf(toks, line);
    const v = this.evalConst(e);
    if (v === null) throw new BasError(line, 'Oczekiwano stałej liczbowej');
    return v;
  }

  evalConst(e) {
    switch (e.k) {
      case 'num': return e.v;
      case 'paren': return this.evalConst(e.e);
      case 'neg': { const v = this.evalConst(e.e); return v === null ? null : -v; }
      case 'name': { const c = this.consts.get(e.u); return c ? this.evalConst(c.e) : null; }
      case 'bin': {
        const a = this.evalConst(e.l), b = this.evalConst(e.r);
        if (a === null || b === null) return null;
        switch (e.op) {
          case '+': return a + b; case '-': return a - b; case '*': return a * b;
          case '/': case '\\': return Math.trunc(a / b); case 'MOD': return a % b;
          case 'AND': return a & b; case 'OR': return a | b; case 'XOR': return a ^ b;
        }
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- organizacja programu

  organize(nodes) {
    // etykiety wywoływane przez Gosub / On ... stają się procedurami; etykiety z Data - tablicami
    const called = new Set();
    const walk = (list) => {
      for (const n of list) {
        if (n.k === 'gosub') called.add(n.target.toUpperCase());
        if (n.k === 'on') called.add(n.target.toUpperCase());
        if (n.k === 'debounce' && n.sub) called.add(n.target.toUpperCase());
        for (const key of ['body', 'els']) if (Array.isArray(n[key])) walk(n[key]);
        if (n.arms) for (const a of n.arms) walk(a.body);
        if (n.cases) for (const c of n.cases) walk(c.body);
      }
    };
    walk(nodes);
    const main = [];
    const routines = [];
    let cur = null;
    let afterEnd = false;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.k === 'subdef') continue;
      if (n.k === 'label') {
        const u = n.name.toUpperCase();
        const isData = nodes[i + 1] && nodes[i + 1].k === 'data';
        if (isData) {
          const vals = [];
          let j = i + 1;
          while (nodes[j] && nodes[j].k === 'data') { vals.push(...nodes[j].vals.map(v => ({ v, line: nodes[j].line }))); j++; }
          this.addData(n, vals);
          i = j - 1;
          cur = null;
          continue;
        }
        if (called.has(u)) {
          cur = { label: n, body: [] };
          routines.push(cur);
          this.labels.get(u).kind = 'sub';
          continue;
        }
        if (cur) { cur.body.push(n); this.labels.get(u).fn = cur.label.name.toUpperCase(); continue; }
        if (afterEnd) {
          this.warn(n.line, `Etykieta ${n.name} leży za End i nie jest wywoływana przez Gosub - kod pod nią nie wykona się`);
          continue;
        }
        this.labels.get(u).kind = 'main';
        main.push(n);
        continue;
      }
      if (n.k === 'data') { this.err(n.line, 'Data musi stać bezpośrednio pod etykietą (np. Tabela: Data 1, 2, 3)'); continue; }
      if (cur) { cur.body.push(n); continue; }
      if (afterEnd) {
        if (!['dim', 'const', 'alias', 'nop', 'dir'].includes(n.k)) this.warn(n.line, 'Ta instrukcja leży za End i nigdy się nie wykona');
        else main.push(n);
        continue;
      }
      main.push(n);
      if (n.k === 'end') afterEnd = true;
    }
    return { main, routines };
  }

  addData(labelNode, vals) {
    const bytes = [];
    for (const { v, line } of vals) {
      if (v.k === 'str') { for (const ch of v.v) bytes.push(ch.charCodeAt(0) & 0xFF); continue; }
      const x = this.evalConst(v);
      if (x === null) { this.err(line, 'Data przyjmuje tylko stałe liczby'); continue; }
      if (x < 0 || x > 255 || !Number.isInteger(x)) { this.err(line, `Wartość ${x} w Data nie mieści się w bajcie (0-255)`); continue; }
      bytes.push(x);
    }
    const u = labelNode.name.toUpperCase();
    const c = 'D_' + labelNode.name.toLowerCase();
    this.labels.get(u).kind = 'data';
    this.labels.get(u).c = c;
    this.dataTables.push({ c, bytes, line: labelNode.line, name: labelNode.name });
  }

  // ---------------------------------------------------------------- generowanie C

  generate(main, routines) {
    const out = [];
    const body = [];
    const routinesC = [];
    // procedury Sub/Function
    const subsC = [];
    for (const s of this.subs.values()) subsC.push(this.genSub(s));
    // etykiety Gosub / przerwania
    for (const r of routines) {
      const lab = this.labels.get(r.label.name.toUpperCase());
      this.fnName = r.label.name.toUpperCase();
      const code = this.genBlock(r.body, 1);
      const last = r.body[r.body.length - 1];
      if (!r.body.some(hasReturn)) this.err(r.label.line, `Procedura ${r.label.name} nie kończy się instrukcją Return`);
      void last;
      routinesC.push(`static void ${lab.c}(void) {\n${code}}\n`);
    }
    this.fnName = 'main';
    const mainCode = this.genBlock(main, 1);

    out.push('// Wygenerowano automatycznie z programu w BASCOM-AVR (program.bas) przez symulator ATtiny24.');
    out.push('#include <avr/io.h>', '#include <avr/interrupt.h>', '#include <avr/pgmspace.h>', '#include <avr/eeprom.h>',
      '#include <avr/wdt.h>', '#include <avr/sleep.h>', '#include <util/delay.h>', '#include <util/delay_basic.h>', '#include <stdint.h>', '');
    out.push(HELPERS);
    for (const c of this.consts.values()) {
      out.push(`#line ${c.line} "program.bas"`);
      out.push(`#define ${c.c} (${this.expr(c.e)})`);
    }
    for (const v of this.vars.values()) {
      const t = v.type;
      out.push(`volatile ${t.c} ${v.c}${v.arr ? `[${v.arr + (this.arrayBase === 0 ? 1 : 0)}]` : ''};`);
    }
    for (const d of this.dataTables) {
      out.push(`#line ${d.line} "program.bas"`);
      out.push(`static const uint8_t ${d.c}[] PROGMEM = { ${d.bytes.join(', ')} };`);
    }
    for (const s of this.subs.values()) out.push(this.subProto(s) + ';');
    for (const r of routines) out.push(`static void ${this.labels.get(r.label.name.toUpperCase()).c}(void);`);
    out.push('');
    out.push('int main(void) {');
    out.push(mainCode);
    out.push('  cli();');
    out.push('  for (;;) {}');
    out.push('}', '');
    out.push(...subsC, ...routinesC);
    for (const [vec, lab] of this.vectors) {
      const l = this.labels.get(lab.toUpperCase());
      if (!l) continue;
      out.push(`ISR(${vec}) { ${l.c}(); }`);
    }
    if (!this.hasRegfile) this.warn(1, 'Brak $regfile - przyjęto $regfile = "attiny24.dat"');
    void body;
    return out.join('\n') + '\n';
  }

  subProto(s) {
    const ps = s.params.map(p => p.byref ? `volatile ${p.type.c} *p_${p.name.toLowerCase()}` : `${p.type.c} p_${p.name.toLowerCase()}`);
    return `static ${s.isFn ? s.ret.c : 'void'} ${s.c}(${ps.length ? ps.join(', ') : 'void'})`;
  }

  genSub(s) {
    const prevScope = this.scope;
    this.scope = { sub: s, locals: new Map() };
    for (const p of s.params) this.scope.locals.set(p.name.toUpperCase(), { c: p.byref ? `(*p_${p.name.toLowerCase()})` : `p_${p.name.toLowerCase()}`, type: p.type });
    this.fnName = s.name.toUpperCase();
    let decl = '';
    if (s.isFn) {
      this.scope.locals.set(s.name.toUpperCase(), { c: 'r_result', type: s.ret });
      decl += `  ${s.ret.c} r_result = 0;\n`;
    }
    const code = this.genBlock(s.node.body, 1);
    const tail = s.isFn ? '  return r_result;\n' : '';
    this.scope = prevScope;
    this.fnName = 'main';
    return `${this.subProto(s)} {\n${decl}${code}${tail}}\n`;
  }

  genBlock(nodes, depth) {
    let s = '';
    for (const n of nodes) s += this.genStmt(n, depth);
    return s;
  }

  genStmt(n, d) {
    const ind = '  '.repeat(d);
    const L = n.line ? `#line ${n.line} "program.bas"\n` : '';
    const w = (code) => L + code.split('\n').map(x => ind + x).join('\n') + '\n';
    try {
      switch (n.k) {
        case 'dim': case 'const': case 'alias': case 'nop': case 'dir': case 'subdef': case 'data': case 'on_decl':
          return '';
        case 'local': {
          if (!this.scope) throw new BasError(n.line, 'Local można użyć tylko wewnątrz Sub/Function');
          const c = 'l_' + n.name.toLowerCase();
          this.scope.locals.set(n.name.toUpperCase(), { c, type: n.type });
          return w(`${n.type.c} ${c} = 0;`);
        }
        case 'label': {
          const l = this.labels.get(n.name.toUpperCase());
          return `${l.c}: ;\n`;
        }
        case 'end': return w('cli();\nfor (;;) {}');
        case 'stop': return w('cli();\nfor (;;) {}');
        case 'config': return w(this.genConfig(n));
        case 'assign': return w(this.genAssign(n.target, n.e, n.line));
        case 'set': return w(this.genAssign(n.target, { k: 'num', v: 1, text: '1' }, n.line));
        case 'reset': return w(this.genAssign(n.target, { k: 'num', v: 0, text: '0' }, n.line));
        case 'toggle': {
          const t = this.lvalue(n.target, n.line);
          if (t.bit !== undefined) return w(`${t.reg} ^= (uint8_t)(1 << (${t.bit}));`);
          if (t.type && t.type.bool) return w(`${t.c} ^= 1;`);
          return w(`${t.c} = ~${t.c};`);
        }
        case 'incr': case 'decr': {
          const t = this.lvalue(n.target, n.line);
          if (t.bit !== undefined) throw new BasError(n.line, `${n.k === 'incr' ? 'Incr' : 'Decr'} nie działa na pojedynczym bicie`);
          return w(`${t.c}${n.k === 'incr' ? '++' : '--'};`);
        }
        case 'waitms': this.helpers.add('waitms'); return w(`bas_waitms(${this.expr(n.e)});`);
        case 'waitus': {
          const v = this.evalConst(n.e);
          if (v !== null) return w(`_delay_us(${v});`);
          return w(`bas_waitus(${this.expr(n.e)});`);
        }
        case 'wait': return w(`bas_wait(${this.expr(n.e)});`);
        case 'if': {
          let s = '';
          n.arms.forEach((a, i) => {
            s += `${i ? '} else if' : 'if'} (${this.cond(a.cond)}) {\n${this.genBlock(a.body, 1)}`;
          });
          if (n.els) s += `} else {\n${this.genBlock(n.els, 1)}`;
          s += '}';
          return L + indentBlock(s, ind);
        }
        case 'do': {
          let s;
          if (n.pre) s = `while (${n.pre.until ? '!' : ''}(${this.cond(n.pre.cond)})) {\n${this.genBlock(n.body, 1)}}`;
          else if (n.post) s = `do {\n${this.genBlock(n.body, 1)}} while (${n.post.until ? '!' : ''}(${this.cond(n.post.cond)}));`;
          else s = `for (;;) {\n${this.genBlock(n.body, 1)}}`;
          return L + indentBlock(s, ind);
        }
        case 'while':
          return L + indentBlock(`while (${this.cond(n.cond)}) {\n${this.genBlock(n.body, 1)}}`, ind);
        case 'for': {
          // pętla sprawdza koniec przed zwiększeniem licznika - działa też dla For I = 0 To 255
          // i For I = 7 To 0 Step -1 na zmiennej typu Byte (zwykłe for w C by się zapętliło)
          const v = this.lvalue({ k: 'name', name: n.v.v, u: n.v.u }, n.line);
          const stepConst = n.step ? this.evalConst(n.step) : (n.down ? -1 : 1);
          const neg = stepConst !== null ? stepConst < 0 : false;
          const step = n.step ? this.expr(n.step) : (n.down ? '-1' : '1');
          const id = ++this.uid;
          const end = `e_${id}`;
          const cmp = neg ? `${v.c} >= ${end}` : `${v.c} <= ${end}`;
          const last = neg ? `(${v.c} - ${end}) < -(${step})` : `(${end} - ${v.c}) < (${step})`;
          const s = `{\n  const __typeof__(${v.c}) ${end} = ${this.expr(n.to)};\n  ${v.c} = ${this.expr(n.from)};\n` +
            `  if (${cmp}) for (;;) {\n${indentBlock(this.genBlock(n.body, 1), '  ')}    if (${last}) break;\n    ${v.c} += ${step};\n  }\n}`;
          return L + indentBlock(s, ind);
        }
        case 'select': {
          const tmp = `sel_${++this.uid}`;
          let s = `{\n  const __typeof__(${this.expr(n.expr)}) ${tmp} = ${this.expr(n.expr)};\n`;
          n.cases.forEach((c, i) => {
            const conds = c.conds.map(x => {
              if (x.is) return `${tmp} ${cmpOp(x.is)} (${this.expr(x.e)})`;
              if (x.lo) return `(${tmp} >= (${this.expr(x.lo)}) && ${tmp} <= (${this.expr(x.hi)}))`;
              return `${tmp} == (${this.expr(x.eq)})`;
            }).join(' || ');
            s += `  ${i ? '} else if' : 'if'} (${conds}) {\n${indentBlock(this.genBlock(c.body, 1), '  ')}`;
          });
          if (n.els) s += n.cases.length ? `  } else {\n${indentBlock(this.genBlock(n.els, 1), '  ')}  }\n` : `${indentBlock(this.genBlock(n.els, 1), '  ')}`;
          else if (n.cases.length) s += '  }\n';
          s += '}';
          return L + indentBlock(s, ind);
        }
        case 'exit': {
          if (n.what === 'SUB' || n.what === 'FUNCTION') {
            if (!this.scope) throw new BasError(n.line, `Exit ${n.what === 'SUB' ? 'Sub' : 'Function'} poza procedurą`);
            return w(n.what === 'FUNCTION' ? 'return r_result;' : 'return;');
          }
          return w('break;');
        }
        case 'gosub': {
          const l = this.labels.get(n.target.toUpperCase());
          if (!l) throw new BasError(n.line, `Nie ma etykiety ${n.target}`);
          if (l.kind === 'data') throw new BasError(n.line, `${n.target} to tablica Data, nie procedura`);
          return w(`${l.c}();`);
        }
        case 'goto': {
          const l = this.labels.get(n.target.toUpperCase());
          if (!l) throw new BasError(n.line, `Nie ma etykiety ${n.target}`);
          const fn = l.kind === 'main' ? 'MAIN' : l.fn || l.name.toUpperCase();
          const here = this.scope ? '#SUB' : this.fnName === 'main' ? 'MAIN' : this.fnName;
          if (l.kind === 'sub' || fn !== here) throw new BasError(n.line, `Goto ${n.target} wyskakuje poza bieżącą procedurę - w symulatorze można skakać tylko w obrębie tej samej części programu`);
          return w(`goto ${l.c};`);
        }
        case 'return':
          if (this.fnName === 'main' && !this.scope) throw new BasError(n.line, 'Return poza procedurą wywołaną przez Gosub lub przerwanie');
          return w(this.scope && this.scope.sub.isFn ? 'return r_result;' : 'return;');
        case 'on': {
          const v = VECTORS[n.src][0];
          const l = this.labels.get(n.target.toUpperCase());
          if (!l) throw new BasError(n.line, `Nie ma etykiety ${n.target}`);
          if (this.vectors.has(v) && this.vectors.get(v).toUpperCase() !== n.target.toUpperCase()) throw new BasError(n.line, `Przerwanie ${n.src} ma już procedurę ${this.vectors.get(v)}`);
          this.vectors.set(v, n.target);
          return '';
        }
        case 'enable': case 'disable': {
          if (n.what === 'INTERRUPTS') return w(n.k === 'enable' ? 'sei();' : 'cli();');
          const v = VECTORS[n.what];
          if (!v) throw new BasError(n.line, `Nieznane przerwanie ${n.what}`);
          return w(n.k === 'enable' ? `${v[1]} |= _BV(${v[2]});` : `${v[1]} &= ~_BV(${v[2]});`);
        }
        case 'start': case 'halt': {
          const on = n.k === 'start';
          if (n.what === 'TIMER0' || n.what === 'TIMER1') {
            const t = n.what === 'TIMER0' ? 0 : 1;
            const cfg = this.timerCfg[t];
            if (on && !cfg) throw new BasError(n.line, `Najpierw Config ${n.what === 'TIMER0' ? 'Timer0' : 'Timer1'} = Timer, Prescale = ...`);
            const reg = t ? 'TCCR1B' : 'TCCR0B';
            return w(on ? `${reg} = (${reg} & ~7) | ${cfg.cs};` : `${reg} &= ~7;`);
          }
          if (n.what === 'WATCHDOG') {
            if (on && !this.wdtMs) throw new BasError(n.line, 'Najpierw Config Watchdog = czas_ms');
            return w(on ? `wdt_enable(${this.wdtMs});` : 'wdt_disable();');
          }
          if (n.what === 'ADC') return w(on ? 'ADCSRA |= _BV(ADEN);' : 'ADCSRA &= ~_BV(ADEN);');
          throw new BasError(n.line, `Start/Stop: nieznany blok ${n.what}`);
        }
        case 'wdr': return w('wdt_reset();');
        case 'call': return w(this.genCall(n.name, n.args, n.line, true) + ';');
        case 'restore': {
          const l = this.labels.get(n.target.toUpperCase());
          if (!l || l.kind !== 'data') throw new BasError(n.line, `Restore: ${n.target} nie jest etykietą z Data`);
          return w(`bas_dp = ${l.c};`);
        }
        case 'read': return w(this.genAssignRaw(n.target, 'pgm_read_byte(bas_dp++)', n.line));
        case 'shift': case 'rotate': {
          const t = this.lvalue(n.target, n.line);
          const k = this.expr(n.n);
          if (n.k === 'shift') return w(`${t.c} ${n.left ? '<<=' : '>>='} ${k};`);
          const bits = t.type ? t.type.bits : 8;
          const ct = t.type ? t.type.c : 'uint8_t';
          return w(n.left
            ? `${t.c} = (${ct})((${t.c} << (${k})) | (${t.c} >> (${bits} - (${k}))));`
            : `${t.c} = (${ct})((${t.c} >> (${k})) | (${t.c} << (${bits} - (${k}))));`);
        }
        case 'bitwait': {
          const e = this.expr(n.target);
          return w(n.set ? `while (!(${e})) {}` : `while (${e}) {}`);
        }
        case 'debounce': {
          const id = ++this.uid;
          const l = this.labels.get(n.target.toUpperCase());
          if (!l) throw new BasError(n.line, `Nie ma etykiety ${n.target}`);
          const pin = this.expr(n.pin), st = this.expr(n.state);
          const act = n.sub ? `${l.c}();` : `goto ${l.c};`;
          return w(`{\n  static uint8_t db_${id};\n  if ((${pin}) == (${st})) {\n    if (!db_${id}) {\n      bas_waitms(${this.debounceMs});\n      if ((${pin}) == (${st})) { db_${id} = 1; ${act} }\n    }\n  } else {\n    db_${id} = 0;\n  }\n}`);
        }
        case 'swap': {
          const a = this.lvalue(n.a, n.line);
          if (!n.b) return w(`${a.c} = (uint8_t)((${a.c} << 4) | (${a.c} >> 4));`);
          const b = this.lvalue(n.b, n.line);
          return w(`{ __typeof__(${a.c}) t_ = ${a.c}; ${a.c} = ${b.c}; ${b.c} = t_; }`);
        }
        case 'eewrite': {
          const t = this.lvalue(n.v, n.line);
          const bytes = t.type ? Math.max(1, t.type.bits / 8) : 1;
          return w(`{ __typeof__(${t.c}) t_ = ${t.c}; eeprom_update_block((const void *)&t_, (void *)(uint16_t)(${this.expr(n.addr)}), ${bytes}); }`);
        }
        case 'eeread': {
          const t = this.lvalue(n.v, n.line);
          const bytes = t.type ? Math.max(1, t.type.bits / 8) : 1;
          return w(`{ __typeof__(${t.c}) t_; eeprom_read_block((void *)&t_, (const void *)(uint16_t)(${this.expr(n.addr)}), ${bytes}); ${t.c} = t_; }`);
        }
        case 'asmnop': return w('__asm__ volatile ("nop");');
        case 'sleep': return w(`set_sleep_mode(${n.mode});\nsleep_mode();`);
      }
      throw new BasError(n.line, 'Nieobsługiwana instrukcja');
    } catch (e) {
      if (e instanceof BasError) { this.err(e.line || n.line, e.message); return ''; }
      throw e;
    }
  }

  genCall(name, args, line, stmt) {
    const s = this.subs.get(name.toUpperCase());
    if (!s) {
      if (this.labels.has(name.toUpperCase())) throw new BasError(line, `${name} to etykieta - użyj Gosub ${name}`);
      throw new BasError(line, `Nieznana instrukcja lub procedura „${name}”`);
    }
    if (stmt && s.isFn) this.warn(line, `Wynik funkcji ${name} nie jest wykorzystany`);
    if (args.length !== s.params.length) throw new BasError(line, `${name} oczekuje ${s.params.length} argumentów, podano ${args.length}`);
    const a = args.map((x, i) => {
      if (s.params[i].byref) {
        const lv = this.lvalue(x, line);
        if (lv.bit !== undefined) throw new BasError(line, 'Nie można przekazać bitu przez referencję (ByRef)');
        return `&${lv.c}`;
      }
      return this.expr(x);
    });
    return `${s.c}(${a.join(', ')})`;
  }

  genConfig(n) {
    const line = n.line;
    const vu = n.value.length === 1 && n.value[0].t === 'id' ? n.value[0].u : null;
    const portMatch = n.what.match(/^(PORT|PIN|DDR)([AB])$/);
    if (portMatch) {
      const ddr = 'DDR' + portMatch[2];
      if (n.bit !== null) {
        const b = typeof n.bit === 'number' ? n.bit : n.bit;
        if (vu === 'OUTPUT') return `${ddr} |= _BV(${b});`;
        if (vu === 'INPUT') return `${ddr} &= ~_BV(${b});`;
        throw new BasError(line, `Config ${n.what.charAt(0)}${n.what.slice(1).toLowerCase()}.${b} = Output albo Input`);
      }
      if (vu === 'OUTPUT') return `${ddr} = 0xFF;`;
      if (vu === 'INPUT') return `${ddr} = 0x00;`;
      return `${ddr} = ${this.expr(this.exprOf(n.value, line))};`;
    }
    const opt = (name) => n.opts[name] ? n.opts[name].map(t => t.u || String(t.v)).join(' ') : null;
    switch (n.what) {
      case 'TIMER0': case 'TIMER1': {
        const t = n.what === 'TIMER0' ? 0 : 1;
        const ps = opt('PRESCALE');
        const csMap = { '1': 1, '8': 2, '64': 3, '256': 4, '1024': 5 };
        const cs = ps === null ? 1 : csMap[ps];
        if (cs === undefined) throw new BasError(line, 'Prescale musi być 1, 8, 64, 256 albo 1024');
        this.timerCfg[t] = { cs };
        let a = 0, b = cs;
        const out = [];
        const com = (v, isPwm) => {
          if (!v) return 0;
          if (isPwm) return v === 'CLEAR UP' ? 2 : v === 'CLEAR DOWN' ? 3 : 0;
          return { TOGGLE: 1, CLEAR: 2, SET: 3, DISCONNECT: 0 }[v] ?? 0;
        };
        if (vu === 'TIMER') {
          if (opt('CLEAR TIMER') === '1') {
            if (t === 0) a |= 2; else b |= 8;   // CTC: WGM01 / WGM12
          }
          a |= com(opt('COMPARE A'), false) << (t ? 6 : 6);
          a |= com(opt('COMPARE B'), false) << 4;
          if (t === 1) {
            if (opt('CAPTURE EDGE') === 'RISING') b |= 0x40;
            if (opt('NOISE CANCEL') === '1') b |= 0x80;
          }
        } else if (vu === 'PWM') {
          if (t === 0) a |= 1;   // phase correct, TOP = 0xFF
          else {
            const bits = opt('PWM') || '8';
            a |= { '8': 1, '9': 2, '10': 3 }[bits] ?? 1;
          }
          a |= com(opt('COMPARE A PWM'), true) << 6;
          a |= com(opt('COMPARE B PWM'), true) << 4;
        } else if (vu === 'COUNTER') {
          const edge = opt('EDGE');
          b = (b & ~7) | (edge === 'RISING' ? 7 : 6);
          this.timerCfg[t] = { cs: b & 7 };
        } else {
          throw new BasError(line, `Config ${n.what === 'TIMER0' ? 'Timer0' : 'Timer1'} = Timer | Pwm | Counter`);
        }
        return t === 0 ? `TCCR0A = 0x${hex2(a)};\nTCCR0B = 0x${hex2(b)};` : `TCCR1A = 0x${hex2(a)};\nTCCR1B = 0x${hex2(b)};`;
      }
      case 'INT0': {
        const v = n.value.map(t => t.u).join(' ');
        const isc = { 'LOW LEVEL': 0, CHANGE: 1, FALLING: 2, RISING: 3 }[v];
        if (isc === undefined) throw new BasError(line, 'Config Int0 = Falling | Rising | Change | Low Level');
        return `MCUCR = (MCUCR & ~3) | ${isc};`;
      }
      case 'WATCHDOG': {
        const ms = this.constVal(n.value, line);
        const map = { 16: 'WDTO_15MS', 32: 'WDTO_30MS', 64: 'WDTO_60MS', 128: 'WDTO_120MS', 256: 'WDTO_250MS', 512: 'WDTO_500MS',
          1024: 'WDTO_1S', 2048: 'WDTO_2S', 4096: 'WDTO_4S', 8192: 'WDTO_8S' };
        if (!map[ms]) throw new BasError(line, 'Config Watchdog = 16, 32, 64, 128, 256, 512, 1024, 2048, 4096 albo 8192 (ms)');
        this.wdtMs = map[ms];
        return '';
      }
      case 'ADC': {
        return 'ADMUX = 0;\nADCSRA = _BV(ADEN) | _BV(ADPS2) | _BV(ADPS1);';
      }
      case 'CLOCKDIV': {
        const v = this.constVal(n.value, line);
        const ps = Math.log2(v);
        if (!Number.isInteger(ps) || ps < 0 || ps > 8) throw new BasError(line, 'Config Clockdiv = 1, 2, 4, ... 256');
        return `CLKPR = _BV(CLKPCE);\nCLKPR = ${ps};`;
      }
      case 'BASE': case 'DEBOUNCE': return '';
    }
    throw new BasError(line, `Nieobsługiwane Config ${n.what}`);
  }

  // ---------------------------------------------------------------- wyrażenia

  resolveName(u, name, line) {
    if (this.scope && this.scope.locals.has(u)) { const l = this.scope.locals.get(u); return { kind: 'var', c: l.c, type: l.type }; }
    if (this.consts.has(u)) return { kind: 'const', c: this.consts.get(u).c };
    if (this.aliases.has(u)) return { kind: 'alias', e: this.aliases.get(u) };
    if (this.vars.has(u)) { const v = this.vars.get(u); return { kind: 'var', c: v.c, type: v.type, arr: v.arr }; }
    if (REGS[u]) return { kind: 'reg', c: REGS[u].c, type: { c: REGS[u].bits === 16 ? 'uint16_t' : 'uint8_t', bits: REGS[u].bits } };
    if (this.subs.has(u)) return { kind: 'fn', s: this.subs.get(u) };
    throw new BasError(line, `Nieznana nazwa „${name}” - brakuje Dim ${name} As ...? (BASCOM wymaga deklaracji zmiennych)`);
  }

  bitIndex(bitNode, line) {
    if (bitNode.k === 'bitname') {
      if (BIT_NAMES.has(bitNode.u)) return bitNode.u;
      throw new BasError(line, `Nieznana nazwa bitu „${bitNode.name}”`);
    }
    if (bitNode.k === 'num') {
      if (bitNode.v < 0 || bitNode.v > 31) throw new BasError(line, `Numer bitu ${bitNode.v} poza zakresem`);
      return String(bitNode.v);
    }
    return `(${this.expr(bitNode)})`;
  }

  // miejsce zapisu: { c, type } albo bit { reg, bit }
  lvalue(e, line) {
    if (e.k === 'paren') return this.lvalue(e.e, line);
    if (e.k === 'name') {
      const r = this.resolveName(e.u, e.name, line);
      if (r.kind === 'alias') return this.lvalue(r.e, line);
      if (r.kind === 'const') throw new BasError(line, `${e.name} jest stałą (Const) - nie można jej zmienić`);
      if (r.kind === 'fn') throw new BasError(line, `${e.name} jest procedurą`);
      if (r.arr) throw new BasError(line, `${e.name} jest tablicą - podaj indeks, np. ${e.name}(1)`);
      if (r.kind === 'reg' && /^PIN[AB]$/.test(r.c)) this.warn(line, `Zapis do ${r.c} przełącza bity PORT${r.c[3]} (tak działa ATtiny24)`);
      return { c: r.c, type: r.type };
    }
    if (e.k === 'call') {
      const r = this.resolveName(e.u, e.name, line);
      if (r.kind === 'alias') return this.lvalue(r.e, line);
      if (r.kind !== 'var' || !r.arr) throw new BasError(line, `${e.name}(...) - ${e.name} nie jest tablicą`);
      if (e.args.length !== 1) throw new BasError(line, 'Tablice są jednowymiarowe');
      return { c: `${r.c}[${this.arrIndex(e.args[0], r.arr, line)}]`, type: r.type };
    }
    if (e.k === 'bit') {
      const base = this.lvalue(e.base, line);
      return { reg: base.c, bit: this.bitIndex(e.bit, line), c: base.c };
    }
    throw new BasError(line, 'Tu musi być zmienna, rejestr albo bit (np. Portb.0)');
  }

  arrIndex(idx, size, line) {
    const v = this.evalConst(idx);
    if (v !== null) {
      const lo = this.arrayBase, hi = this.arrayBase === 0 ? size : size;
      if (v < lo || v > hi) this.warn(line, `Indeks ${v} jest poza tablicą (${lo}..${hi}) - zapis nadpisze inne zmienne`);
    }
    return this.arrayBase === 1 ? `(${this.expr(idx)}) - 1` : this.expr(idx);
  }

  genAssign(target, e, line) {
    return this.genAssignRaw(target, null, line, e);
  }

  genAssignRaw(target, rawC, line, e = null) {
    const t = this.lvalue(target, line);
    const val = rawC !== null ? rawC : this.expr(e);
    if (t.bit !== undefined) {
      const k = e ? this.evalConst(e) : null;
      if (k === 1) return `${t.reg} |= (uint8_t)(1 << ${t.bit});`;
      if (k === 0) return `${t.reg} &= (uint8_t)~(1 << ${t.bit});`;
      return `if (${val}) ${t.reg} |= (uint8_t)(1 << ${t.bit}); else ${t.reg} &= (uint8_t)~(1 << ${t.bit});`;
    }
    if (t.type && t.type.bool) return `${t.c} = (${val}) ? 1 : 0;`;
    if (e && t.type && !t.type.float && e.k === 'num') {
      const max = t.type.signed ? 2 ** (t.type.bits - 1) - 1 : 2 ** t.type.bits - 1;
      const min = t.type.signed ? -(2 ** (t.type.bits - 1)) : 0;
      if (e.v > max || e.v < min) this.warn(line, `Wartość ${e.v} nie mieści się w typie ${t.type.name || 'rejestru'} (${min}..${max})`);
    }
    return `${t.c} = ${val};`;
  }

  cond(e) {
    return this.expr(e);
  }

  isBool(e) {
    if (e.k === 'paren') return this.isBool(e.e);
    if (e.k === 'bin') return ['=', '<>', '<', '>', '<=', '>='].includes(e.op) || (['AND', 'OR', 'XOR'].includes(e.op) && this.isBool(e.l) && this.isBool(e.r));
    if (e.k === 'not') return this.isBool(e.e);
    if (e.k === 'bit') return true;
    if (e.k === 'name') {
      try {
        const r = this.resolveName(e.u, e.name, 0);
        if (r.kind === 'alias') return this.isBool(r.e);
        return !!(r.type && r.type.bool);
      } catch { return false; }
    }
    return false;
  }

  widthOf(e) {
    if (e.k === 'paren') return this.widthOf(e.e);
    if (e.k === 'name') {
      try {
        const r = this.resolveName(e.u, e.name, 0);
        if (r.kind === 'alias') return this.widthOf(r.e);
        return r.type ? r.type.c : 'uint8_t';
      } catch { return 'uint8_t'; }
    }
    if (e.k === 'call') {
      try {
        const r = this.resolveName(e.u, e.name, 0);
        if (r.type) return r.type.c;
      } catch { /* funkcje wbudowane */ }
    }
    if (e.k === 'num') return e.v > 65535 ? 'uint32_t' : e.v > 255 ? 'uint16_t' : 'uint8_t';
    return 'uint16_t';
  }

  expr(e) {
    switch (e.k) {
      case 'num': {
        if (e.float) return String(e.v) + (String(e.v).includes('.') || String(e.v).includes('e') ? 'f' : '.0f');
        const txt = e.text && /^0[xb]/.test(e.text) ? e.text : String(e.v);
        return e.v > 65535 ? txt + 'UL' : e.v > 32767 ? txt + 'U' : txt;
      }
      case 'str': throw new BasError(0, 'Napisy (String) nie są obsługiwane w wyrażeniach');
      case 'paren': return `(${this.expr(e.e)})`;
      case 'neg': return `(-${this.expr(e.e)})`;
      case 'not': {
        if (this.isBool(e.e)) return `(!(${this.expr(e.e)}))`;
        return `((${this.widthOf(e.e)})~(${this.expr(e.e)}))`;
      }
      case 'bin': {
        const op = { '=': '==', '<>': '!=', AND: '&', OR: '|', XOR: '^', MOD: '%', '\\': '/' }[e.op] || e.op;
        return `(${this.expr(e.l)} ${op} ${this.expr(e.r)})`;
      }
      case 'name': {
        const r = this.resolveName(e.u, e.name, 0);
        if (r.kind === 'alias') return this.expr(r.e);
        if (r.kind === 'fn') {
          if (!r.s.isFn) throw new BasError(0, `${e.name} to Sub - nie zwraca wartości`);
          return this.genCall(e.name, [], 0, false);
        }
        if (r.arr) throw new BasError(0, `${e.name} jest tablicą - podaj indeks, np. ${e.name}(1)`);
        return r.c;
      }
      case 'bit': {
        const base = this.expr(e.base);
        return `((${base} >> ${this.bitIndex(e.bit, 0)}) & 1)`;
      }
      case 'call': return this.callExpr(e);
    }
    throw new BasError(0, 'Nieprawidłowe wyrażenie');
  }

  callExpr(e) {
    const a = e.args;
    const need = (n) => { if (a.length !== n) throw new BasError(0, `${e.name} oczekuje ${n} argumentów`); };
    switch (e.u) {
      case 'LOOKUP': {
        need(2);
        if (a[1].k !== 'name') throw new BasError(0, 'Lookup(indeks, Etykieta_z_Data)');
        const l = this.labels.get(a[1].u);
        if (!l || l.kind !== 'data') throw new BasError(0, `Lookup: ${a[1].name} nie jest etykietą z Data`);
        return `pgm_read_byte(&${l.c}[${this.expr(a[0])}])`;
      }
      case 'LOW': need(1); return `((uint8_t)(${this.expr(a[0])}))`;
      case 'HIGH': need(1); return `((uint8_t)((${this.expr(a[0])}) >> 8))`;
      case 'ABS': need(1); return `({ __typeof__(${this.expr(a[0])}) a_ = ${this.expr(a[0])}; a_ < 0 ? -a_ : a_; })`;
      case 'RND': need(1); return `bas_rnd(${this.expr(a[0])})`;
      case 'GETADC': need(1); return `bas_getadc(${this.expr(a[0])})`;
      case 'BITS': return `((uint8_t)(${a.map(x => `_BV(${this.expr(x)})`).join(' | ')}))`;
      case 'NBITS': return `((uint8_t)~(${a.map(x => `_BV(${this.expr(x)})`).join(' | ')}))`;
      case 'MAKEINT': need(2); return `((uint16_t)(uint8_t)(${this.expr(a[0])}) | ((uint16_t)(uint8_t)(${this.expr(a[1])}) << 8))`;
      case 'MAX': need(2); return `({ __typeof__(${this.expr(a[0])}) x_ = ${this.expr(a[0])}, y_ = ${this.expr(a[1])}; x_ > y_ ? x_ : y_; })`;
      case 'MIN': need(2); return `({ __typeof__(${this.expr(a[0])}) x_ = ${this.expr(a[0])}, y_ = ${this.expr(a[1])}; x_ < y_ ? x_ : y_; })`;
    }
    const r = this.resolveName(e.u, e.name, 0);
    if (r.kind === 'alias') return this.expr(r.e);
    if (r.kind === 'var' && r.arr) {
      need(1);
      return `${r.c}[${this.arrIndex(a[0], r.arr, 0)}]`;
    }
    if (r.kind === 'fn') {
      if (!r.s.isFn) throw new BasError(0, `${e.name} to Sub - nie zwraca wartości`);
      return this.genCall(e.name, a, 0, false);
    }
    throw new BasError(0, `${e.name}(...) - to nie jest funkcja ani tablica`);
  }
}

// ---------------------------------------------------------------- pomocnicze

const CLOSERS = [['LOOP'], ['WEND'], ['NEXT'], ['ELSE'], ['ELSEIF'], ['ENDIF'], ['END', 'IF'], ['CASE'], ['END', 'SELECT'], ['END', 'SUB'], ['END', 'FUNCTION']];

function isCloser(toks) {
  return CLOSERS.some(c => matchStart(toks, c));
}

function matchStart(toks, words) {
  for (let i = 0; i < words.length; i++) {
    const t = toks[i];
    if (!t || t.t !== 'id' || t.u !== words[i]) return false;
  }
  return true;
}

function splitTop(toks, sep, type = 'op') {
  const parts = [[]];
  let depth = 0;
  for (const t of toks) {
    if (t.t === 'op' && t.v === '(') depth++;
    if (t.t === 'op' && t.v === ')') depth--;
    if (depth === 0 && t.t === type && t.v === sep) { parts.push([]); continue; }
    parts[parts.length - 1].push(t);
  }
  return parts;
}

function findTopOp(toks, v) {
  let depth = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === 'op' && t.v === '(') depth++;
    if (t.t === 'op' && t.v === ')') depth--;
    if (depth === 0 && t.t === 'op' && t.v === v) return i;
  }
  return -1;
}

function collectUntilClose(ts, line) {
  const out = [];
  let depth = 1;
  while (!ts.done()) {
    const t = ts.next();
    if (t.t === 'op' && t.v === '(') depth++;
    if (t.t === 'op' && t.v === ')') { depth--; if (depth === 0) return out; }
    out.push(t);
  }
  throw new BasError(line, 'Brakuje nawiasu zamykającego )');
}

function hasReturn(n) {
  if (n.k === 'return') return true;
  for (const key of ['body', 'els']) if (Array.isArray(n[key]) && n[key].some(hasReturn)) return true;
  if (n.arms && n.arms.some(a => a.body.some(hasReturn))) return true;
  if (n.cases && n.cases.some(c => c.body.some(hasReturn))) return true;
  return false;
}

function indentBlock(s, ind) {
  return s.split('\n').map(x => (x.startsWith('#line') ? x : ind + x)).join('\n') + '\n';
}

function cmpOp(o) {
  return { '=': '==', '<>': '!=' }[o] || o;
}

function hex2(v) {
  return v.toString(16).toUpperCase().padStart(2, '0');
}

const HELPERS = `// --- funkcje pomocnicze BASCOM
__attribute__((unused)) static void bas_waitms(uint16_t n) { while (n--) _delay_ms(1); }
__attribute__((unused)) static void bas_wait(uint16_t n) { while (n--) bas_waitms(1000); }
__attribute__((unused)) static void bas_waitus(uint16_t n) {
#if F_CPU >= 4000000UL
  if (n) _delay_loop_2(n * (uint16_t)(F_CPU / 4000000UL));
#else
  _delay_loop_2(n / (uint16_t)(4000000UL / F_CPU) + 1);
#endif
}
__attribute__((unused)) static uint16_t bas_rnd_state = 0xACE1u;
__attribute__((unused)) static uint16_t bas_rnd(uint16_t n) {
  uint16_t s = bas_rnd_state;
  s ^= s << 7; s ^= s >> 9; s ^= s << 8;
  bas_rnd_state = s;
  return n ? s % n : 0;
}
__attribute__((unused)) static uint16_t bas_getadc(uint8_t ch) {
  ADMUX = (ADMUX & 0xC0) | (ch & 0x3F);
  ADCSRA |= _BV(ADSC);
  while (ADCSRA & _BV(ADSC)) {}
  return ADC;
}
__attribute__((unused)) static const uint8_t *bas_dp;
// --- koniec funkcji pomocniczych
`;
