import { h, toast, modal, confirmDialog, STATUS_LABELS, timeAgo, settingsDialog } from './common.js';
import {
  session, canWrite, restoreSession, readText, updateJSON, updateIndex, uploadImage, imageURL, PATHS,
} from './session.js';
import { decryptJSON } from './crypto.js';
import { applyOps, clone, pushOp, newId, nextNumber, BOARD } from './model.js';

// ── configuration ─────────────────────────────────────────────────────
const TYPES = {
  personne: { label: 'Personne', plural: 'Personnes impliquées', prefix: 'I', width: 210 },
  temoignage: { label: 'Témoignage', plural: 'Témoignages', prefix: 'T', width: 280 },
  piece: { label: 'Pièce à conviction', plural: 'Pièces à conviction', prefix: 'P', width: 230 },
  document: { label: 'Document', plural: 'Documents & rapports', prefix: 'D', width: 280 },
  photo: { label: 'Photo', plural: 'Photos', prefix: 'PH', width: 230 },
  lieu: { label: 'Lieu', plural: 'Lieux', prefix: 'L', width: 230 },
  evenement: { label: 'Événement', plural: 'Chronologie', prefix: 'E', width: 230 },
  note: { label: 'Note', plural: 'Notes', prefix: 'N', width: 200, color: 'jaune' },
  zone: { label: 'Zone', plural: 'Zones du tableau', prefix: 'Z', width: 700, height: 450, color: 'blanc' },
};

// Form fields shown in the inspector, per item type.
const FIELDS = {
  personne: [['title', 'Nom'], ['subtitle', 'Statut (suspect, témoin, victime…)'], ['image', 'Photo'], ['body', 'Informations', 'area']],
  temoignage: [['title', 'Témoin'], ['event_date', 'Date de la déposition'], ['subtitle', 'Recueilli par'], ['body', 'Déposition', 'area-lg']],
  piece: [['title', 'Désignation'], ['image', 'Photo de la pièce'], ['subtitle', 'Origine (où, par qui)'], ['body', 'Description', 'area']],
  document: [['title', 'Titre'], ['subtitle', 'Source'], ['image', 'Scan / capture'], ['body', 'Contenu', 'area-lg']],
  photo: [['image', 'Image'], ['title', 'Légende'], ['body', 'Commentaire', 'area']],
  lieu: [['title', 'Nom du lieu'], ['image', 'Photo'], ['body', 'Détails', 'area']],
  evenement: [['event_date', 'Date / heure'], ['title', 'Événement'], ['body', 'Détails', 'area']],
  note: [['title', 'Titre (facultatif)'], ['body', 'Note', 'area']],
  zone: [['title', 'Nom de la zone'], ['body', 'Sous-titre', 'area-sm']],
};

const NOTE_COLORS = { jaune: '#fbe68a', rose: '#f7bccc', bleu: '#bfdff6', vert: '#cde8a6', orange: '#f8c98c', blanc: '#faf8f1' };
const ZONE_COLORS = { blanc: '#efeee8', rouge: '#e0584d', jaune: '#ebc64d', bleu: '#71a6e2', vert: '#7cc383' };
const STRING_COLORS = { rouge: '#c62a1f', noir: '#1d1d1d', bleu: '#2b5fb4', vert: '#2f8a43', jaune: '#e0b021', blanc: '#f1f1ef' };
const COLOR_NAMES = { jaune: 'Jaune', rose: 'Rose', bleu: 'Bleu', vert: 'Vert', orange: 'Orange', blanc: 'Blanc', rouge: 'Rouge', noir: 'Noir' };

const ICONS = {
  personne: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  temoignage: '<path d="M4 5h16v11H10l-5 4v-4H4z"/><path d="M8 9h8M8 12h5"/>',
  piece: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
  document: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  photo: '<path d="M4 7h4l2-3h4l2 3h4v12H4z"/><circle cx="12" cy="13" r="3.5"/>',
  lieu: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  evenement: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  note: '<path d="M4 4h16v10l-6 6H4z"/><path d="M14 20v-6h6"/>',
  zone: '<rect x="3" y="3" width="18" height="18" rx="1" stroke-dasharray="3 3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
};

function icon(name, cls = 'icon') {
  const span = h('span', { class: cls, 'aria-hidden': 'true' });
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return span;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const $ = (sel) => document.querySelector(sel);

// ── state ─────────────────────────────────────────────────────────────
const caseId = new URLSearchParams(location.search).get('id') || '';
const state = {
  canEdit: false,
  case: null,
  board: { width: 6000, height: 4000 },
  items: new Map(),
  links: new Map(),
  view: { x: 0, y: 0, s: 1 },
  selection: null, // { kind: 'item' | 'link', id }
  linkFrom: null, // item id while in "relier à…" mode
  dragging: new Set(), // ids moved locally right now (remote positions are ignored for them)
  collapsed: new Set(),
  activity: [],
  loggedEdit: new Set(), // éléments dont la modification est déjà notée au journal pour cette sélection
};
const cardEls = new Map();
const pinEls = new Map();
const linkEls = new Map();

const viewport = $('#viewport');
const world = $('#world');
const board = $('#board');
const zonesLayer = $('#zones');
const cardsLayer = $('#cards');
const overlay = $('#overlay');
const stringsLayer = $('#strings');
const pinsLayer = $('#pins');
const tempString = $('#temp-string');
const inspector = $('#inspector');

const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } },
};

const itemNumber = (item) => `${TYPES[item.type].prefix}-${String(item.number).padStart(2, '0')}`;
const itemLabel = (item) => item.title || (item.body ? item.body.split('\n')[0].slice(0, 40) : '') || `${TYPES[item.type].label} sans titre`;

// ── start-up ──────────────────────────────────────────────────────────
async function init() {
  if (!/^[a-z0-9]+$/.test(caseId)) return fatal('Dossier introuvable.');
  if (!(await restoreSession())) {
    location.href = `index.html?next=${encodeURIComponent(`dossier.html?id=${caseId}`)}`;
    return;
  }
  state.canEdit = canWrite();
  document.body.classList.toggle('readonly', !state.canEdit);
  $('#btn-add').hidden = !state.canEdit;

  let file;
  try {
    file = await readText(PATHS.dossier(caseId));
  } catch (err) {
    return fatal(`Impossible d'ouvrir le dossier : ${err.message}`);
  }
  if (!file) return fatal("Ce dossier n'existe pas ou a été supprimé. S'il vient d'être créé, patientez une minute puis rechargez la page.");
  try {
    sync.base = await decryptJSON(session.key, file.text);
  } catch {
    return fatal('Impossible de déchiffrer ce dossier : le code du comité a peut-être changé. Reconnectez-vous.');
  }
  sync.sha = file.sha;
  buildDefs();
  load(clone(sync.base));
  const saved = store.get(`bde:view:${caseId}`);
  if (saved && Number.isFinite(saved.s)) { state.view = saved; applyView(); } else fitAll(false);
  $('#loading').remove();
  showHint();
  renderSync();
  setInterval(poll, state.canEdit ? 15000 : 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
}

function fatal(message) {
  $('#loading').replaceChildren(h('div', {}, h('p', {}, message), h('a', { class: 'btn', href: 'index.html' }, 'Retour aux dossiers')));
}

function load(doc) {
  state.case = doc.case;
  state.activity = doc.activity || [];
  state.board = BOARD;
  board.style.width = `${BOARD.width}px`;
  board.style.height = `${BOARD.height}px`;
  overlay.setAttribute('width', BOARD.width);
  overlay.setAttribute('height', BOARD.height);
  $('#frame').style.cssText = `width:${BOARD.width + 96}px;height:${BOARD.height + 96}px`;

  state.items = new Map(doc.items.map((i) => [i.id, i]));
  state.links = new Map(doc.links.map((l) => [l.id, l]));
  zonesLayer.replaceChildren();
  cardsLayer.replaceChildren();
  stringsLayer.replaceChildren();
  pinsLayer.replaceChildren();
  cardEls.clear(); pinEls.clear(); linkEls.clear();
  for (const item of state.items.values()) renderItem(item);
  for (const link of state.links.values()) renderLink(link);
  select(null);
  renderHeader();
  renderSidebar();
}

function buildDefs() {
  const defs = $('#defs');
  const grad = s('radialGradient', { id: 'pin-grad', cx: '35%', cy: '30%', r: '70%' });
  grad.append(s('stop', { offset: '0%', 'stop-color': '#ff7a6b' }), s('stop', { offset: '45%', 'stop-color': '#c9261b' }), s('stop', { offset: '100%', 'stop-color': '#6d0d07' }));
  defs.append(grad);
  for (const [name, color] of Object.entries(STRING_COLORS)) {
    const marker = s('marker', { id: `arrow-${name}`, viewBox: '0 0 10 10', refX: '7', refY: '5', markerWidth: '5', markerHeight: '5', orient: 'auto-start-reverse', markerUnits: 'strokeWidth' });
    marker.append(s('path', { d: 'M0,0 L10,5 L0,10 L2.5,5 z', fill: color }));
    defs.append(marker);
  }
}

// ── rendering: cards ──────────────────────────────────────────────────
function img(src, alt = '') {
  if (!src) return null;
  const el = h('img', { alt, draggable: false, referrerpolicy: 'no-referrer' });
  const fail = () => el.replaceWith(h('div', { class: 'img-missing' }, 'Image indisponible'));
  el.addEventListener('error', fail);
  el.addEventListener('load', () => updateLinksFor(el.closest('.card')?.dataset.id));
  if (src.startsWith('enc:')) imageURL(src).then((url) => { el.src = url; }, fail);
  else el.src = src;
  return el;
}

function silhouette() {
  const el = h('div', { class: 'silhouette', 'aria-hidden': 'true' });
  el.innerHTML = '<svg viewBox="0 0 100 100"><circle cx="50" cy="38" r="18" fill="currentColor"/><path d="M14 100c2-24 18-38 36-38s34 14 36 38z" fill="currentColor"/><text x="50" y="45" text-anchor="middle" font-size="22" fill="#ddd" font-family="Special Elite, monospace">?</text></svg>';
  return el;
}

function buildCard(item) {
  const t = item.type;
  const num = itemNumber(item);
  let inner;
  switch (t) {
    case 'personne':
      inner = h('div', { class: 'polaroid' },
        h('div', { class: 'photo' }, img(item.image, item.title) || silhouette()),
        h('div', { class: 'caption marker' }, item.title || 'Individu non identifié'),
        item.subtitle && h('div', { class: 'role-stamp' }, item.subtitle),
        item.body && h('div', { class: 'polaroid-body clip' }, item.body));
      break;
    case 'photo':
      inner = h('div', { class: 'polaroid' },
        h('div', { class: 'photo photo-wide' }, img(item.image, item.title) || h('div', { class: 'img-missing' }, 'Aucune image')),
        h('div', { class: 'caption hand' }, item.title || ' '),
        item.body && h('div', { class: 'polaroid-body clip' }, item.body));
      break;
    case 'piece':
      inner = h('div', { class: 'bag' },
        h('div', { class: 'bag-seal' }, h('span', {}, 'Pièce à conviction'), h('b', {}, `N° ${num}`)),
        item.image && h('div', { class: 'bag-content' }, img(item.image, item.title)),
        h('div', { class: 'bag-label' },
          h('div', { class: 'lbl-row' }, h('span', {}, 'Désignation'), h('strong', {}, item.title || '—')),
          item.subtitle && h('div', { class: 'lbl-row' }, h('span', {}, 'Origine'), h('em', {}, item.subtitle)),
          item.body && h('p', { class: 'clip' }, item.body)));
      break;
    case 'temoignage':
      inner = h('div', { class: 'sheet lined' },
        h('div', { class: 'sheet-head' }, h('span', {}, 'Témoignage'), h('span', {}, num)),
        h('div', { class: 'sheet-title' }, item.title || 'Témoin anonyme'),
        (item.event_date || item.subtitle) && h('div', { class: 'sheet-meta' },
          [item.event_date, item.subtitle && `recueilli par ${item.subtitle}`].filter(Boolean).join(' · ')),
        h('div', { class: 'sheet-body quote clip' }, item.body || '…'));
      break;
    case 'document':
      inner = h('div', { class: 'sheet doc' },
        h('div', { class: 'sheet-head' }, h('span', {}, 'Document'), h('span', {}, num)),
        h('div', { class: 'doc-title' }, item.title || 'Sans titre'),
        item.subtitle && h('div', { class: 'sheet-meta' }, `Source : ${item.subtitle}`),
        item.image && h('div', { class: 'doc-image' }, img(item.image, item.title)),
        item.body && h('div', { class: 'sheet-body clip' }, item.body));
      break;
    case 'lieu':
    case 'evenement':
      inner = h('div', { class: `index ${t}` },
        h('div', { class: 'index-head' }, icon(t), h('span', {}, TYPES[t].label), h('span', { class: 'index-num' }, num)),
        t === 'evenement' && item.event_date && h('div', { class: 'event-date' }, item.event_date),
        t === 'lieu' && item.image && h('div', { class: 'index-image' }, img(item.image, item.title)),
        h('div', { class: 'index-title' }, item.title || (t === 'lieu' ? 'Lieu à préciser' : 'Événement')),
        item.body && h('div', { class: 'index-body clip' }, item.body));
      break;
    case 'note':
      inner = h('div', { class: 'sticky', style: { background: NOTE_COLORS[item.color] || NOTE_COLORS.jaune } },
        item.title && h('div', { class: 'sticky-title' }, item.title),
        h('div', { class: 'sticky-body clip' }, item.body || (item.title ? '' : 'Note…')));
      break;
    case 'zone':
      return h('div', { class: 'card card-zone', dataset: { id: item.id }, style: { '--zone': ZONE_COLORS[item.color] || ZONE_COLORS.blanc } },
        h('div', { class: 'zone-tape' }, item.title || 'Zone'),
        item.body && h('div', { class: 'zone-sub' }, item.body),
        state.canEdit && h('div', { class: 'resize-handle', title: 'Redimensionner' }));
    default:
      inner = h('div', {}, item.title);
  }
  return h('div', { class: `card card-${t}`, dataset: { id: item.id } },
    inner,
    state.canEdit && h('div', { class: 'resize-handle', title: 'Redimensionner' }));
}

function renderItem(item) {
  const el = buildCard(item);
  const old = cardEls.get(item.id);
  if (old) old.replaceWith(el);
  else (item.type === 'zone' ? zonesLayer : cardsLayer).append(el);
  cardEls.set(item.id, el);
  if (state.selection?.kind === 'item' && state.selection.id === item.id) el.classList.add('selected');
  if (item.type !== 'zone' && !pinEls.has(item.id)) {
    const pin = s('g', { class: 'pin', 'data-id': item.id });
    pin.append(
      s('ellipse', { class: 'pin-shadow', cx: 3, cy: 5, rx: 8, ry: 6 }),
      s('circle', { class: 'pin-head', r: 8.5, fill: 'url(#pin-grad)' }),
      s('circle', { class: 'pin-shine', cx: -2.8, cy: -3, r: 2.2 }),
    );
    const title = s('title');
    title.textContent = state.canEdit ? 'Tirer pour tendre un fil' : '';
    pin.append(title);
    pinsLayer.append(pin);
    pinEls.set(item.id, pin);
  }
  placeItem(item);
  requestAnimationFrame(() => markOverflow(el));
}

function markOverflow(el) {
  for (const c of el.querySelectorAll('.clip')) c.classList.toggle('overflowing', c.scrollHeight > c.clientHeight + 2);
}

function placeItem(item) {
  const el = cardEls.get(item.id);
  if (!el) return;
  el.style.left = `${item.x}px`;
  el.style.top = `${item.y}px`;
  el.style.width = `${item.w}px`;
  if (item.type === 'zone') el.style.height = `${item.h || 400}px`;
  else {
    el.style.zIndex = String(Math.max(1, item.z));
    el.style.transform = item.rotation ? `rotate(${item.rotation}deg)` : '';
  }
  const pin = pinEls.get(item.id);
  if (pin) {
    const p = pinPoint(item);
    pin.setAttribute('transform', `translate(${p.x} ${p.y})`);
  }
  updateLinksFor(item.id);
}

function pinPoint(item) {
  return { x: item.x + item.w / 2, y: item.y + 12 };
}

function removeItemLocal(id) {
  cardEls.get(id)?.remove();
  pinEls.get(id)?.remove();
  cardEls.delete(id);
  pinEls.delete(id);
  state.items.delete(id);
  for (const link of [...state.links.values()]) if (link.from_id === id || link.to_id === id) removeLinkLocal(link.id);
  if (state.selection?.kind === 'item' && state.selection.id === id) select(null);
  if (state.linkFrom === id) setLinkMode(null);
  renderSidebar();
}

// ── rendering: strings ────────────────────────────────────────────────
function stringGeometry(a, b, arrowStart, arrowEnd) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const sag = Math.min(90, dist * 0.12);
  const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + sag };
  const trim = (p) => {
    const vx = p.x - c.x; const vy = p.y - c.y; const l = Math.hypot(vx, vy) || 1;
    return { x: p.x - (vx / l) * 12, y: p.y - (vy / l) * 12 };
  };
  const start = arrowStart ? trim(a) : a;
  const end = arrowEnd ? trim(b) : b;
  return {
    d: `M${start.x.toFixed(1)},${start.y.toFixed(1)} Q${c.x.toFixed(1)},${c.y.toFixed(1)} ${end.x.toFixed(1)},${end.y.toFixed(1)}`,
    mid: { x: 0.25 * a.x + 0.5 * c.x + 0.25 * b.x, y: 0.25 * a.y + 0.5 * c.y + 0.25 * b.y },
  };
}

function renderLink(link) {
  linkEls.get(link.id)?.g.remove();
  const g = s('g', { class: `link${link.style === 'dashed' ? ' dashed' : ''}`, 'data-link': link.id });
  const shadow = s('path', { class: 'string-shadow' });
  const path = s('path', { class: 'string', stroke: STRING_COLORS[link.color] || STRING_COLORS.rouge });
  const hit = s('path', { class: 'string-hit' });
  const markerUrl = `url(#arrow-${STRING_COLORS[link.color] ? link.color : 'rouge'})`;
  if (link.arrow === 'end' || link.arrow === 'both') path.setAttribute('marker-end', markerUrl);
  if (link.arrow === 'start' || link.arrow === 'both') path.setAttribute('marker-start', markerUrl);
  g.append(shadow, path, hit);
  let label = null;
  if (link.label) {
    label = s('g', { class: 'string-label' });
    const rect = s('rect', { rx: 2 });
    const text = s('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    text.textContent = link.label;
    label.append(rect, text);
    g.append(label);
  }
  stringsLayer.append(g);
  linkEls.set(link.id, { g, shadow, path, hit, label });
  updateLink(link);
  if (label) {
    const box = label.querySelector('text').getBBox();
    const rect = label.querySelector('rect');
    rect.setAttribute('x', box.x - 7); rect.setAttribute('y', box.y - 3);
    rect.setAttribute('width', box.width + 14); rect.setAttribute('height', box.height + 6);
  }
  refreshSelectionClasses();
}

function updateLink(link) {
  const els = linkEls.get(link.id);
  const a = state.items.get(link.from_id);
  const b = state.items.get(link.to_id);
  if (!els || !a || !b) return;
  const geo = stringGeometry(pinPoint(a), pinPoint(b), link.arrow === 'start' || link.arrow === 'both', link.arrow === 'end' || link.arrow === 'both');
  els.path.setAttribute('d', geo.d);
  els.shadow.setAttribute('d', geo.d);
  els.hit.setAttribute('d', geo.d);
  if (els.label) els.label.setAttribute('transform', `translate(${geo.mid.x} ${geo.mid.y})`);
}

function updateLinksFor(itemId) {
  for (const link of state.links.values()) if (link.from_id === itemId || link.to_id === itemId) updateLink(link);
}

function removeLinkLocal(id) {
  linkEls.get(id)?.g.remove();
  linkEls.delete(id);
  state.links.delete(id);
  if (state.selection?.kind === 'link' && state.selection.id === id) select(null);
}

// ── header, sidebar ─────────────────────────────────────────
function renderHeader() {
  const c = state.case;
  document.title = `${c.reference} · ${c.title} — Bureau des enquêteurs`;
  $('#case-ref').textContent = c.reference;
  $('#case-name').textContent = c.title;
  const status = $('#case-status');
  status.className = `stamp status-${c.status}`;
  status.textContent = STATUS_LABELS[c.status];
  $('#case-desc').textContent = c.description;
  $('#case-desc').hidden = !c.description;
  $('#case-title').title = state.canEdit ? 'Modifier le dossier' : c.description || c.title;
}

function renderSidebar() {
  const q = $('#search').value.trim().toLowerCase();
  const box = $('#sections');
  box.replaceChildren();
  for (const [type, def] of Object.entries(TYPES)) {
    const all = [...state.items.values()].filter((i) => i.type === type).sort((a, b) => a.number - b.number);
    const list = q ? all.filter((i) => `${i.title} ${i.subtitle} ${i.body} ${i.event_date} ${itemNumber(i)}`.toLowerCase().includes(q)) : all;
    if (q && !list.length) continue;
    const collapsed = state.collapsed.has(type) && !q;
    const section = h('section', { class: `section${collapsed ? ' collapsed' : ''}` },
      h('div', { class: 'section-head' },
        h('button', {
          type: 'button', class: 'section-toggle', 'aria-expanded': String(!collapsed),
          onclick: () => { state.collapsed.has(type) ? state.collapsed.delete(type) : state.collapsed.add(type); renderSidebar(); },
        }, icon('chevron', 'icon chevron'), icon(type), h('span', { class: 'section-name' }, def.plural), h('span', { class: 'count' }, String(all.length))),
        state.canEdit && h('button', {
          type: 'button', class: 'section-add', title: `Ajouter : ${def.label.toLowerCase()}`, 'aria-label': `Ajouter : ${def.label.toLowerCase()}`,
          onclick: () => addItem(type),
        }, icon('plus'))),
      !collapsed && h('ul', { class: 'section-list' },
        list.length ? list.map((i) => h('li', {},
          h('button', {
            type: 'button', class: `entry${state.selection?.kind === 'item' && state.selection.id === i.id ? ' active' : ''}`,
            onclick: () => { focusItem(i.id); closeSidebarMobile(); },
          }, h('span', { class: 'entry-num' }, itemNumber(i)), h('span', { class: 'entry-title' }, itemLabel(i)))))
          : h('li', { class: 'section-empty' }, 'Aucun élément')));
    box.append(section);
  }
  if (!box.children.length) box.append(h('p', { class: 'muted sidebar-empty' }, 'Aucun élément ne correspond.'));
}

// ── selection & inspector ─────────────────────────────────────────────
function select(sel) {
  if (sel && state.selection && sel.kind === state.selection.kind && sel.id === state.selection.id && !inspector.hidden) return;
  state.loggedEdit.clear();
  state.selection = sel;
  refreshSelectionClasses();
  renderInspector();
  renderSidebar();
}

function refreshSelectionClasses() {
  const sel = state.selection;
  for (const [id, el] of cardEls) el.classList.toggle('selected', sel?.kind === 'item' && sel.id === id);
  for (const [id, els] of linkEls) {
    const link = state.links.get(id);
    const related = sel?.kind === 'item' && (link.from_id === sel.id || link.to_id === sel.id);
    els.g.classList.toggle('selected', sel?.kind === 'link' && sel.id === id);
    els.g.classList.toggle('related', related);
  }
  for (const [id, pin] of pinEls) pin.classList.toggle('selected', sel?.kind === 'item' && sel.id === id);
  overlay.classList.toggle('focus-mode', sel?.kind === 'item' && [...state.links.values()].some((l) => l.from_id === sel.id || l.to_id === sel.id));
}

// ── enregistrement sur GitHub ─────────────────────────────────────────
// Les modifications sont mises en file (opérations), puis envoyées par lots de quelques secondes.
// Chaque envoi relit la dernière version du dossier et y rejoue nos opérations.
const sync = {
  base: null, // dernière version connue du dossier sur GitHub
  sha: null,
  pending: [],
  saving: false,
  polling: false,
  version: 0, // incrémenté à chaque enregistrement, pour ignorer une lecture devenue obsolète
  timer: null,
  firstPendingAt: 0,
  error: null,
  lastSaved: 0,
  indexAt: 0,
  indexForce: false,
  dead: false,
  created: new Set(), // éléments créés pendant cette visite (pas de ligne « a modifié » au journal)
};

const ITEM_NAMES = {
  personne: 'la personne', temoignage: 'le témoignage', piece: 'la pièce à conviction', document: 'le document',
  photo: 'la photo', lieu: 'le lieu', evenement: "l'événement", note: 'la note', zone: 'la zone',
};
const itemName = (item) => `${ITEM_NAMES[item.type]}${item.title ? ` « ${item.title} »` : ''}`;

function queueOp(op) {
  if (!state.canEdit || sync.dead) return;
  pushOp(sync.pending, op);
  if (!sync.firstPendingAt) sync.firstPendingAt = Date.now();
  scheduleSave();
  renderSync();
}

function log(action) {
  const entry = { id: newId(), user: session.name, action, at: Date.now() };
  state.activity.push(entry);
  queueOp({ k: 'log', entry });
  if (!$('#journal').hidden) $('#journal-list').prepend(journalEntry(entry));
}

function scheduleSave(delay = 2500) {
  clearTimeout(sync.timer);
  // Pendant une longue série de modifications, on enregistre quand même toutes les 12 s.
  const wait = Math.max(0, Math.min(delay, sync.firstPendingAt + 12000 - Date.now()));
  sync.timer = setTimeout(save, wait);
}

async function save() {
  if (sync.saving || !sync.pending.length || sync.dead) return;
  sync.saving = true;
  sync.version++;
  const ops = sync.pending;
  sync.pending = [];
  sync.firstPendingAt = 0;
  renderSync();
  try {
    const now = Date.now();
    const { data, sha } = await updateJSON(PATHS.dossier(caseId), (current) => {
      if (!current) throw Object.assign(new Error('Ce dossier a été supprimé.'), { deleted: true });
      const doc = applyOps(current, ops);
      doc.case.updated_at = now;
      doc.case.updated_by = session.name;
      return doc;
    }, "Mise à jour d'un dossier");
    sync.base = data;
    sync.sha = sha;
    sync.error = null;
    sync.lastSaved = Date.now();
    reconcile();
    updateIndexEntry(data);
  } catch (err) {
    sync.pending = ops.concat(sync.pending);
    sync.firstPendingAt = Date.now();
    if (err.deleted) { caseDeleted(); return; }
    sync.error = err.message;
    toast(`Enregistrement impossible : ${err.message} Nouvel essai dans 15 s.`, 'error');
  } finally {
    sync.saving = false;
    renderSync();
    if (sync.pending.length && !sync.dead) scheduleSave(sync.error ? 15000 : 2500);
  }
}

/** Met à jour la fiche du dossier dans la liste (au plus toutes les 10 min, sauf changement d'intitulé/statut). */
async function updateIndexEntry(doc) {
  if (!sync.indexForce && Date.now() - sync.indexAt < 10 * 60 * 1000) return;
  sync.indexForce = false;
  sync.indexAt = Date.now();
  const c = doc.case;
  const count = doc.items.filter((i) => i.type !== 'zone').length;
  try {
    await updateIndex((index) => {
      const entry = index.cases.find((e) => e.id === caseId);
      if (entry) Object.assign(entry, { reference: c.reference, title: c.title, description: c.description, status: c.status, updated_at: c.updated_at, item_count: count });
    });
  } catch { /* la liste sera mise à jour au prochain enregistrement */ }
}

async function poll() {
  if (document.hidden || sync.saving || sync.polling || sync.dead) return;
  sync.polling = true;
  const version = sync.version;
  try {
    const file = await readText(PATHS.dossier(caseId));
    if (version !== sync.version || sync.saving) return;
    if (!file) { caseDeleted(); return; }
    if (file.sha && (file.sha === sync.sha || session.gh?.isSuperseded(PATHS.dossier(caseId), file.sha))) return;
    const doc = await decryptJSON(session.key, file.text);
    if (version !== sync.version || sync.saving) return;
    if (!file.sha && JSON.stringify(doc) === JSON.stringify(sync.base)) return;
    sync.base = doc;
    sync.sha = file.sha;
    if (reconcile() && doc.case.updated_by && doc.case.updated_by !== session.name) {
      showRemoteNotice(doc.case.updated_by);
    }
  } catch { /* nouvel essai au prochain passage */ } finally {
    sync.polling = false;
  }
}

const sameFields = (a, b) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

/**
 * Aligne l'affichage sur « dernière version GitHub + nos modifications en attente »,
 * sans toucher à ce que l'utilisateur est en train de déplacer ou de taper. Renvoie true si quelque chose a changé.
 */
function reconcile() {
  const doc = applyOps(clone(sync.base), sync.pending);
  let changed = false;
  if (!sameFields(doc.case, state.case)) { state.case = doc.case; renderHeader(); changed = true; }
  if (doc.activity.length !== state.activity.length || doc.activity.at(-1)?.id !== state.activity.at(-1)?.id) {
    state.activity = doc.activity;
    if (!$('#journal').hidden) renderJournal();
  }
  const typing = inspector.contains(document.activeElement) ? document.activeElement.dataset?.field : null;

  const seenItems = new Set();
  for (const incoming of doc.items) {
    seenItems.add(incoming.id);
    const local = state.items.get(incoming.id);
    if (!local) { state.items.set(incoming.id, incoming); renderItem(incoming); changed = true; continue; }
    if (state.dragging.has(incoming.id)) Object.assign(incoming, { x: local.x, y: local.y, z: local.z, w: local.w, h: local.h });
    const selected = state.selection?.kind === 'item' && state.selection.id === incoming.id;
    if (selected && typing) incoming[typing] = local[typing];
    if (sameFields(local, incoming)) continue;
    const contentChanged = Object.keys(incoming).some((k) => !['x', 'y', 'z'].includes(k) && local[k] !== incoming[k]);
    Object.assign(local, incoming);
    if (contentChanged) renderItem(local); else placeItem(local);
    if (selected && contentChanged) refreshInspectorFields(local);
    changed = true;
  }
  for (const id of [...state.items.keys()]) if (!seenItems.has(id)) { removeItemLocal(id); changed = true; }

  const seenLinks = new Set();
  for (const incoming of doc.links) {
    seenLinks.add(incoming.id);
    const local = state.links.get(incoming.id);
    if (local && sameFields(local, incoming)) continue;
    if (local) Object.assign(local, incoming); else state.links.set(incoming.id, incoming);
    renderLink(state.links.get(incoming.id));
    if (state.selection?.kind === 'link' && state.selection.id === incoming.id && !inspector.contains(document.activeElement)) renderInspector();
    changed = true;
  }
  for (const id of [...state.links.keys()]) if (!seenLinks.has(id)) { removeLinkLocal(id); changed = true; }
  if (changed) renderSidebarSoon();
  return changed;
}

function renderSync() {
  const el = $('#sync');
  let text; let cls = '';
  if (!state.canEdit) { text = 'Lecture seule'; cls = 'ro'; }
  else if (sync.error) { text = 'Non enregistré — nouvel essai…'; cls = 'err'; }
  else if (sync.saving) { text = 'Enregistrement…'; cls = 'busy'; }
  else if (sync.pending.length) { text = 'Modifications en attente…'; cls = 'busy'; }
  else if (sync.lastSaved) { text = 'Enregistré'; cls = 'ok'; }
  else { text = 'À jour'; cls = 'ok'; }
  el.textContent = text;
  el.className = `sync ${cls}`;
  el.title = state.canEdit ? 'Les modifications sont enregistrées sur GitHub automatiquement.' : 'Ajoutez un jeton GitHub dans les réglages (⚙) pour modifier ce dossier.';
}

let noticeTimer;
function showRemoteNotice(name) {
  const el = $('#sync');
  el.textContent = `Mis à jour par ${name}`;
  el.className = 'sync remote';
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(renderSync, 4000);
}

function caseDeleted() {
  if (sync.dead) return;
  sync.dead = true;
  confirmDialog("Ce dossier a été supprimé.", { ok: 'Retour aux dossiers', title: 'Dossier supprimé' })
    .then(() => { location.href = 'index.html'; });
}

/** Modification des champs d'un élément depuis le panneau. */
function editItem(item, fields, { silent = false } = {}) {
  queueOp({ k: 'item:set', id: item.id, fields });
  if (!silent && !state.loggedEdit.has(item.id) && !sync.created?.has(item.id)) {
    state.loggedEdit.add(item.id);
    log(`a modifié ${itemName(item)}`);
  }
}

function colorSwatches(palette, current, onPick, label) {
  return h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': label },
    Object.entries(palette).map(([name, value]) => h('button', {
      type: 'button', role: 'radio', class: `swatch${current === name ? ' on' : ''}`, 'aria-checked': String(current === name),
      title: COLOR_NAMES[name], 'aria-label': COLOR_NAMES[name], style: { background: value },
      onclick: (e) => {
        e.currentTarget.parentElement.querySelectorAll('.swatch').forEach((b) => { b.classList.remove('on'); b.setAttribute('aria-checked', 'false'); });
        e.currentTarget.classList.add('on'); e.currentTarget.setAttribute('aria-checked', 'true');
        onPick(name);
      },
    })));
}

function panelHead(title, sub) {
  return h('div', { class: 'panel-head' },
    h('div', {}, h('h2', {}, title), sub && h('small', { class: 'muted' }, sub)),
    h('button', { type: 'button', class: 'btn btn-ghost btn-icon', 'aria-label': 'Fermer', onclick: () => select(null) }, '✕'));
}

function renderInspector() {
  const sel = state.selection;
  $('#journal').hidden = true;
  if (!sel) { inspector.hidden = true; inspector.replaceChildren(); return; }
  inspector.hidden = false;
  if (sel.kind === 'item') renderItemInspector(state.items.get(sel.id));
  else renderLinkInspector(state.links.get(sel.id));
}

function renderItemInspector(item) {
  const def = TYPES[item.type];
  const content = [panelHead(`${def.label}${item.type === 'zone' ? '' : ` ${itemNumber(item)}`}`, null)];

  if (!state.canEdit) {
    content.push(ficheContent(item), h('div', { class: 'panel-actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => openFiche(item) }, 'Agrandir la fiche')));
    inspector.replaceChildren(h('div', { class: 'panel-scroll' }, content));
    return;
  }

  const form = h('div', { class: 'inspector-form' });
  for (const [field, label, kind] of FIELDS[item.type]) {
    if (field === 'image') { form.append(imageField(item, label)); continue; }
    const input = kind?.startsWith('area')
      ? h('textarea', { rows: kind === 'area-lg' ? 10 : kind === 'area-sm' ? 2 : 5 })
      : h('input', { type: 'text' });
    input.value = item[field];
    input.dataset.field = field;
    input.addEventListener('input', () => {
      item[field] = input.value;
      renderItem(item);
      if (field === 'title' || field === 'body') renderSidebarSoon();
      editItem(item, { [field]: input.value });
    });
    form.append(h('label', { class: 'field' }, h('span', {}, label), input));
  }

  if (item.type === 'note' || item.type === 'zone') {
    const palette = item.type === 'note' ? NOTE_COLORS : ZONE_COLORS;
    form.append(h('div', { class: 'field' }, h('span', {}, 'Couleur'),
      colorSwatches(palette, item.color || def.color, (name) => { item.color = name; renderItem(item); editItem(item, { color: name }, { silent: true }); }, 'Couleur')));
  }
  if (item.type !== 'zone') {
    const range = h('input', { type: 'range', min: -15, max: 15, step: 0.5, value: item.rotation });
    range.addEventListener('input', () => { item.rotation = Number(range.value); placeItem(item); editItem(item, { rotation: item.rotation }, { silent: true }); });
    form.append(h('label', { class: 'field' }, h('span', {}, 'Inclinaison'), range));
  }
  content.push(form);

  const linkCount = [...state.links.values()].filter((l) => l.from_id === item.id || l.to_id === item.id).length;
  content.push(h('div', { class: 'panel-actions' },
    item.type !== 'zone' && h('button', { type: 'button', class: 'btn', onclick: () => setLinkMode(item.id) }, 'Relier à…'),
    h('button', { type: 'button', class: 'btn', onclick: () => openFiche(item) }, 'Voir la fiche'),
    h('button', { type: 'button', class: 'btn btn-danger', onclick: () => deleteItem(item) }, 'Retirer'),
  ));
  if (item.type !== 'zone') {
    content.push(h('p', { class: 'muted panel-foot' },
      linkCount ? `${linkCount} fil${linkCount > 1 ? 's' : ''} attaché${linkCount > 1 ? 's' : ''}.` : 'Aucun fil. Tirez la punaise rouge vers un autre élément pour les relier.'));
  } else {
    content.push(h('p', { class: 'muted panel-foot' }, 'Déplacer une zone emporte les éléments épinglés à l\'intérieur.'));
  }
  inspector.replaceChildren(h('div', { class: 'panel-scroll' }, content));
}

function imageField(item, label) {
  const url = h('input', { type: 'url', placeholder: 'https://… ou envoyez un fichier' });
  url.value = item.image.startsWith('/uploads/') ? '' : item.image;
  const preview = h('div', { class: 'image-preview' });
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', hidden: true });
  const setImage = (value) => {
    item.image = value;
    renderItem(item);
    editItem(item, { image: value });
    drawPreview();
  };
  const drawPreview = () => {
    preview.replaceChildren();
    if (item.image) {
      preview.append(img(item.image), h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { url.value = ''; setImage(''); } }, "Retirer l'image"));
    }
  };
  url.addEventListener('change', () => {
    const v = url.value.trim();
    if (v && !/^https?:\/\//i.test(v)) { toast("L'adresse doit commencer par http:// ou https://", 'error'); return; }
    setImage(v);
  });
  file.addEventListener('change', async () => {
    if (!file.files[0]) return;
    try {
      toast('Envoi de l\'image…');
      setImage(await uploadImage(file.files[0]));
      url.value = '';
    } catch (err) { toast(err.message, 'error'); }
    file.value = '';
  });
  drawPreview();
  return h('div', { class: 'field' }, h('span', {}, label),
    h('div', { class: 'image-row' }, url, h('button', { type: 'button', class: 'btn', onclick: () => file.click() }, 'Envoyer…'), file),
    preview);
}

function renderLinkInspector(link) {
  const a = state.items.get(link.from_id);
  const b = state.items.get(link.to_id);
  const save = (fields) => {
    Object.assign(link, fields);
    renderLink(link);
    queueOp({ k: 'link:set', id: link.id, fields });
  };
  const content = [panelHead('Fil', `${itemLabel(a)} ↔ ${itemLabel(b)}`)];

  if (!state.canEdit) {
    content.push(h('div', { class: 'fiche-inline' },
      h('p', {}, h('strong', {}, itemLabel(a)), ` ${{ none: '—', end: '→', start: '←', both: '↔' }[link.arrow]} `, h('strong', {}, itemLabel(b))),
      link.label && h('p', { class: 'hand-big' }, `« ${link.label} »`),
      h('p', { class: 'muted' }, link.style === 'dashed' ? 'Hypothèse (fil en pointillés)' : 'Lien établi')));
    inspector.replaceChildren(h('div', { class: 'panel-scroll' }, content));
    return;
  }

  const label = h('input', { type: 'text', placeholder: 'Ex. : a vu, complice, a menti…', maxlength: 120 });
  label.value = link.label;
  let labelTimer;
  label.addEventListener('input', () => { clearTimeout(labelTimer); labelTimer = setTimeout(() => save({ label: label.value }), 400); });

  const segmented = (name, options, current, onPick) => h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': name },
    options.map(([value, text, title]) => h('button', {
      type: 'button', role: 'radio', class: current === value ? 'on' : '', 'aria-checked': String(current === value), title,
      onclick: (e) => {
        e.currentTarget.parentElement.querySelectorAll('button').forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); });
        e.currentTarget.classList.add('on'); e.currentTarget.setAttribute('aria-checked', 'true');
        onPick(value);
      },
    }, text)));

  content.push(h('div', { class: 'inspector-form' },
    h('label', { class: 'field' }, h('span', {}, 'Légende du fil'), label),
    h('div', { class: 'field' }, h('span', {}, 'Sens'),
      segmented('Sens', [['none', '—', 'Sans flèche'], ['end', '→', `Vers ${itemLabel(b)}`], ['start', '←', `Vers ${itemLabel(a)}`], ['both', '↔', 'Dans les deux sens']],
        link.arrow, (v) => save({ arrow: v }))),
    h('div', { class: 'field' }, h('span', {}, 'Nature du lien'),
      segmented('Nature', [['solid', 'Établi'], ['dashed', 'Hypothèse']], link.style, (v) => save({ style: v }))),
    h('div', { class: 'field' }, h('span', {}, 'Couleur du fil'),
      colorSwatches(STRING_COLORS, link.color, (v) => save({ color: v }), 'Couleur du fil'))));
  content.push(h('div', { class: 'panel-actions' },
    h('button', { type: 'button', class: 'btn btn-danger', onclick: () => deleteLink(link) }, 'Couper le fil')));
  inspector.replaceChildren(h('div', { class: 'panel-scroll' }, content));
  if (!link.label) setTimeout(() => label.focus(), 50);
}

/** Refreshes inspector inputs after a remote change, without touching what the user is typing. */
function refreshInspectorFields(item) {
  if (!state.canEdit) { renderInspector(); return; }
  for (const input of inspector.querySelectorAll('[data-field]')) {
    const f = input.dataset.field;
    if (document.activeElement !== input) input.value = item[f];
  }
}

let sidebarTimer;
function renderSidebarSoon() {
  clearTimeout(sidebarTimer);
  sidebarTimer = setTimeout(renderSidebar, 250);
}

// ── fiche (full reading view) ─────────────────────────────────────────
function ficheContent(item) {
  const rows = [];
  if (item.subtitle) rows.push([{ personne: 'Statut', temoignage: 'Recueilli par', piece: 'Origine', document: 'Source' }[item.type] || 'Précision', item.subtitle]);
  if (item.event_date) rows.push(['Date', item.event_date]);
  return h('div', { class: 'fiche-inline' },
    item.image && h('div', { class: 'fiche-image' }, img(item.image, item.title)),
    h('h3', {}, itemLabel(item)),
    rows.length && h('dl', {}, rows.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    item.body && h('div', { class: 'fiche-body' }, item.body));
}

function openFiche(item) {
  modal((close) => h('div', { class: 'fiche' },
    h('div', { class: 'fiche-head' },
      h('span', {}, `${TYPES[item.type].label}${item.type === 'zone' ? '' : ` · ${itemNumber(item)}`}`),
      h('span', {}, `${state.case.reference}`)),
    ficheContent(item),
    h('div', { class: 'modal-actions' }, h('button', { type: 'button', class: 'btn', autofocus: true, onclick: () => close() }, 'Fermer'))),
  { className: 'fiche-modal' });
}

// ── mutations ─────────────────────────────────────────────────────────
function maxZ() {
  let z = 0;
  for (const i of state.items.values()) if (i.type !== 'zone' && i.z > z) z = i.z;
  return z;
}

function viewCenter() {
  const r = viewport.getBoundingClientRect();
  return toWorld(r.left + r.width / 2, r.top + r.height / 2);
}

function addItem(type, at, extra = {}) {
  if (!state.canEdit) return null;
  const def = TYPES[type];
  const p = at || viewCenter();
  const w = def.width;
  const top = maxZ() + 1;
  const item = {
    id: newId(),
    type,
    number: nextNumber({ items: [...state.items.values()] }, type),
    title: '', subtitle: '', body: '', image: '', event_date: '',
    color: def.color || '',
    x: Math.round(p.x - w / 2),
    y: Math.round(p.y - (type === 'zone' ? def.height / 2 : 40)),
    w,
    h: def.height || 0,
    rotation: type === 'zone' ? 0 : Math.round((Math.random() * 6 - 3) * 2) / 2,
    z: type === 'zone' ? -top : top,
    created_by: session.name,
    created_at: Date.now(),
    ...extra,
  };
  state.items.set(item.id, item);
  sync.created.add(item.id);
  queueOp({ k: 'item:add', item: { ...item } });
  log(`a ajouté ${ITEM_NAMES[type]}`);
  renderItem(item);
  renderSidebar();
  select({ kind: 'item', id: item.id });
  if (!extra.image) inspector.querySelector('input:not([type=range]):not([type=file]), textarea')?.focus();
  return item;
}

async function deleteItem(item) {
  const n = [...state.links.values()].filter((l) => l.from_id === item.id || l.to_id === item.id).length;
  const ok = await confirmDialog(
    `Retirer « ${itemLabel(item)} » du tableau ?${n ? ` ${n} fil${n > 1 ? 's' : ''} ser${n > 1 ? 'ont' : 'a'} coupé${n > 1 ? 's' : ''}.` : ''}`,
    { ok: 'Retirer', danger: true, title: 'Retirer un élément' });
  if (!ok) return;
  queueOp({ k: 'item:del', id: item.id });
  log(`a retiré ${itemName(item)}`);
  removeItemLocal(item.id);
}

function createLink(fromId, toId) {
  const existing = [...state.links.values()].find((l) => (l.from_id === fromId && l.to_id === toId) || (l.from_id === toId && l.to_id === fromId));
  if (existing) { toast('Ces deux éléments sont déjà reliés.'); select({ kind: 'link', id: existing.id }); return; }
  const link = { id: newId(), from_id: fromId, to_id: toId, label: '', arrow: 'none', style: 'solid', color: 'rouge', created_at: Date.now() };
  state.links.set(link.id, link);
  queueOp({ k: 'link:add', link: { ...link } });
  log(`a relié ${itemName(state.items.get(fromId))} à ${itemName(state.items.get(toId))}`);
  renderLink(link);
  select({ kind: 'link', id: link.id });
}

function deleteLink(link) {
  const a = state.items.get(link.from_id);
  const b = state.items.get(link.to_id);
  queueOp({ k: 'link:del', id: link.id });
  if (a && b) log(`a coupé le fil entre ${itemName(a)} et ${itemName(b)}`);
  removeLinkLocal(link.id);
}

function commitPositions(ids) {
  const list = ids.map((id) => state.items.get(id)).filter(Boolean).map((i) => ({ id: i.id, x: Math.round(i.x), y: Math.round(i.y), z: i.z }));
  queueOp({ k: 'items:pos', list });
}

function setLinkMode(id) {
  state.linkFrom = id;
  viewport.classList.toggle('linking', id !== null);
  const hint = $('#hint');
  if (id !== null) {
    hint.hidden = false;
    hint.replaceChildren(`Cliquez sur l'élément à relier à « ${itemLabel(state.items.get(id))} ». `,
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => setLinkMode(null) }, 'Annuler'));
  } else {
    hint.hidden = true;
  }
}

async function editCase() {
  if (!state.canEdit) return;
  const c = state.case;
  await modal((close) => {
    const f = {
      title: h('input', { type: 'text', value: c.title, maxlength: 150, autofocus: true }),
      reference: h('input', { type: 'text', value: c.reference, maxlength: 40 }),
      status: h('select', {}, Object.entries(STATUS_LABELS).map(([v, l]) => h('option', { value: v, selected: v === c.status }, l))),
      description: h('textarea', { rows: 5 }),
    };
    f.description.value = c.description;
    const error = h('p', { class: 'form-error', role: 'alert' });
    const form = h('form', { class: 'modal-body' },
      h('h2', {}, 'Dossier'),
      h('label', { class: 'field' }, h('span', {}, 'Intitulé'), f.title),
      h('div', { class: 'field-row' },
        h('label', { class: 'field' }, h('span', {}, 'Référence'), f.reference),
        h('label', { class: 'field' }, h('span', {}, 'Statut'), f.status)),
      h('label', { class: 'field' }, h('span', {}, 'Résumé des faits'), f.description),
      error,
      h('div', { class: 'modal-actions spread' },
        h('button', { type: 'button', class: 'btn btn-danger', onclick: async () => {
          close();
          if (!await confirmDialog(`Supprimer définitivement le dossier « ${c.title} » et tout son tableau ? Cette action est irréversible.`, { ok: 'Supprimer le dossier', danger: true, title: 'Supprimer le dossier' })) return;
          deleteCase();
        } }, 'Supprimer…'),
        h('div', { class: 'modal-actions' },
          h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Annuler'),
          h('button', { type: 'submit', class: 'btn btn-primary' }, 'Enregistrer'))));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fields = {
        title: f.title.value.trim().slice(0, 150),
        reference: f.reference.value.trim().slice(0, 40),
        status: f.status.value,
        description: f.description.value.trim().slice(0, 2000),
      };
      if (!fields.title || !fields.reference) { error.textContent = "L'intitulé et la référence sont obligatoires."; return; }
      const changes = Object.keys(fields).filter((k) => fields[k] !== c[k]);
      if (changes.length) {
        Object.assign(state.case, fields);
        queueOp({ k: 'case:set', fields });
        log(changes.includes('status') ? `a passé le dossier au statut « ${STATUS_LABELS[fields.status]} »` : 'a modifié la fiche du dossier');
        sync.indexForce = true;
        renderHeader();
      }
      close();
    });
    return form;
  });
}

async function deleteCase() {
  sync.dead = true;
  clearTimeout(sync.timer);
  try {
    await updateIndex((index) => { index.cases = index.cases.filter((e) => e.id !== caseId); });
    const file = await session.gh.get(PATHS.dossier(caseId));
    if (file) await session.gh.remove(PATHS.dossier(caseId), file.sha, "Suppression d'un dossier");
    location.href = 'index.html';
  } catch (err) {
    sync.dead = false;
    toast(`Suppression impossible : ${err.message}`, 'error');
  }
}

// ── view (pan & zoom) ─────────────────────────────────────────────────
let viewSaveTimer;
function applyView() {
  const v = state.view;
  world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.s})`;
  $('#zoom-level').textContent = `${Math.round(v.s * 100)} %`;
  viewport.style.setProperty('--inv-zoom', String(1 / v.s));
  clearTimeout(viewSaveTimer);
  viewSaveTimer = setTimeout(() => store.set(`bde:view:${caseId}`, state.view), 300);
}

function toWorld(clientX, clientY) {
  const r = viewport.getBoundingClientRect();
  return { x: (clientX - r.left - state.view.x) / state.view.s, y: (clientY - r.top - state.view.y) / state.view.s };
}

function zoomAt(clientX, clientY, factor) {
  const v = state.view;
  const r = viewport.getBoundingClientRect();
  const next = clamp(v.s * factor, 0.12, 2.5);
  const px = clientX - r.left;
  const py = clientY - r.top;
  v.x = px - (px - v.x) * (next / v.s);
  v.y = py - (py - v.y) * (next / v.s);
  v.s = next;
  applyView();
}

function zoomCenter(factor) {
  const r = viewport.getBoundingClientRect();
  animateView(() => zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor));
}

function animateView(fn) {
  world.classList.add('animating');
  fn();
  clearTimeout(animateView.t);
  animateView.t = setTimeout(() => world.classList.remove('animating'), 420);
}

function itemBounds(item) {
  const el = cardEls.get(item.id);
  return { x: item.x, y: item.y, w: item.w, h: item.type === 'zone' ? item.h : (el?.offsetHeight || 200) };
}

function fitBounds(b, animate = true, maxScale = 1) {
  const r = viewport.getBoundingClientRect();
  const pad = 60;
  const sc = clamp(Math.min((r.width - pad * 2) / b.w, (r.height - pad * 2) / b.h), 0.12, maxScale);
  const run = () => {
    state.view = { s: sc, x: r.width / 2 - (b.x + b.w / 2) * sc, y: r.height / 2 - (b.y + b.h / 2) * sc };
    applyView();
  };
  animate ? animateView(run) : run();
}

function fitAll(animate = true) {
  const items = [...state.items.values()];
  if (!items.length) {
    fitBounds({ x: state.board.width / 2 - 700, y: state.board.height / 2 - 450, w: 1400, h: 900 }, animate, 0.9);
    return;
  }
  let x1 = Infinity; let y1 = Infinity; let x2 = -Infinity; let y2 = -Infinity;
  for (const i of items) {
    const b = itemBounds(i);
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
  }
  fitBounds({ x: x1, y: y1, w: Math.max(400, x2 - x1), h: Math.max(300, y2 - y1) }, animate, 1);
}

function focusItem(id) {
  const item = state.items.get(id);
  if (!item) return;
  const b = itemBounds(item);
  const r = viewport.getBoundingClientRect();
  const sc = Math.max(state.view.s, 0.8);
  animateView(() => {
    state.view = { s: sc, x: r.width / 2 - (b.x + b.w / 2) * sc, y: r.height / 2 - (b.y + b.h / 2) * sc };
    applyView();
  });
  select({ kind: 'item', id });
  const el = cardEls.get(id);
  el?.classList.remove('flash');
  void el?.offsetWidth;
  el?.classList.add('flash');
}

// ── pointer interactions ──────────────────────────────────────────────
const pointers = new Map();
let gesture = null;
function itemsInsideZone(zone) {
  const ids = [];
  for (const i of state.items.values()) {
    if (i.type === 'zone') continue;
    const p = pinPoint(i);
    if (p.x >= zone.x && p.x <= zone.x + zone.w && p.y >= zone.y && p.y <= zone.y + zone.h) ids.push(i.id);
  }
  return ids;
}

viewport.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
  closeMenu();
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  viewport.setPointerCapture(e.pointerId);

  if (pointers.size === 2) {
    endGesture(null);
    const [a, b] = [...pointers.values()];
    gesture = { type: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    return;
  }
  if (pointers.size > 2) return;

  const t = e.target;
  const start = { x: e.clientX, y: e.clientY };
  const pin = t.closest?.('.pin');
  const handle = t.closest?.('.resize-handle');
  const card = t.closest?.('.card');
  const linkG = t.closest?.('[data-link]');

  if (e.button === 1) {
    gesture = { type: 'pan', start, view: { ...state.view }, moved: false };
  } else if (pin && state.canEdit) {
    const id = pin.dataset.id;
    gesture = { type: 'link', from: id, start, moved: false };
  } else if (handle && state.canEdit) {
    const id = handle.closest('.card').dataset.id;
    const item = state.items.get(id);
    select({ kind: 'item', id });
    gesture = { type: 'resize', id, start: toWorld(e.clientX, e.clientY), orig: { w: item.w, h: item.h } };
    state.dragging.add(id);
  } else if (card || pin) {
    const id = (card || pin).dataset.id;
    if (state.linkFrom !== null) {
      const from = state.linkFrom;
      setLinkMode(null);
      if (id !== from && state.items.get(id)?.type !== 'zone') createLink(from, id);
      return;
    }
    select({ kind: 'item', id });
    if (!state.canEdit) { gesture = { type: 'tap' }; return; }
    const item = state.items.get(id);
    const ids = item.type === 'zone' ? [id, ...itemsInsideZone(item)] : [id];
    gesture = {
      type: 'drag', ids, start, startWorld: toWorld(e.clientX, e.clientY), moved: false,
      orig: new Map(ids.map((i) => [i, { x: state.items.get(i).x, y: state.items.get(i).y }])),
    };
  } else if (linkG) {
    select({ kind: 'link', id: linkG.dataset.link });
    gesture = { type: 'tap' };
  } else {
    if (state.linkFrom !== null) setLinkMode(null);
    gesture = { type: 'pan', start, view: { ...state.view }, moved: false, background: true };
  }
});

viewport.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!gesture) return;

  if (gesture.type === 'pinch') {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    state.view.x += mid.x - gesture.mid.x;
    state.view.y += mid.y - gesture.mid.y;
    zoomAt(mid.x, mid.y, dist / (gesture.dist || dist));
    gesture.dist = dist;
    gesture.mid = mid;
    return;
  }

  const movedEnough = gesture.start && Math.hypot(e.clientX - gesture.start.x, e.clientY - gesture.start.y) > 4;
  switch (gesture.type) {
    case 'pan':
      if (!gesture.moved && !movedEnough) return;
      gesture.moved = true;
      viewport.classList.add('panning');
      state.view.x = gesture.view.x + e.clientX - gesture.start.x;
      state.view.y = gesture.view.y + e.clientY - gesture.start.y;
      applyView();
      break;
    case 'drag': {
      if (!gesture.moved) {
        if (!movedEnough) return;
        gesture.moved = true;
        for (const id of gesture.ids) state.dragging.add(id);
        const top = state.items.get(gesture.ids[0]);
        if (top.type !== 'zone' && top.z < maxZ()) top.z = maxZ() + 1;
        cardEls.get(gesture.ids[0])?.classList.add('lifted');
      }
      const p = toWorld(e.clientX, e.clientY);
      const dx = p.x - gesture.startWorld.x;
      const dy = p.y - gesture.startWorld.y;
      for (const id of gesture.ids) {
        const item = state.items.get(id);
        const o = gesture.orig.get(id);
        if (!item) continue;
        item.x = clamp(o.x + dx, -150, state.board.width - 40);
        item.y = clamp(o.y + dy, -150, state.board.height - 40);
        placeItem(item);
      }
      break;
    }
    case 'link': {
      if (!gesture.moved && !movedEnough) return;
      gesture.moved = true;
      const from = pinPoint(state.items.get(gesture.from));
      const p = toWorld(e.clientX, e.clientY);
      tempString.hidden = false;
      tempString.setAttribute('d', stringGeometry(from, p, false, false).d);
      const target = linkTargetAt(e.clientX, e.clientY);
      for (const el of cardsLayer.querySelectorAll('.link-target')) el.classList.remove('link-target');
      if (target && target !== gesture.from) cardEls.get(target)?.classList.add('link-target');
      break;
    }
    case 'resize': {
      const item = state.items.get(gesture.id);
      const p = toWorld(e.clientX, e.clientY);
      item.w = clamp(Math.round(gesture.orig.w + p.x - gesture.start.x), item.type === 'zone' ? 200 : 140, item.type === 'zone' ? 3000 : 900);
      if (item.type === 'zone') item.h = clamp(Math.round(gesture.orig.h + p.y - gesture.start.y), 150, 3000);
      placeItem(item);
      gesture.moved = true;
      break;
    }
    default:
  }
});

function linkTargetAt(clientX, clientY) {
  const els = document.elementsFromPoint(clientX, clientY);
  for (const el of els) {
    const hit = el.closest?.('.pin, .card:not(.card-zone)');
    if (hit) return hit.dataset.id;
  }
  return null;
}

function endGesture(e) {
  const g = gesture;
  gesture = null;
  viewport.classList.remove('panning');
  if (!g) return;
  if (g.type === 'drag' && g.moved) {
    for (const id of g.ids) state.dragging.delete(id);
    cardEls.get(g.ids[0])?.classList.remove('lifted');
    commitPositions(g.ids);
  } else if (g.type === 'link') {
    tempString.hidden = true;
    for (const el of cardsLayer.querySelectorAll('.link-target')) el.classList.remove('link-target');
    if (!g.moved) { select({ kind: 'item', id: g.from }); return; }
    const target = e ? linkTargetAt(e.clientX, e.clientY) : null;
    if (target && target !== g.from) createLink(g.from, target);
  } else if (g.type === 'resize' && g.moved) {
    const item = state.items.get(g.id);
    state.dragging.delete(g.id);
    editItem(item, { w: item.w, h: item.h }, { silent: true });
  } else if (g.type === 'pan' && g.background && !g.moved) {
    select(null);
  }
}

function onPointerEnd(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (gesture?.type === 'pinch') { if (pointers.size < 2) gesture = null; return; }
  endGesture(e);
}
viewport.addEventListener('pointerup', onPointerEnd);
viewport.addEventListener('pointercancel', onPointerEnd);

viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey || e.deltaMode !== 0 || (Math.abs(e.deltaY) >= 50 && e.deltaX === 0)) {
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  } else {
    state.view.x -= e.deltaX;
    state.view.y -= e.deltaY;
    applyView();
  }
}, { passive: false });

viewport.addEventListener('dblclick', (e) => {
  const card = e.target.closest('.card');
  if (card && !card.classList.contains('card-zone')) { openFiche(state.items.get(card.dataset.id)); return; }
  if (!state.canEdit || e.target.closest('[data-link], .pin')) return;
  openAddMenu(e.clientX, e.clientY, toWorld(e.clientX, e.clientY));
});

viewport.addEventListener('contextmenu', (e) => {
  if (!state.canEdit || e.target.closest('.card:not(.card-zone), [data-link], .pin')) return;
  e.preventDefault();
  openAddMenu(e.clientX, e.clientY, toWorld(e.clientX, e.clientY));
});

// ── add menu ──────────────────────────────────────────────────────────
let menuEl = null;
function openAddMenu(clientX, clientY, at) {
  closeMenu();
  menuEl = h('div', { class: 'add-menu', role: 'menu' },
    h('div', { class: 'add-menu-title' }, 'Épingler au tableau'),
    Object.entries(TYPES).map(([type, def]) => h('button', {
      type: 'button', role: 'menuitem', onclick: () => { closeMenu(); addItem(type, at); },
    }, icon(type), def.label)));
  document.body.append(menuEl);
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = `${clamp(clientX, 8, innerWidth - r.width - 8)}px`;
  menuEl.style.top = `${clamp(clientY, 8, innerHeight - r.height - 8)}px`;
  menuEl.querySelector('button')?.focus();
}
function closeMenu() {
  menuEl?.remove();
  menuEl = null;
}
document.addEventListener('pointerdown', (e) => { if (menuEl && !menuEl.contains(e.target) && e.target.id !== 'btn-add') closeMenu(); });

// ── images: paste & drop ──────────────────────────────────────────────
async function addImageItems(files, at) {
  const images = [...files].filter((f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type));
  if (!images.length || !state.canEdit) return;
  let p = at || viewCenter();
  for (const f of images) {
    try {
      toast("Envoi de l'image…");
      const url = await uploadImage(f);
      await addItem('photo', p, { image: url });
      p = { x: p.x + 40, y: p.y + 40 };
    } catch (err) { toast(err.message, 'error'); }
  }
}

document.addEventListener('paste', (e) => {
  if (e.target.closest?.('input, textarea') || document.querySelector('dialog[open]')) return;
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); addImageItems(files); }
});
viewport.addEventListener('dragover', (e) => { if (state.canEdit && e.dataTransfer?.types.includes('Files')) { e.preventDefault(); viewport.classList.add('dropping'); } });
viewport.addEventListener('dragleave', () => viewport.classList.remove('dropping'));
viewport.addEventListener('drop', (e) => {
  viewport.classList.remove('dropping');
  if (!e.dataTransfer?.files.length) return;
  e.preventDefault();
  addImageItems(e.dataTransfer.files, toWorld(e.clientX, e.clientY));
});

// ── keyboard ──────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return;
  if (e.key === 'Escape') {
    if (menuEl) return closeMenu();
    if (state.linkFrom !== null) return setLinkMode(null);
    if (e.target.closest?.('input, textarea, select')) { e.target.blur(); return; }
    select(null);
    return;
  }
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.canEdit && state.selection) {
    e.preventDefault();
    if (state.selection.kind === 'item') deleteItem(state.items.get(state.selection.id));
    else deleteLink(state.links.get(state.selection.id));
  } else if (e.key === '+' || e.key === '=') zoomCenter(1.25);
  else if (e.key === '-') zoomCenter(0.8);
  else if (e.key === '0') fitAll();
});

// ── journal ───────────────────────────────────────────────────────────
function journalEntry(entry) {
  return h('li', {},
    h('p', {}, h('strong', {}, entry.user), ` ${entry.action}`),
    h('time', { datetime: new Date(entry.at).toISOString(), title: new Date(entry.at).toLocaleString('fr-FR') }, timeAgo(entry.at)));
}

function renderJournal() {
  const list = $('#journal-list');
  const entries = [...state.activity].reverse();
  list.replaceChildren(...(entries.length ? entries.map(journalEntry) : [h('li', { class: 'muted' }, 'Aucune activité.')]));
}

function openJournal() {
  const panel = $('#journal');
  if (!panel.hidden) { panel.hidden = true; return; }
  select(null);
  panel.hidden = false;
  renderJournal();
}

// ── misc UI ───────────────────────────────────────────────────────────
function showHint() {
  if (!state.canEdit || store.get('bde:hint-dismissed')) return;
  const hint = $('#hint');
  hint.hidden = false;
  hint.replaceChildren(
    h('span', {}, h('b', {}, 'Astuces : '), 'tirez une punaise rouge vers un autre élément pour tendre un fil · double-clic sur le bois pour épingler quelque chose · collez (Ctrl+V) ou glissez une capture d\'écran pour l\'ajouter.'),
    h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { hint.hidden = true; store.set('bde:hint-dismissed', true); } }, 'Compris'));
}

function closeSidebarMobile() {
  document.body.classList.remove('sidebar-open');
}

$('#zoom-in').addEventListener('click', () => zoomCenter(1.25));
$('#zoom-out').addEventListener('click', () => zoomCenter(0.8));
$('#zoom-level').addEventListener('click', () => fitAll());
$('#btn-journal').addEventListener('click', openJournal);
$('#journal-close').addEventListener('click', () => { $('#journal').hidden = true; });
$('#case-title').addEventListener('click', editCase);
$('#search').addEventListener('input', renderSidebar);
$('#btn-sidebar').addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
$('#btn-add').addEventListener('click', (e) => {
  if (menuEl) return closeMenu();
  const r = e.currentTarget.getBoundingClientRect();
  openAddMenu(r.right - 220, r.bottom + 6, null);
});
window.addEventListener('resize', closeMenu);
$('#btn-settings').addEventListener('click', () => settingsDialog(() => {
  if (!sync.pending.length && !sync.saving) location.reload();
  else toast('Rechargez la page une fois vos modifications enregistrées pour appliquer les réglages.');
}));
$('#sync').addEventListener('click', () => { if (!state.canEdit) settingsDialog(() => location.reload()); });
window.addEventListener('beforeunload', (e) => {
  if (!sync.pending.length && !sync.saving) return;
  save();
  e.preventDefault();
  e.returnValue = '';
});

init();
