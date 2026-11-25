// kompilacja.js - komunikacja z serwerem (avr-gcc) i obróbka wyników kompilacji

import { transpile } from './bascom.js';
import { VECTOR_NAMES } from './avr.js';

export const FLASH_SIZE = 2048;
export const RAM_SIZE = 128;

// Kompilacja programu. lang: 'cpp' (C/C++, Arduino albo własne main) lub 'bas' (BASCOM)
export async function compileProgram(lang, source, fcpu = 8000000) {
  let mode, csource = null, basic = null;
  if (lang === 'bas') {
    basic = transpile(source);
    if (!basic.ok) {
      return {
        ok: false, lang, basic, problems: basic.errors.map(e => ({ line: e.line, col: 1, severity: 'error', message: e.msg, hint: '' }))
          .concat(basic.warnings.map(w => ({ line: w.line, col: 1, severity: 'warning', message: w.msg, hint: '' }))), log: [],
      };
    }
    mode = 'basic';
    csource = basic.c;
    fcpu = basic.fcpu;
  } else {
    mode = /\bint\s+main\s*\(/.test(stripComments(source)) ? 'cpp' : 'arduino';
  }
  let res;
  try {
    const r = await fetch('/api/compile', { method: 'POST', body: JSON.stringify({ mode, source, csource, fcpu }) });
    if (!r.ok) throw new Error(`serwer odpowiedział ${r.status}`);
    res = await r.json();
  } catch (e) {
    // bez serwera (np. wersja online na GitHub Pages): gotowe wyniki kompilacji przykładów
    res = await prebuilt(buildKey(mode, source, csource, fcpu));
    if (!res) {
      return { ok: false, lang, mode, offline: true, problems: [], log: [{ cls: 'err', text: location.hostname === 'localhost' || location.hostname === '127.0.0.1'
        ? 'Brak połączenia z serwerem symulatora (' + e.message + '). Uruchom plik Symulator.bat.'
        : 'Wersja online nie ma kompilatora – działają tylko przykłady bez zmian. Własne programy skompilujesz w wersji do pobrania (GitHub → Code → Download ZIP).' }] };
    }
  }
  const log = [];
  const problems = [];
  for (const st of res.steps || []) {
    log.push({ cls: 'cmd', text: '> ' + st.cmd });
    if (st.out && st.out.trim()) log.push({ cls: st.code ? 'err' : 'out', text: st.out.trimEnd() });
    problems.push(...parseDiagnostics(st.out || '', lang));
  }
  if (basic) {
    for (const w of basic.warnings) problems.push({ line: w.line, col: 1, severity: 'warning', message: w.msg, hint: '' });
  }
  const out = { ok: !!res.ok, lang, mode, fcpu, problems, log, basic, ms: res.ms, csource };
  if (!res.ok) return out;
  Object.assign(out, parseBuild({ hex: res.hex, eep: res.eep, size: res.size, nm: res.nm, lines: res.lines, lst: res.lst }, lang, basic ? basic.vars : null));
  if (out.size.flash > FLASH_SIZE) {
    out.ok = false;
    out.problems.push({ line: 0, severity: 'error', message: `Program zajmuje ${out.size.flash} B, a ATtiny24 ma tylko ${FLASH_SIZE} B pamięci flash (za dużo o ${out.size.flash - FLASH_SIZE} B).`,
      hint: 'Skróć program: przenieś stałe tablice do PROGMEM, usuń nieużywany kod, zrezygnuj z float i dzielenia 32-bitowego.' });
  }
  if (out.size.ram > RAM_SIZE) {
    out.ok = false;
    out.problems.push({ line: 0, severity: 'error', message: `Zmienne zajmują ${out.size.ram} B, a ATtiny24 ma tylko ${RAM_SIZE} B RAM.`,
      hint: 'Duże tablice stałych umieść we flashu (const ... PROGMEM i pgm_read_byte), zmniejsz bufory.' });
  } else if (out.size.ram > RAM_SIZE * 0.75) {
    out.problems.push({ line: 0, severity: 'warning', message: `Zmienne zajmują ${out.size.ram} z ${RAM_SIZE} B RAM - na stos zostaje tylko ${RAM_SIZE - out.size.ram} B.`,
      hint: 'Każde wywołanie funkcji i przerwanie odkłada dane na stos. Gdy stos zejdzie na zmienne, program zacznie działać losowo.' });
  }
  return out;
}

// odtworzenie wyniku kompilacji z surowych danych (także po ponownym uruchomieniu symulatora)
export function parseBuild(raw, lang, basicVars) {
  const mainFile = lang === 'bas' ? 'program.bas' : 'main.cpp';
  const symbols = parseNm(raw.nm);
  return {
    raw,
    flashWords: parseHex(raw.hex),
    eeprom: raw.eep ? parseHexBytes(raw.eep, 128) : null,
    size: parseSize(raw.size),
    symbols,
    lines: parseLines(raw.lines, mainFile),
    listing: parseListing(raw.lst),
    vars: collectVars(symbols, basicVars ? { vars: basicVars } : null),
    basicVars,
  };
}

// klucz gotowego wyniku kompilacji: skrót FNV-1a z trybu, F_CPU i kodu
export function buildKey(mode, source, csource, fcpu) {
  const text = `${mode}\n${fcpu}\n${String(source).replace(/\r\n/g, '\n')}\n${String(csource || '').replace(/\r\n/g, '\n')}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// gotowe wyniki leżą w przyklady/build/ (tworzy je tools/zbuduj-przyklady.mjs)
let prebuiltIndex = null;
async function prebuilt(key) {
  try {
    if (!prebuiltIndex) prebuiltIndex = await (await fetch('przyklady/build/index.json')).json();
    const file = prebuiltIndex[key];
    return file ? await (await fetch('przyklady/build/' + file)).json() : null;
  } catch {
    return null;
  }
}

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

// ---------------------------------------------------------------- diagnostyka gcc

export function parseDiagnostics(text, lang) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m = l.match(/^(.*?):(\d+):(\d+): (fatal error|error|warning|note): (.*)$/);
    if (m) {
      const [, file, ln, col, sev, msg] = m;
      if (sev === 'note') {
        const prev = out[out.length - 1];
        if (prev) prev.notes = (prev.notes || []).concat(msg);
        continue;
      }
      const own = lang === 'bas' ? /program\.bas$/.test(file) : /main\.cpp$/.test(file);
      out.push({
        file, line: own ? +ln : 0, col: +col, severity: sev === 'warning' ? 'warning' : 'error',
        message: (own ? '' : `[${file.replace(/^.*[\\/]/, '')}:${ln}] `) + msg, hint: hintFor(msg, lang),
      });
      continue;
    }
    m = l.match(/undefined reference to [`'](.*?)'/);
    if (m) {
      out.push({ line: 0, severity: 'error', message: `Brak definicji: ${m[1]}`, hint: hintFor(l, lang) });
      continue;
    }
    m = l.match(/multiple definition of [`'](.*?)'/);
    if (m) {
      out.push({ line: 0, severity: 'error', message: `Podwójna definicja: ${m[1]}`, hint: hintFor(l, lang) });
      continue;
    }
    m = l.match(/region [`'](\w+)' overflowed by (\d+) bytes/);
    if (m) out.push({ line: 0, severity: 'error', message: `Za mało pamięci (${m[1]}) o ${m[2]} B`, hint: '' });
  }
  return out;
}

const HINTS = [
  [/expected ';' before/, 'Brakuje średnika ; na końcu poprzedniej instrukcji (kompilator zauważa to dopiero w następnym wierszu).'],
  [/expression cannot be used as a function/, 'Najczęściej brakuje średnika ; na końcu poprzedniej linii. Rejestry (DDRA, PORTB…) są makrami, więc brak średnika daje taki dziwny komunikat.'],
  [/expected ',' or ';' before/, 'Brakuje średnika ; albo przecinka na końcu deklaracji.'],
  [/expected '\)'/, 'Brakuje nawiasu zamykającego ). Sprawdź, czy liczba nawiasów ( i ) się zgadza.'],
  [/expected '}' at end of input/, 'Brakuje zamykającego nawiasu klamrowego } - któryś blok (funkcja, if, pętla) nie jest zamknięty.'],
  [/expected (primary-expression|unqualified-id|declaration)/, 'Niepoprawna składnia w tym miejscu - często to brakujący lub nadmiarowy nawias, przecinek albo średnik.'],
  [/'(PORT[A-Z]|DDR[A-Z]|PIN[A-Z])' was not declared/, 'ATtiny24 ma tylko porty A i B (PORTA, PORTB, DDRA, DDRB, PINA, PINB). Wielkość liter ma znaczenie.'],
  [/'(TIMER1_OVF_vect|TIMER0_OVF_vect|TIMER1_COMPA_vect|TIMER0_COMPA_vect)'/, 'Na ATtiny24 wektory timerów nazywają się TIM1_OVF_vect, TIM1_COMPA_vect, TIM0_OVF_vect, TIM0_COMPA_vect...'],
  [/appears to be a misspelled signal handler/, 'Błędna nazwa wektora przerwania - ta funkcja NIE zostanie wywołana, a włączone przerwanie zresetuje układ. Poprawne nazwy: INT0_vect, PCINT0_vect, PCINT1_vect, WDT_vect, TIM1_CAPT_vect, TIM1_COMPA_vect, TIM1_COMPB_vect, TIM1_OVF_vect, TIM0_COMPA_vect, TIM0_COMPB_vect, TIM0_OVF_vect.'],
  [/was not declared in this scope/, 'Ta nazwa nie istnieje: literówka (wielkość liter ma znaczenie), brak deklaracji zmiennej przed użyciem albo brak #include.'],
  [/lvalue required as left operand of assignment/, 'Po lewej stronie = musi być zmienna albo rejestr. Może miało być porównanie == ?'],
  [/suggest parentheses around assignment used as truth value/, 'W warunku jest = (przypisanie) zamiast == (porównanie). if (x = 5) zawsze wykona się i zmieni x!'],
  [/(large integer implicitly truncated|overflow in (implicit )?conversion|unsigned conversion from)/, 'Wartość nie mieści się w typie zmiennej (uint8_t: 0-255, int8_t: -128..127, uint16_t: 0-65535).'],
  [/comparison is always (true|false) due to limited range/, 'Porównanie zawsze daje ten sam wynik, bo zmienna ma za mały zakres (np. uint8_t nigdy nie będzie > 255). Pętla może się nie kończyć.'],
  [/comparison of unsigned expression .* is always/, 'Zmienna bez znaku (unsigned) nigdy nie jest ujemna - warunek zawsze ma ten sam wynik.'],
  [/redefinition of/, 'Ta nazwa jest zdefiniowana dwa razy (dwie zmienne albo funkcje o tej samej nazwie).'],
  [/multiple definition of `__vector_(\d+)'/, 'Dwie procedury ISR obsługują to samo przerwanie.'],
  [/undefined reference to `(setup|loop)/, 'W trybie Arduino program musi mieć funkcje void setup() i void loop(). Jeśli piszesz własne int main(), symulator skompiluje go bez Arduino.'],
  [/undefined reference to `main'/, 'Brakuje funkcji main() (albo setup() i loop() z #include <Arduino.h>).'],
  [/undefined reference/, 'Funkcja jest użyta, ale nigdzie nie ma jej treści (definicji) - sprawdź nazwę.'],
  [/stray '\\(302|303|304|305|342|240)'/, 'W kodzie jest niedozwolony znak (np. polska litera, twarda spacja, „cudzysłów drukarski”) poza komentarzem lub napisem.'],
  [/No such file or directory/, 'Brak takiego pliku nagłówkowego. W symulatorze dostępne są nagłówki avr-libc (avr/io.h, util/delay.h, avr/interrupt.h, avr/pgmspace.h, avr/eeprom.h, avr/wdt.h, avr/sleep.h) i Arduino.h.'],
  [/unused variable/, 'Zmienna jest zadeklarowana, ale nieużywana - można ją usunąć.'],
  [/is used uninitialized|may be used uninitialized/, 'Zmienna lokalna nie ma nadanej wartości - w RAM są wtedy przypadkowe dane.'],
  [/invalid conversion from/, 'Niezgodne typy - zrób jawne rzutowanie albo zmień typ zmiennej.'],
  [/too (few|many) arguments to function/, 'Funkcja została wywołana ze złą liczbą argumentów.'],
  [/(delay_ms|delay_us).*expects (a )?(compile time|integer) constant|__builtin_avr_delay_cycles expects/, '_delay_ms() i _delay_us() przyjmują tylko stałe. Dla zmiennego czasu użyj pętli albo delay() z Arduino.'],
  [/control reaches end of non-void function/, 'Funkcja zwracająca wartość nie ma return na końcu.'],
  [/statement has no effect/, 'Instrukcja nic nie robi - może brakuje = albo nawiasów () przy wywołaniu funkcji?'],
  [/variable '.*' set but not used/, 'Zmienna jest zapisywana, ale nigdy odczytywana.'],
];

export function hintFor(msg, lang) {
  if (lang === 'bas' && /program\.c/.test(msg)) return 'Błąd w kodzie C wygenerowanym z BASIC-a. Zajrzyj do zakładki „Kod C”.';
  for (const [re, h] of HINTS) if (re.test(msg)) return h;
  return '';
}

// ---------------------------------------------------------------- formaty plików

export function parseHex(text) {
  const bytes = parseHexBytes(text, FLASH_SIZE * 4);
  const words = new Uint16Array(1024);
  for (let i = 0; i < 1024; i++) words[i] = bytes[2 * i] | (bytes[2 * i + 1] << 8);
  return words;
}

export function parseHexBytes(text, size) {
  const bytes = new Uint8Array(size).fill(0xFF);
  let base = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith(':')) continue;
    const n = parseInt(line.substr(1, 2), 16);
    const addr = parseInt(line.substr(3, 4), 16);
    const type = parseInt(line.substr(7, 2), 16);
    if (type === 0) {
      for (let i = 0; i < n; i++) {
        const a = base + addr + i;
        if (a < size) bytes[a] = parseInt(line.substr(9 + i * 2, 2), 16);
      }
    } else if (type === 2) {
      base = parseInt(line.substr(9, 4), 16) * 16;
    } else if (type === 4) {
      base = parseInt(line.substr(9, 4), 16) * 65536;
    }
  }
  return bytes;
}

export function parseSize(text) {
  const get = (name) => {
    const m = text.match(new RegExp('^\\' + name + '\\s+(\\d+)', 'm'));
    return m ? +m[1] : 0;
  };
  const text_ = get('.text'), data = get('.data'), bss = get('.bss'), noinit = get('.noinit');
  return { text: text_, data, bss, flash: text_ + data, ram: data + bss + noinit };
}

export function parseNm(text) {
  const list = [];
  const byName = {};
  for (const l of text.split(/\r?\n/)) {
    const m = l.match(/^([0-9a-f]{8})(?: ([0-9a-f]{8}))? (\w) (.+)$/i);
    if (!m) continue;
    const s = { addr: parseInt(m[1], 16), size: m[2] ? parseInt(m[2], 16) : 0, type: m[3], name: m[4] };
    list.push(s);
    byName[s.name] = s;
  }
  const funcs = list.filter(s => /[tT]/.test(s.type) && s.addr < 0x800000 && !s.name.startsWith('.')).sort((a, b) => a.addr - b.addr);
  const get = (n) => (byName[n] ? byName[n].addr : -1);
  const heap = byName.__heap_start || byName.__bss_end;
  return {
    list, byName, funcs,
    badIrq: get('__bad_interrupt') >= 0 ? get('__bad_interrupt') >> 1 : -1,
    stop: get('__stop_program') >= 0 ? get('__stop_program') >> 1 : -1,
    heapStart: heap ? heap.addr - 0x800000 : 0x60,
  };
}

// nazwa funkcji dla adresu słowa programu
export function funcAt(symbols, wordAddr) {
  const a = wordAddr * 2;
  let best = null;
  for (const f of symbols.funcs) {
    if (f.addr <= a) best = f; else break;
  }
  if (!best) return '';
  const off = a - best.addr;
  let name = best.name;
  const v = name.match(/^__vector_(\d+)$/);
  if (v) name = `ISR ${VECTOR_NAMES[+v[1]] || v[1]}`;
  else name = name.replace(/^[LSF]_/, '');
  return off ? `${name}+0x${off.toString(16)}` : name;
}

// tabela linii: adres słowa -> linia programu użytkownika
export function parseLines(text, mainFile) {
  const rows = [];
  for (const l of text.split(/\r?\n/)) {
    const m = l.match(/^(\S+)\s+(\d+)\s+(0x[0-9a-f]+)/i);
    if (!m) continue;
    rows.push({ file: m[1], line: +m[2], addr: parseInt(m[3], 16) >> 1 });
  }
  rows.sort((a, b) => a.addr - b.addr);
  const lineOf = new Int32Array(1024);
  const linesToAddr = new Map();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const own = r.file === mainFile || r.file.endsWith('/' + mainFile) || r.file.endsWith('\\' + mainFile);
    const end = i + 1 < rows.length ? rows[i + 1].addr : r.addr + 1;
    for (let a = r.addr; a < Math.min(end, 1024); a++) lineOf[a] = own ? r.line : 0;
    const prev = rows[i - 1];
    const entry = !prev || prev.line !== r.line || prev.file !== r.file || prev.addr + 32 < r.addr;
    if (own && entry) {
      if (!linesToAddr.has(r.line)) linesToAddr.set(r.line, []);
      const list = linesToAddr.get(r.line);
      if (!list.includes(r.addr)) list.push(r.addr);
    }
  }
  return { lineOf, linesToAddr };
}

// listing z avr-objdump -d -S: [{ text, addr (słowo) | -1 }]
export function parseListing(text) {
  const out = [];
  const addrIndex = new Map();
  for (const l of text.split(/\r?\n/)) {
    const m = l.match(/^\s*([0-9a-f]+):\t/);
    const addr = m ? parseInt(m[1], 16) >> 1 : -1;
    if (addr >= 0 && !addrIndex.has(addr)) addrIndex.set(addr, out.length);
    out.push({ text: l, addr });
  }
  return { rows: out, addrIndex };
}

const CORE_VARS = new Set(['timer0_millis', 'timer0_overflow_count', 'timer0_fract', 'tone_timer_toggle_count', 'bas_rnd_state', 'bas_dp']);

function collectVars(sym, basic) {
  const map = new Map();
  if (basic) for (const v of basic.vars) map.set(v.c, v);
  const vars = [];
  for (const s of sym.list) {
    if (!/[bBdD]/.test(s.type) || s.addr < 0x800060 || s.addr >= 0x800100 || s.name.startsWith('__') || !s.size) continue;
    const addr = s.addr - 0x800000;
    let name = s.name, type = null, core = CORE_VARS.has(s.name.replace(/\..*$/, ''));
    if (basic) {
      const v = map.get(s.name);
      if (v) { name = v.name; type = v.type; } else core = true;
    }
    vars.push({ name, addr, size: s.size || 1, type, core });
  }
  return vars;
}
