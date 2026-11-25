// edytor.js - prosty edytor kodu z podświetlaniem składni (C/C++ i BASCOM)
//
// Pod przezroczystym <textarea> leży <pre> z pokolorowanym tekstem; obok - marginesy
// z numerami linii, pułapkami (breakpointami) i znacznikami błędów.

const CPP_KW = new Set(('if else for while do switch case default break continue return goto sizeof typedef struct union enum ' +
  'static const volatile extern inline register signed unsigned true false nullptr class public private template new delete ' +
  'auto using namespace operator this').split(' '));
const CPP_TYPES = new Set(('void char short int long float double bool uint8_t int8_t uint16_t int16_t uint32_t int32_t uint64_t int64_t ' +
  'size_t byte boolean word').split(' '));
const AVR_REGS = /^(PORT[AB]|DDR[AB]|PIN[AB]|P[AB][0-7]|DD[AB][0-7]|PIN[AB][0-7]|TCCR[01][ABC]|TCNT[01][HL]?|OCR[01][AB][HL]?|ICR1[HL]?|TIMSK[01]|TIFR[01]|GIMSK|GIFR|MCUCR|MCUSR|PCMSK[01]|WDTCSR|CLKPR|GTCCR|PRR|EECR|EEDR|EEAR[LH]?|ADMUX|ADCSR[AB]|ADC[LHW]?|ACSR|DIDR0|USI\w+|OSCCAL|GPIOR[012]|SREG|SP[LH]?|CS[01][012]|WGM[01][0-3]|COM[01][AB][01]|TOIE[01]|OCIE[01][AB]|ICIE1|TOV[01]|OCF[01][AB]|ICF1|INT0|INTF0|ISC0[01]|PCIE[01]|PCIF[01]|PCINT\d+|WD[A-Z0-9]+|SE|SM[01]|PUD|ICES1|ICNC1|FOC[01][AB]|PSR10|TSM|CLKPCE|CLKPS\d|PRTIM[01]|EE[A-Z]+|AD[A-Z0-9]+|F_CPU|\w+_vect)$/;
const CPP_FUNCS = new Set(('_BV ISR sei cli delay delayMicroseconds millis micros pinMode digitalWrite digitalRead analogWrite analogRead ' +
  'setup loop main _delay_ms _delay_us pgm_read_byte pgm_read_word wdt_enable wdt_reset wdt_disable sleep_mode set_sleep_mode ' +
  'eeprom_read_byte eeprom_write_byte eeprom_update_byte PROGMEM').split(' '));

const BAS_KW = new Set(('IF THEN ELSE ELSEIF END ENDIF DO LOOP UNTIL WHILE WEND FOR TO STEP NEXT DOWNTO SELECT CASE IS SUB FUNCTION DIM AS ' +
  'CONST CONFIG GOSUB GOTO RETURN ON ENABLE DISABLE START STOP RESET SET TOGGLE INCR DECR WAITMS WAITUS WAIT AND OR XOR NOT MOD ' +
  'CALL DECLARE LOCAL BYVAL BYREF EXIT DATA RESTORE READ LOOKUP SHIFT ROTATE LEFT RIGHT BITWAIT DEBOUNCE REM ALIAS SWAP NOP ' +
  'IDLE POWERDOWN WRITEEEPROM READEEPROM INTERRUPTS OUTPUT INPUT PRESCALE TIMER PWM COUNTER FALLING RISING CHANGE LOW LEVEL ' +
  'WATCHDOG NOSAVE CLEAR HIGH ABS RND GETADC BITS NBITS MAKEINT MAX MIN').split(' '));
const BAS_TYPES = new Set('BIT BYTE INTEGER WORD LONG DWORD SINGLE STRING'.split(' '));
const BAS_REGS = /^(PORT[AB]|DDR[AB]|PIN[AB]|TIMER[01]|COUNTER[01]|COMPARE[01][AB]|CAPTURE1|PWM[01][AB]|INT0|PCINT[01]|OVF[01]|OC[01][AB]|ICP1|TCCR[01][ABC]|TCNT[01][HL]?|OCR[01][AB][HL]?|ICR1|TIMSK[01]|TIFR[01]|GIMSK|GIFR|MCUCR|MCUSR|PCMSK[01]|WDTCSR|CLKPR|GTCCR|PRR|ADMUX|ADCSRA|ACSR|SREG|ADC|EEDR|EECR)$/i;

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function span(cls, text) {
  return cls ? `<span class="t-${cls}">${esc(text)}</span>` : esc(text);
}

// kolorowanie jednej linii C/C++; state.block = wewnątrz komentarza /* */
function hlCpp(line, state) {
  let out = '', i = 0;
  if (state.block) {
    const e = line.indexOf('*/');
    if (e < 0) return span('com', line);
    out += span('com', line.slice(0, e + 2));
    i = e + 2;
    state.block = false;
  }
  if (/^\s*#/.test(line.slice(i))) {
    const m = line.slice(i).match(/^(\s*#\s*\w+)(.*)$/);
    if (m) {
      out += span('pre', m[1]);
      const rest = m[2];
      const cm = rest.indexOf('//');
      if (cm >= 0) return out + span('str', rest.slice(0, cm)) + span('com', rest.slice(cm));
      return out + span(/include/.test(m[1]) ? 'str' : '', rest);
    }
  }
  const re = /(\/\/.*$)|(\/\*)|("(?:[^"\\]|\\.)*"?)|('(?:[^'\\]|\\.)*'?)|(\b0[xX][0-9a-fA-F]+[uUlL]*\b|\b0[bB][01]+[uUlL]*\b|\b\d+\.?\d*(?:[eE][-+]?\d+)?[uUlLfF]*\b)|([A-Za-z_]\w*)|(\s+)|([^\w\s])/g;
  re.lastIndex = i;
  let m;
  while ((m = re.exec(line))) {
    if (m[1]) { out += span('com', m[1]); break; }
    if (m[2]) {
      const e = line.indexOf('*/', m.index + 2);
      if (e < 0) { out += span('com', line.slice(m.index)); state.block = true; break; }
      out += span('com', line.slice(m.index, e + 2));
      re.lastIndex = e + 2;
      continue;
    }
    if (m[3] || m[4]) { out += span('str', m[0]); continue; }
    if (m[5]) { out += span('num', m[0]); continue; }
    if (m[6]) {
      const w = m[6];
      const next = line.slice(re.lastIndex).match(/^\s*\(/);
      if (CPP_KW.has(w)) out += span('kw', w);
      else if (CPP_TYPES.has(w)) out += span('type', w);
      else if (AVR_REGS.test(w)) out += span('reg', w);
      else if (CPP_FUNCS.has(w) || next) out += span('fn', w);
      else out += esc(w);
      continue;
    }
    out += span(m[8] ? 'op' : '', m[0]);
  }
  return out;
}

function hlBas(line) {
  let out = '';
  const lm = line.match(/^(\s*)([A-Za-z_]\w*:)(?=\s|$|')/);
  let i = 0;
  if (lm && !BAS_KW.has(lm[2].slice(0, -1).toUpperCase())) {
    out += esc(lm[1]) + span('label', lm[2]);
    i = lm[0].length;
  }
  if (/^\s*\$/.test(line)) {
    const m = line.match(/^(\s*\$\w+)(.*?)('.*)?$/);
    return span('pre', m[1]) + span('str', m[2]) + (m[3] ? span('com', m[3]) : '');
  }
  const re = /('.*$)|("[^"]*"?)|(&[hH][0-9a-fA-F]+|&[bB][01]+|\b\d+\.?\d*\b)|([A-Za-z_]\w*)(\.\w+)?|(\s+)|([^\w\s])/g;
  re.lastIndex = i;
  let m;
  while ((m = re.exec(line))) {
    if (m[1]) { out += span('com', m[1]); break; }
    if (m[2]) { out += span('str', m[2]); continue; }
    if (m[3]) { out += span('num', m[3]); continue; }
    if (m[4]) {
      const u = m[4].toUpperCase();
      if (u === 'REM') { out += span('com', line.slice(m.index)); break; }
      let cls = BAS_KW.has(u) ? 'kw' : BAS_TYPES.has(u) ? 'type' : BAS_REGS.test(u) ? 'reg' : '';
      out += span(cls, m[4]);
      if (m[5]) out += span('num', m[5]);
      continue;
    }
    out += span(m[7] ? 'op' : '', m[0]);
  }
  return out;
}

export class Editor {
  constructor(root, opts = {}) {
    this.root = root;
    this.opts = opts;
    this.lang = 'cpp';
    this.markers = new Map();     // linia -> { severity, messages[] }
    this.breakpoints = new Set();
    this.execLine = 0;
    root.classList.add('ed');
    root.innerHTML = `
      <div class="ed-gutter"><div class="ed-gutter-inner"></div></div>
      <div class="ed-main">
        <pre class="ed-hl" aria-hidden="true"></pre>
        <textarea class="ed-input" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off"></textarea>
      </div>`;
    this.gutter = root.querySelector('.ed-gutter-inner');
    this.hl = root.querySelector('.ed-hl');
    this.ta = root.querySelector('.ed-input');
    this.pending = false;
    this.ta.addEventListener('input', () => { this.schedule(); if (this.opts.onChange) this.opts.onChange(); });
    this.ta.addEventListener('scroll', () => this.syncScroll());
    this.ta.addEventListener('keydown', (e) => this.onKey(e));
    this.ta.addEventListener('keyup', () => this.reportCursor());
    this.ta.addEventListener('click', () => this.reportCursor());
    this.gutter.addEventListener('mousedown', (e) => {
      const el = e.target.closest('.ln');
      if (!el) return;
      e.preventDefault();
      const line = +el.dataset.line;
      if (this.breakpoints.has(line)) this.breakpoints.delete(line); else this.breakpoints.add(line);
      this.render();
      if (this.opts.onBreakpoints) this.opts.onBreakpoints(this.breakpoints);
    });
  }

  setLanguage(lang) { this.lang = lang; this.render(); }
  getValue() { return this.ta.value; }

  setValue(text) {
    this.ta.value = text;
    this.ta.scrollTop = 0;
    this.render();
  }

  setMarkers(list) {
    this.markers.clear();
    for (const p of list) {
      if (!p.line) continue;
      const m = this.markers.get(p.line) || { severity: 'warning', messages: [] };
      if (p.severity === 'error') m.severity = 'error';
      m.messages.push(p.message + (p.hint ? '\n→ ' + p.hint : ''));
      this.markers.set(p.line, m);
    }
    this.render();
  }

  setBreakpoints(set) { this.breakpoints = new Set(set); this.render(); }

  setExecLine(line) {
    if (line === this.execLine) return;
    this.execLine = line || 0;
    this.render();
    if (line) this.revealLine(line);
  }

  lineHeight() {
    return parseFloat(getComputedStyle(this.ta).lineHeight) || 19;
  }

  revealLine(line) {
    const lh = this.lineHeight();
    const top = (line - 1) * lh;
    const h = this.ta.clientHeight;
    if (top < this.ta.scrollTop + lh || top > this.ta.scrollTop + h - 2 * lh) this.ta.scrollTop = Math.max(0, top - h / 3);
  }

  gotoLine(line) {
    const lines = this.ta.value.split('\n');
    let pos = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    this.ta.focus();
    this.ta.setSelectionRange(pos, pos + (lines[line - 1] || '').length);
    this.revealLine(line);
    this.reportCursor();
  }

  focus() { this.ta.focus(); }

  schedule() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => { this.pending = false; this.render(); });
  }

  render() {
    const lines = this.ta.value.split('\n');
    const state = { block: false };
    let html = '', gut = '';
    for (let i = 0; i < lines.length; i++) {
      const n = i + 1;
      const mk = this.markers.get(n);
      let cls = 'ln';
      if (mk) cls += mk.severity === 'error' ? ' err' : ' warn';
      if (this.execLine === n) cls += ' exec';
      if (this.breakpoints.has(n)) cls += ' bp';
      const code = this.lang === 'bas' ? hlBas(lines[i]) : hlCpp(lines[i], state);
      html += `<div class="${cls}">${code || ' '}</div>`;
      gut += `<div class="${cls}" data-line="${n}"${mk ? ` title="${esc(mk.messages.join('\n\n'))}"` : ''}><span class="bpdot"></span>${n}</div>`;
    }
    this.hl.innerHTML = html + '<div class="ln"> </div>';
    this.gutter.innerHTML = gut;
    this.syncScroll();
  }

  syncScroll() {
    const x = this.ta.scrollLeft, y = this.ta.scrollTop;
    this.hl.style.transform = `translate(${-x}px, ${-y}px)`;
    this.gutter.style.transform = `translateY(${-y}px)`;
  }

  reportCursor() {
    if (!this.opts.onCursor) return;
    const pos = this.ta.selectionStart;
    const before = this.ta.value.slice(0, pos);
    const line = before.split('\n').length;
    const col = pos - before.lastIndexOf('\n');
    this.opts.onCursor(line, col);
  }

  insert(text) {
    // execCommand zachowuje historię cofania (Ctrl+Z)
    if (!document.execCommand('insertText', false, text)) {
      const s = this.ta.selectionStart, e = this.ta.selectionEnd;
      this.ta.setRangeText(text, s, e, 'end');
      this.ta.dispatchEvent(new Event('input'));
    }
  }

  onKey(e) {
    const ta = this.ta;
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd;
      const v = ta.value;
      if (s !== en && v.slice(s, en).includes('\n') || e.shiftKey) {
        const ls = v.lastIndexOf('\n', s - 1) + 1;
        const block = v.slice(ls, en);
        const changed = e.shiftKey
          ? block.split('\n').map(l => l.replace(/^( {1,2}|\t)/, '')).join('\n')
          : block.split('\n').map(l => '  ' + l).join('\n');
        ta.setSelectionRange(ls, en);
        this.insert(changed);
        ta.setSelectionRange(ls, ls + changed.length);
      } else {
        this.insert('  ');
      }
      return;
    }
    if (e.key === 'Enter' && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const s = ta.selectionStart;
      const v = ta.value;
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      const cur = v.slice(ls, s);
      let ind = cur.match(/^\s*/)[0];
      const trimmed = cur.trim();
      if (this.lang === 'cpp' && /[{(]$/.test(trimmed)) ind += '  ';
      if (this.lang === 'bas' && /^(do|while|for|select|case|sub|function|else|elseif)\b|^if\b.*\bthen\s*('.*)?$/i.test(trimmed) && !/^end\b/i.test(trimmed)) ind += '  ';
      const after = v.slice(s, s + 1);
      if (this.lang === 'cpp' && after === '}' && /\{$/.test(trimmed)) {
        this.insert('\n' + ind + '\n' + cur.match(/^\s*/)[0]);
        ta.setSelectionRange(s + 1 + ind.length, s + 1 + ind.length);
      } else {
        this.insert('\n' + ind);
      }
      return;
    }
    if (e.key === '}' && this.lang === 'cpp') {
      const s = ta.selectionStart, v = ta.value;
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      if (/^\s+$/.test(v.slice(ls, s)) && v.slice(ls, s).length >= 2) {
        e.preventDefault();
        ta.setSelectionRange(s - 2, s);
        this.insert('}');
      }
      return;
    }
    if (e.key === '/' && e.ctrlKey) {
      e.preventDefault();
      const v = ta.value, s = ta.selectionStart, en = ta.selectionEnd;
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      let le = v.indexOf('\n', en);
      if (le < 0) le = v.length;
      const block = v.slice(ls, le);
      const mark = this.lang === 'bas' ? "'" : '//';
      const lines = block.split('\n');
      const all = lines.every(l => !l.trim() || l.trim().startsWith(mark));
      const changed = lines.map(l => {
        if (!l.trim()) return l;
        if (all) return l.replace(new RegExp('^(\\s*)' + (mark === '//' ? '\\/\\/ ?' : "' ?")), '$1');
        return l.replace(/^(\s*)/, '$1' + mark + ' ');
      }).join('\n');
      ta.setSelectionRange(ls, le);
      this.insert(changed);
      ta.setSelectionRange(ls, ls + changed.length);
    }
  }
}
