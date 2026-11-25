// plik.js - wczytywanie gotowych programów: .hex (Intel HEX), .elf (z symbolami) i .eep
//
// Z serwerem pliki analizują avr-nm i avr-objdump (pełne symbole, linie i listing).
// Bez serwera (wersja online) robi to przeglądarka: z .hex sam kod, z .elf także
// symbole (nazwy funkcji i zmiennych) i rozmiary sekcji - bez tablicy linii i listingu.
// Wynik ma ten sam format co wynik kompilacji, więc dalej obsługuje go parseBuild().

const NO_LISTING = '; Listing asemblera wymaga wersji lokalnej (avr-objdump) / Disassembly needs the local version (avr-objdump).';

// ---------------------------------------------------------------- Intel HEX

// zajętość flash w bajtach: najwyższy zapisany adres + 1
export function hexFlashBytes(text) {
  let base = 0, end = 0;
  for (const l of text.split(/\r?\n/)) {
    if (!l.startsWith(':')) continue;
    const n = parseInt(l.substr(1, 2), 16), addr = parseInt(l.substr(3, 4), 16), type = parseInt(l.substr(7, 2), 16);
    if (type === 0) end = Math.max(end, base + addr + n);
    else if (type === 2) base = parseInt(l.substr(9, 4), 16) * 16;
    else if (type === 4) base = parseInt(l.substr(9, 4), 16) * 65536;
  }
  return end;
}

export function toIntelHex(bytes, origin = 0) {
  const lines = [];
  const rec = (type, addr, data) => {
    const b = [data.length, (addr >> 8) & 0xFF, addr & 0xFF, type, ...data];
    const sum = (256 - (b.reduce((a, x) => a + x, 0) & 0xFF)) & 0xFF;
    lines.push(':' + [...b, sum].map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(''));
  };
  for (let i = 0; i < bytes.length; i += 16) rec(0, origin + i, Array.from(bytes.subarray(i, i + 16)));
  rec(1, 0, []);
  return lines.join('\n') + '\n';
}

function sizeText(text, data, bss) {
  return `firmware.elf  :\nsection   size   addr\n.text  ${text}   0\n.data  ${data}   8388704\n.bss  ${bss}   8388704\n`;
}

// ---------------------------------------------------------------- ELF (AVR, 32 bity, little endian)

export function parseElf(buf) {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  if (dv.getUint32(0) !== 0x7F454C46) throw new Error('to nie jest plik ELF');
  if (u8[4] !== 1 || u8[5] !== 1) throw new Error('oczekiwano 32-bitowego ELF little endian');
  if (dv.getUint16(18, true) !== 83) throw new Error('to nie jest program dla AVR');
  const u16 = (o) => dv.getUint16(o, true), u32 = (o) => dv.getUint32(o, true);

  // segmenty do załadowania: flash (adres < 0x800000) i EEPROM (0x810000)
  const flash = new Uint8Array(65536), eep = new Uint8Array(512).fill(0xFF);
  let flashEnd = 0, eepEnd = 0;
  const phoff = u32(28), phsize = u16(42), phnum = u16(44);
  for (let i = 0; i < phnum; i++) {
    const p = phoff + i * phsize;
    if (u32(p) !== 1) continue;                             // PT_LOAD
    const off = u32(p + 4), paddr = u32(p + 12), filesz = u32(p + 16);
    if (!filesz) continue;
    const data = u8.subarray(off, off + filesz);
    if (paddr < 0x800000) { flash.set(data, paddr); flashEnd = Math.max(flashEnd, paddr + filesz); }
    else if (paddr >= 0x810000 && paddr < 0x820000) { eep.set(data, paddr - 0x810000); eepEnd = Math.max(eepEnd, paddr - 0x810000 + filesz); }
  }

  // sekcje: nazwy, rozmiary, tablica symboli
  const shoff = u32(32), shsize = u16(46), shnum = u16(48), shstrndx = u16(50);
  const sec = [];
  for (let i = 0; i < shnum; i++) {
    const s = shoff + i * shsize;
    sec.push({ name: u32(s), type: u32(s + 4), addr: u32(s + 12), off: u32(s + 16), size: u32(s + 20), link: u32(s + 24), entsize: u32(s + 36) });
  }
  const str = (tab, o) => { let e = tab.off + o; while (u8[e]) e++; return new TextDecoder().decode(u8.subarray(tab.off + o, e)); };
  for (const s of sec) s.label = str(sec[shstrndx], s.name);
  const secSize = (n) => (sec.find((s) => s.label === n) || { size: 0 }).size;

  const nm = [];
  const symtab = sec.find((s) => s.type === 2);                // SHT_SYMTAB
  if (symtab) {
    const strtab = sec[symtab.link];
    for (let o = symtab.off; o < symtab.off + symtab.size; o += symtab.entsize || 16) {
      const name = str(strtab, u32(o)), value = u32(o + 4), size = u32(o + 8), info = u8[o + 12], shndx = u16(o + 14);
      const type = info & 15, bind = info >> 4;
      if (!name || shndx === 0 || type > 2) continue;           // tylko NOTYPE / OBJECT / FUNC z sekcją
      const target = sec[shndx] ? sec[shndx].label : '';
      let letter = target.startsWith('.text') ? 't' : target.startsWith('.data') ? 'd' : target.startsWith('.bss') ? 'b' : target.startsWith('.noinit') ? 'b' : shndx === 0xFFF1 ? 'a' : '';
      if (!letter) continue;
      if (bind === 1) letter = letter.toUpperCase();
      nm.push([value, `${value.toString(16).padStart(8, '0')} ${size.toString(16).padStart(8, '0')} ${letter} ${name}`]);
    }
  }
  nm.sort((a, b) => a[0] - b[0]);

  return {
    ok: true,
    hex: toIntelHex(flash.subarray(0, flashEnd)),
    eep: eepEnd ? toIntelHex(eep.subarray(0, eepEnd)) : '',
    size: sizeText(secSize('.text'), secSize('.data'), secSize('.bss') + secSize('.noinit')),
    nm: nm.map(([, l]) => l).join('\n'),
    lines: '',
    lst: NO_LISTING,
  };
}

// analiza pliku bez serwera - ten sam format co odpowiedź /api/analyze
export function analyzeLocally(kind, content) {
  if (kind === 'elf') return parseElf(content);
  const bytes = hexFlashBytes(content);
  if (!bytes) throw new Error('plik .hex nie zawiera danych');
  return { ok: true, hex: content, eep: '', size: sizeText(bytes, 0, 0), nm: '', lines: '', lst: NO_LISTING };
}

export function toBase64(buf) {
  const u8 = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
