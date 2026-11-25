// eksport.js - zapis obrazów i danych do sprawozdań: PNG, animowany GIF, CSV

// pobranie pliku przez przeglądarkę
export function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function savePng(canvas, name) {
  return new Promise((res) => canvas.toBlob((b) => {
    if (!b) { res(0); return; }          // pusty canvas (np. ukryta zakładka)
    download(name, b);
    res(b.size);
  }, 'image/png'));
}

// ---------------------------------------------------------------- nagrywanie GIF

// Nagrywa wycinek canvasu (kwadrat wokół talerza) z zadaną liczbą klatek na sekundę.
// Paleta jest dobierana do nagrania: 256 najczęstszych kolorów (po 5 bitów na kanał).
export class GifRecorder {
  constructor() {
    this.active = false;
  }

  start(seconds = 4, fps = 20, size = 360) {
    this.active = true;
    this.fps = fps;
    this.size = size;
    this.frames = [];
    this.t0 = performance.now();
    this.last = -Infinity;
    this.until = this.t0 + seconds * 1000;
    this.tmp = document.createElement('canvas');
    this.tmp.width = this.tmp.height = size;
    this.tctx = this.tmp.getContext('2d', { willReadFrequently: true });
  }

  // wywoływane co klatkę ekranu; crop = { x, y, s } - kwadrat do nagrania w pikselach canvasu
  capture(canvas, crop) {
    if (!this.active) return false;
    const now = performance.now();
    if (now - this.last >= 1000 / this.fps - 2) {
      this.last = now;
      this.tctx.drawImage(canvas, crop.x, crop.y, crop.s, crop.s, 0, 0, this.size, this.size);
      this.frames.push(this.tctx.getImageData(0, 0, this.size, this.size).data);
    }
    if (now >= this.until) { this.active = false; return true; }   // true = koniec nagrania
    return false;
  }

  elapsed() { return (performance.now() - this.t0) / 1000; }

  encode() {
    const { palette, lut } = buildPalette(this.frames);
    const indexed = this.frames.map((rgba) => {
      const out = new Uint8Array(rgba.length / 4);
      for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = lut[((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3)];
      return out;
    });
    return new Blob([encodeGif(this.size, this.size, indexed, Math.round(100 / this.fps), palette)], { type: 'image/gif' });
  }
}

// paleta "popularności": 256 najczęstszych kolorów 15-bitowych + tablica najbliższego koloru dla wszystkich 32768
function buildPalette(frames) {
  const hist = new Uint32Array(32768);
  for (const rgba of frames) {
    for (let i = 0; i < rgba.length; i += 8) hist[((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3)]++;
  }
  const used = [];
  for (let c = 0; c < 32768; c++) if (hist[c]) used.push(c);
  used.sort((a, b) => hist[b] - hist[a]);
  const rgb = (c) => [((c >> 10) & 31) * 255 / 31, ((c >> 5) & 31) * 255 / 31, (c & 31) * 255 / 31].map(Math.round);
  const dist = (a, b) => { const x = rgb(a), y = rgb(b); return (x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2; };
  // 160 najczęstszych (tło, płytka), reszta to kolory najdalsze od już wybranych (jasne diody, poświata)
  const top = used.slice(0, 160);
  const rest = used.slice(160);
  const minD = rest.map((c) => Math.min(...top.map((t) => dist(c, t))));
  while (top.length < 256 && rest.length) {
    let bi = 0;
    for (let i = 1; i < rest.length; i++) if (minD[i] > minD[bi]) bi = i;
    const pick = rest[bi];
    top.push(pick);
    rest.splice(bi, 1); minD.splice(bi, 1);
    for (let i = 0; i < rest.length; i++) minD[i] = Math.min(minD[i], dist(rest[i], pick));
  }
  const palette = top.map(rgb);
  while (palette.length < 256) palette.push([0, 0, 0]);
  const lut = new Uint8Array(32768);
  for (const c of used) {
    const [r, g, b] = rgb(c);
    let best = 0, bd = Infinity;
    for (let k = 0; k < top.length; k++) {
      const p = palette[k];
      const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
      if (d < bd) { bd = d; best = k; if (!d) break; }
    }
    lut[c] = best;
  }
  return { palette, lut };
}

function encodeGif(w, h, frames, delay, palette) {
  const bytes = [];
  const put = (...b) => { for (const x of b) bytes.push(x & 0xFF); };
  const put16 = (v) => put(v, v >> 8);
  for (const c of 'GIF89a') put(c.charCodeAt(0));
  put16(w); put16(h);
  put(0xF7, 0, 0);                                  // globalna paleta 256 kolorów
  for (const [r, g, b] of palette) put(r, g, b);
  put(0x21, 0xFF, 11);                              // NETSCAPE2.0 - zapętlenie animacji
  for (const c of 'NETSCAPE2.0') put(c.charCodeAt(0));
  put(3, 1, 0, 0, 0);
  for (const f of frames) {
    put(0x21, 0xF9, 4, 0x00); put16(delay); put(0, 0);         // opóźnienie klatki
    put(0x2C); put16(0); put16(0); put16(w); put16(h); put(0);  // opis obrazu
    put(8);                                                     // minimalny rozmiar kodu LZW
    const data = lzw(f);
    for (let i = 0; i < data.length; i += 255) {
      const n = Math.min(255, data.length - i);
      put(n);
      for (let k = 0; k < n; k++) bytes.push(data[i + k]);
    }
    put(0);
  }
  put(0x3B);
  return new Uint8Array(bytes);
}

// kompresja LZW w wariancie GIF (kody zmiennej długości, kod czyszczenia 256, koniec 257)
function lzw(pixels) {
  const CLEAR = 256, END = 257;
  const out = [];
  let acc = 0, nbits = 0, size = 9;
  const emit = (code) => {
    acc |= code << nbits;
    nbits += size;
    while (nbits >= 8) { out.push(acc & 0xFF); acc >>>= 8; nbits -= 8; }
  };
  let dict = new Map(), next = 258;
  emit(CLEAR);
  let prefix = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const p = pixels[i];
    const key = prefix * 256 + p;
    const code = dict.get(key);
    if (code !== undefined) { prefix = code; continue; }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > (1 << size) && size < 12) size++;
    } else {
      emit(CLEAR);
      dict = new Map(); next = 258; size = 9;
    }
    prefix = p;
  }
  emit(prefix);
  emit(END);
  if (nbits > 0) out.push(acc & 0xFF);
  return out;
}
