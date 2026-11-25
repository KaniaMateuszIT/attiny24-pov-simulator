// i18n.js - język interfejsu (PL / EN)
//
// Aplikacja jest pisana po polsku. W trybie angielskim MutationObserver pilnuje całego
// dokumentu i każdy polski tekst (węzły tekstowe i atrybuty title/placeholder/label)
// zamienia na angielski według słownika z en.js. Oryginał jest zapamiętywany, więc
// powrót do polskiego przywraca dokładnie to, co wstawiła aplikacja.
// Kod programu (edytor, kod C z BASIC-a, asembler) nie jest tłumaczony.

import { EXACT, PATTERNS } from './en.js';

const ATTRS = ['title', 'placeholder', 'label', 'aria-label'];
const SKIP = '#editor, #ccode, #asm, .no-i18n';
const HAS_WORD = /[A-Za-ząćęłńóśźżĄĆĘŁŃÓŚŹŻ]{2}/;

let lang = 'pl';
const cache = new Map();
const origText = new WeakMap();    // węzeł tekstowy -> { pl, en } (en = to, co wstawiliśmy)
const origAttr = new WeakMap();    // element -> { [atrybut]: { pl, en } }
let observer = null;
const listeners = [];

export function getLang() { return lang; }
export function onLangChange(fn) { listeners.push(fn); }

// tłumaczenie pojedynczego napisu (dla tekstów rysowanych na canvasie itp.)
export function tr(text) {
  if (lang === 'pl' || !text || !HAS_WORD.test(text)) return text;
  let out = cache.get(text);
  if (out !== undefined) return out;
  const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const core = m[2];
  let t = EXACT.get(core);
  if (t === undefined) {
    t = core;
    for (const [re, rep] of PATTERNS) t = t.replace(re, rep);
  }
  out = m[1] + t + m[3];
  if (cache.size > 4000) cache.clear();
  cache.set(text, out);
  return out;
}

function skipped(node) {
  const el = node.nodeType === 1 ? node : node.parentElement;
  return !el || !!el.closest(SKIP) || el.tagName === 'SCRIPT' || el.tagName === 'STYLE';
}

function doText(n) {
  const cur = n.nodeValue;
  const rec = origText.get(n);
  if (rec && cur === rec.en) return;           // to nasz własny wpis
  if (lang === 'pl') { if (rec) origText.delete(n); return; }
  const en = tr(cur);
  if (en === cur) { if (rec) origText.delete(n); return; }
  origText.set(n, { pl: cur, en });
  n.nodeValue = en;
}

function doAttr(el, a) {
  const cur = el.getAttribute(a);
  if (cur === null) return;
  let recs = origAttr.get(el);
  const rec = recs && recs[a];
  if (rec && cur === rec.en) return;
  if (lang === 'pl') { if (rec) delete recs[a]; return; }
  const en = tr(cur);
  if (en === cur) { if (rec) delete recs[a]; return; }
  if (!recs) origAttr.set(el, recs = {});
  recs[a] = { pl: cur, en };
  el.setAttribute(a, en);
}

function walk(root) {
  if (root.nodeType === 3) { if (!skipped(root)) doText(root); return; }
  if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
  if (root.nodeType === 1 && skipped(root)) return;
  if (root.nodeType === 1) for (const a of ATTRS) if (root.hasAttribute(a)) doAttr(root, a);
  const it = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeType === 1 && n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let n;
  while ((n = it.nextNode())) {
    if (n.nodeType === 3) doText(n);
    else for (const a of ATTRS) if (n.hasAttribute(a)) doAttr(n, a);
  }
}

// powrót do polskiego: przywróć oryginały tam, gdzie wciąż jest nasz angielski tekst
function restore(root) {
  const it = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let n;
  while ((n = it.nextNode())) {
    if (n.nodeType === 3) {
      const rec = origText.get(n);
      if (rec) { if (n.nodeValue === rec.en) n.nodeValue = rec.pl; origText.delete(n); }
    } else {
      const recs = origAttr.get(n);
      if (recs) {
        for (const a in recs) if (n.getAttribute(a) === recs[a].en) n.setAttribute(a, recs[a].pl);
        origAttr.delete(n);
      }
    }
  }
}

function startObserver() {
  if (observer) return;
  observer = new MutationObserver((list) => {
    if (lang === 'pl') return;
    for (const m of list) {
      if (m.type === 'characterData') { if (!skipped(m.target)) doText(m.target); }
      else if (m.type === 'attributes') { if (!skipped(m.target)) doAttr(m.target, m.attributeName); }
      else for (const n of m.addedNodes) walk(n);
    }
  });
  observer.observe(document.documentElement, {
    subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS,
  });
}

export function setLang(l) {
  lang = l === 'en' ? 'en' : 'pl';
  document.documentElement.lang = lang;
  document.title = lang === 'en' ? 'ATtiny24 Simulator – POV lab board' : 'Symulator ATtiny24 – stanowisko LTM';
  startObserver();
  if (lang === 'en') walk(document.body);
  else restore(document.body);
  for (const fn of listeners) fn(lang);
}

// język startowy: zapamiętany wybór albo język przeglądarki
export function initialLang(saved) {
  if (saved === 'pl' || saved === 'en') return saved;
  return /^pl\b/i.test(navigator.language || '') ? 'pl' : 'en';
}
