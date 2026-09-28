// Mise en forme du texte des cartes, avec une syntaxe proche de Discord :
//   **gras**  *italique*  __souligné__  ~~barré~~  ==surligné==  !!rouge!!  `code`
//   # Titre   ## Sous-titre   - liste   > citation   -# petit texte
// Le rendu construit des éléments DOM (jamais de HTML brut) : aucun risque d'injection.
import { h } from './common.js';

const INLINE = /(\*\*\*[^*]+?\*\*\*|\*\*[^*]+?\*\*|__[^_]+?__|~~[^~]+?~~|==[^=]+?==|!![^!]+?!!|`[^`]+?`|\*[^*\s][^*]*?\*|https?:\/\/[^\s<>"]+)/g;

function inline(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('***')) out.push(h('strong', {}, h('em', {}, inline(t.slice(3, -3)))));
    else if (t.startsWith('**')) out.push(h('strong', {}, inline(t.slice(2, -2))));
    else if (t.startsWith('__')) out.push(h('u', {}, inline(t.slice(2, -2))));
    else if (t.startsWith('~~')) out.push(h('s', {}, inline(t.slice(2, -2))));
    else if (t.startsWith('==')) out.push(h('mark', {}, inline(t.slice(2, -2))));
    else if (t.startsWith('!!')) out.push(h('span', { class: 'red' }, inline(t.slice(2, -2))));
    else if (t.startsWith('`')) out.push(h('code', {}, t.slice(1, -1)));
    else if (t.startsWith('*')) out.push(h('em', {}, inline(t.slice(1, -1))));
    else out.push(h('a', { href: t, target: '_blank', rel: 'noopener noreferrer', title: t }, t.length > 48 ? `${t.slice(0, 45)}…` : t));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Texte mis en forme, dans un bloc portant la classe `cls`. */
export function rich(text, cls = '') {
  const box = h('div', { class: `rich ${cls}` });
  for (const line of String(text).split('\n')) {
    let m;
    if (!line.trim()) box.append(h('div', { class: 'gap' }));
    else if ((m = line.match(/^##\s+(.*)/))) box.append(h('div', { class: 'h2' }, inline(m[1])));
    else if ((m = line.match(/^#\s+(.*)/))) box.append(h('div', { class: 'h1' }, inline(m[1])));
    else if ((m = line.match(/^-#\s+(.*)/))) box.append(h('div', { class: 'l sub' }, inline(m[1])));
    else if ((m = line.match(/^\s*[-•]\s+(.*)/))) box.append(h('div', { class: 'li' }, inline(m[1])));
    else if ((m = line.match(/^>\s?(.*)/))) box.append(h('div', { class: 'q' }, inline(m[1])));
    else box.append(h('div', { class: 'l' }, inline(line)));
  }
  return box;
}

/** Texte sans mise en forme (pour les listes et les titres). */
export function plain(text) {
  return String(text).replace(/^(#{1,2}|-#|>|\s*[-•])\s+/gm, '').replace(/\*\*\*|\*\*|__|~~|==|!!|`/g, '').replace(/\*([^*\s][^*]*?)\*/g, '$1');
}

/** Barre de boutons (gras, titre, liste…) au-dessus d'une zone de texte. */
export function formatToolbar(textarea) {
  const changed = (start, end) => {
    textarea.focus();
    textarea.setSelectionRange(start, end);
    textarea.dispatchEvent(new Event('input'));
  };
  const wrap = (before, after = before) => {
    const { selectionStart: a, selectionEnd: b, value: v } = textarea;
    const sel = v.slice(a, b);
    if (sel.startsWith(before) && sel.endsWith(after) && sel.length >= before.length + after.length) {
      const inner = sel.slice(before.length, sel.length - after.length);
      textarea.value = v.slice(0, a) + inner + v.slice(b);
      return changed(a, a + inner.length);
    }
    const text = sel || 'texte';
    textarea.value = v.slice(0, a) + before + text + after + v.slice(b);
    changed(a + before.length, a + before.length + text.length);
  };
  const prefix = (p) => {
    const { selectionStart: a, selectionEnd: b, value: v } = textarea;
    const start = v.lastIndexOf('\n', a - 1) + 1;
    const nl = v.indexOf('\n', b);
    const end = nl === -1 ? v.length : nl;
    const lines = v.slice(start, end).split('\n');
    const all = lines.every((l) => l.startsWith(p));
    const out = lines.map((l) => (all ? l.slice(p.length) : p + l.replace(/^(#{1,2}|-#|>|-)\s+/, ''))).join('\n');
    textarea.value = v.slice(0, start) + out + v.slice(end);
    changed(start, start + out.length);
  };
  const tools = [
    ['G', 'Gras (Ctrl+B)', () => wrap('**'), 'b'],
    ['I', 'Italique (Ctrl+I)', () => wrap('*'), 'i'],
    ['S', 'Souligné (Ctrl+U)', () => wrap('__'), 'u'],
    ['B', 'Barré', () => wrap('~~'), 's'],
    ['Surligné', 'Surligner', () => wrap('=='), 'mark'],
    ['Rouge', 'Texte en rouge', () => wrap('!!'), 'red'],
    ['T', 'Titre', () => prefix('# '), 'title'],
    ['•', 'Liste à puces', () => prefix('- '), ''],
    ['❝', 'Citation', () => prefix('> '), ''],
    ['petit', 'Petit texte', () => prefix('-# '), 'small'],
  ];
  textarea.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'b') { e.preventDefault(); wrap('**'); } else if (k === 'i') { e.preventDefault(); wrap('*'); } else if (k === 'u') { e.preventDefault(); wrap('__'); }
  });
  return h('div', { class: 'fmt-bar', role: 'toolbar', 'aria-label': 'Mise en forme' },
    tools.map(([text, title, run, cls]) => h('button', {
      type: 'button', class: `fmt fmt-${cls}`, title, 'aria-label': title,
      onmousedown: (e) => e.preventDefault(), // garde la sélection dans la zone de texte
      onclick: run,
    }, text)));
}
