// Kompiluje przykłady z aplikacja/przyklady/lista.json przez działający serwer symulatora
// i zapisuje wyniki w aplikacja/przyklady/build/ - z nich korzysta wersja online (bez kompilatora).
//
// Użycie (serwer musi działać):  node tools/zbuduj-przyklady.mjs [http://localhost:8024]

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'aplikacja', 'przyklady');
const out = path.join(dir, 'build');
const server = process.argv[2] || 'http://localhost:8024';

const { transpile } = await import(pathToFileURL(path.join(root, 'aplikacja', 'js', 'bascom.js')));
const { buildKey } = await import(pathToFileURL(path.join(root, 'aplikacja', 'js', 'kompilacja.js')));

// wyniki trafiają do publicznego repozytorium - bez ścieżek z dysku autora
const PRIVATE = [[root, '<symulator>'], [os.tmpdir(), '<tmp>'], [process.env.PUBLIC || '', '<tmp>'], [os.homedir(), '<home>']]
  .filter(([p]) => p.length > 3)
  .flatMap(([p, r]) => [p, p.replace(/\\/g, '/')].map((v) => [new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), r]));
const clean = (v) => (typeof v === 'string' ? PRIVATE.reduce((s, [re, r]) => s.replace(re, r), v)
  : Array.isArray(v) ? v.map(clean) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)])) : v);

const list = JSON.parse(fs.readFileSync(path.join(dir, 'lista.json'), 'utf8'));
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);

const index = {};
for (const ex of list) {
  const source = fs.readFileSync(path.join(dir, ex.file), 'utf8').replace(/\r\n/g, '\n');
  let mode, csource = null, fcpu = 8000000;
  if (ex.lang === 'bas') {
    const b = transpile(source);
    if (!b.ok) throw new Error(`${ex.file}: błąd tłumaczenia BASCOM`);
    mode = 'basic'; csource = b.c; fcpu = b.fcpu;
  } else {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    mode = /\bint\s+main\s*\(/.test(code) ? 'cpp' : 'arduino';
  }
  const r = await fetch(server + '/api/compile', { method: 'POST', body: JSON.stringify({ mode, source, csource, fcpu }) });
  const res = await r.json();
  if (!res.ok) throw new Error(`${ex.file}: kompilacja nieudana`);
  const name = ex.file.replace(/\.\w+$/, '') + '.json';
  fs.writeFileSync(path.join(out, name), JSON.stringify(clean(res)));
  index[buildKey(mode, source, csource, fcpu)] = name;
  console.log(`${ex.file} -> ${name} (${res.hex.length} B hex)`);
}
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index, null, 1) + '\n');
console.log(`Gotowe: ${Object.keys(index).length} przykładów w ${path.relative(root, out)}`);
