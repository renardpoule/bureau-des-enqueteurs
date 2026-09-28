'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const { db, tx, UPLOAD_DIR } = require('./db');
const auth = require('./auth');
const realtime = require('./realtime');

const BOARD_W = 6000;
const BOARD_H = 4000;

const ITEM_TYPES = {
  personne: 'la personne',
  temoignage: 'le témoignage',
  piece: 'la pièce à conviction',
  document: 'le document',
  photo: 'la photo',
  lieu: 'le lieu',
  evenement: "l'événement",
  note: 'la note',
  zone: 'la zone',
};
const CASE_STATUSES = ['ouvert', 'en_cours', 'clos', 'classe'];
const ARROWS = ['none', 'end', 'start', 'both'];
const LINK_STYLES = ['solid', 'dashed'];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (message) => new HttpError(400, message);

// ── validation helpers ────────────────────────────────────────────────
function str(value, max, name, { required = false } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw bad(`Champ « ${name} » invalide.`);
  value = value.trim();
  if (required && !value) throw bad(`Le champ « ${name} » est obligatoire.`);
  if (value.length > max) throw bad(`Le champ « ${name} » est trop long (max ${max}).`);
  return value;
}
function num(value, min, max, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw bad(`Valeur « ${name} » invalide.`);
  return Math.min(max, Math.max(min, n));
}
function oneOf(value, list, name) {
  if (!list.includes(value)) throw bad(`Valeur « ${name} » invalide.`);
  return value;
}
function color(value) {
  const c = str(value, 16, 'couleur');
  if (!/^[a-z]*$/.test(c)) throw bad('Couleur invalide.');
  return c;
}
function imageUrl(value) {
  const url = str(value, 1000, 'image');
  if (url && !/^\/uploads\/[\w.-]+$/.test(url) && !/^https?:\/\/[^\s"'<>]+$/i.test(url)) {
    throw bad("L'image doit être un fichier envoyé ou une adresse http(s).");
  }
  return url;
}
const id = (value) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, 'Introuvable.');
  return n;
};

// ── data access ───────────────────────────────────────────────────────
const plain = (row) => (row ? { ...row } : row);
const getCase = (caseId) => plain(db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId));
const getItem = (itemId) => plain(db.prepare('SELECT * FROM items WHERE id = ?').get(itemId));
const getLink = (linkId) => plain(db.prepare('SELECT * FROM links WHERE id = ?').get(linkId));

function mustGet(getter, key) {
  const row = getter(key);
  if (!row) throw new HttpError(404, 'Introuvable.');
  return row;
}

function touchCase(caseId) {
  db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(Date.now(), caseId);
}

function log(caseId, user, action) {
  const entry = { case_id: caseId, user_name: user.display_name, action, created_at: Date.now() };
  const { lastInsertRowid } = db.prepare('INSERT INTO activity (case_id, user_name, action, created_at) VALUES (?, ?, ?, ?)')
    .run(entry.case_id, entry.user_name, entry.action, entry.created_at);
  realtime.broadcast(caseId, { t: 'activity', entry: { id: Number(lastInsertRowid), ...entry } });
}

const itemName = (item) => `${ITEM_TYPES[item.type] || "l'élément"}${item.title ? ` « ${item.title} »` : ''}`;
const publicUser = (u) => ({ id: u.id, username: u.username, display_name: u.display_name, role: u.role });

// Content fields an item can carry, with their validators.
const ITEM_FIELDS = {
  title: (v) => str(v, 200, 'titre'),
  subtitle: (v) => str(v, 200, 'sous-titre'),
  body: (v) => str(v, 8000, 'texte'),
  image: imageUrl,
  event_date: (v) => str(v, 100, 'date'),
  color,
};
const GEOMETRY_FIELDS = {
  x: (v) => num(v, -200, BOARD_W, 'x'),
  y: (v) => num(v, -200, BOARD_H, 'y'),
  w: (v) => num(v, 80, 3000, 'largeur'),
  h: (v) => num(v, 0, 3000, 'hauteur'),
  rotation: (v) => num(v, -45, 45, 'rotation'),
  z: (v) => Math.round(num(v, -1e9, 1e9, 'z')),
};

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      "img-src 'self' https: http: data: blob:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ].join('; '));
    next();
  });

  app.use(express.json({ limit: '200kb' }));

  // Every state-changing request must carry this header: browsers refuse to send
  // custom headers cross-site without CORS, which blocks CSRF.
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('x-requested-with') !== 'bde') {
      return res.status(403).json({ error: 'Requête refusée.' });
    }
    next();
  });

  const origin = (req) => String(req.get('x-client-id') || '').slice(0, 64);

  // ── authentication ──────────────────────────────────────────────────
  const failures = new Map();
  app.post('/api/login', (req, res) => {
    const key = req.ip;
    const f = failures.get(key);
    if (f && f.count >= 8 && f.until > Date.now()) {
      return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
    }
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !auth.verifyPassword(password, user.password_hash)) {
      const next = f && f.until > Date.now() ? f : { count: 0 };
      failures.set(key, { count: next.count + 1, until: Date.now() + 10 * 60 * 1000 });
      return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
    }
    failures.delete(key);
    auth.setSessionCookie(req, res, auth.createSession(user.id));
    res.json({ user: publicUser(user) });
  });

  app.post('/api/logout', (req, res) => {
    auth.destroySession(auth.sessionToken(req));
    auth.clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get('/api/me', auth.requireAuth, (req, res) => res.json({ user: req.user }));

  app.post('/api/me/password', auth.requireAuth, (req, res) => {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!auth.verifyPassword(String(req.body?.current || ''), row.password_hash)) {
      throw bad('Mot de passe actuel incorrect.');
    }
    const next = String(req.body?.next || '');
    if (next.length < 8) throw bad('Le nouveau mot de passe doit faire au moins 8 caractères.');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(next), req.user.id);
    res.json({ ok: true });
  });

  // ── members (admin) ─────────────────────────────────────────────────
  app.get('/api/users', auth.requireAdmin, (req, res) => {
    const users = db.prepare('SELECT id, username, display_name, role, created_at FROM users ORDER BY display_name').all();
    res.json({ users: users.map(plain) });
  });

  app.post('/api/users', auth.requireAdmin, (req, res) => {
    const username = str(req.body?.username, 40, 'identifiant', { required: true });
    if (!/^[\w.-]+$/.test(username)) throw bad("L'identifiant ne peut contenir que lettres, chiffres, « . », « - » et « _ ».");
    const displayName = str(req.body?.display_name, 80, 'nom affiché', { required: true });
    const role = oneOf(req.body?.role || 'enqueteur', auth.ROLES, 'rôle');
    const password = String(req.body?.password || '');
    if (password.length < 8) throw bad('Le mot de passe doit faire au moins 8 caractères.');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw bad('Cet identifiant existe déjà.');
    const { lastInsertRowid } = db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(username, displayName, auth.hashPassword(password), role, Date.now());
    res.status(201).json({ user: publicUser({ id: Number(lastInsertRowid), username, display_name: displayName, role }) });
  });

  app.patch('/api/users/:id', auth.requireAdmin, (req, res) => {
    const target = mustGet((k) => plain(db.prepare('SELECT * FROM users WHERE id = ?').get(k)), id(req.params.id));
    const b = req.body || {};
    if (b.display_name !== undefined) target.display_name = str(b.display_name, 80, 'nom affiché', { required: true });
    if (b.role !== undefined) {
      const role = oneOf(b.role, auth.ROLES, 'rôle');
      if (target.id === req.user.id && role !== 'admin') throw bad('Vous ne pouvez pas retirer vos propres droits administrateur.');
      target.role = role;
    }
    db.prepare('UPDATE users SET display_name = ?, role = ? WHERE id = ?').run(target.display_name, target.role, target.id);
    if (b.password) {
      if (String(b.password).length < 8) throw bad('Le mot de passe doit faire au moins 8 caractères.');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(String(b.password)), target.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
    }
    res.json({ user: publicUser(target) });
  });

  app.delete('/api/users/:id', auth.requireAdmin, (req, res) => {
    const userId = id(req.params.id);
    if (userId === req.user.id) throw bad('Vous ne pouvez pas supprimer votre propre compte.');
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    res.json({ ok: true });
  });

  // ── cases ───────────────────────────────────────────────────────────
  app.get('/api/cases', auth.requireAuth, (req, res) => {
    const cases = db.prepare(`
      SELECT c.*, u.display_name AS created_by_name,
        (SELECT COUNT(*) FROM items i WHERE i.case_id = c.id AND i.type != 'zone') AS item_count
      FROM cases c LEFT JOIN users u ON u.id = c.created_by
      ORDER BY c.updated_at DESC`).all();
    res.json({ cases: cases.map(plain) });
  });

  app.post('/api/cases', auth.requireEditor, (req, res) => {
    const b = req.body || {};
    const now = Date.now();
    const title = str(b.title, 150, 'intitulé', { required: true });
    let reference = str(b.reference, 40, 'référence');
    if (!reference) {
      const { n } = db.prepare('SELECT COUNT(*) AS n FROM cases').get();
      reference = `CD-${new Date().getFullYear()}-${String(n + 1).padStart(3, '0')}`;
    }
    const description = str(b.description, 2000, 'description');
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO cases (reference, title, description, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, 'ouvert', ?, ?, ?)`).run(reference, title, description, req.user.id, now, now);
    const caseId = Number(lastInsertRowid);
    log(caseId, req.user, `a ouvert le dossier « ${title} »`);
    res.status(201).json({ case: getCase(caseId) });
  });

  app.get('/api/cases/:id', auth.requireAuth, (req, res) => {
    const c = mustGet(getCase, id(req.params.id));
    res.json({
      case: c,
      items: db.prepare('SELECT * FROM items WHERE case_id = ? ORDER BY z, id').all(c.id).map(plain),
      links: db.prepare('SELECT * FROM links WHERE case_id = ? ORDER BY id').all(c.id).map(plain),
      board: { width: BOARD_W, height: BOARD_H },
    });
  });

  app.patch('/api/cases/:id', auth.requireEditor, (req, res) => {
    const c = mustGet(getCase, id(req.params.id));
    const b = req.body || {};
    const changes = [];
    if (b.title !== undefined) { c.title = str(b.title, 150, 'intitulé', { required: true }); changes.push('intitulé'); }
    if (b.reference !== undefined) { c.reference = str(b.reference, 40, 'référence', { required: true }); changes.push('référence'); }
    if (b.description !== undefined) { c.description = str(b.description, 2000, 'description'); changes.push('description'); }
    if (b.status !== undefined && b.status !== c.status) {
      c.status = oneOf(b.status, CASE_STATUSES, 'statut');
      changes.push('statut');
    }
    c.updated_at = Date.now();
    db.prepare('UPDATE cases SET title = ?, reference = ?, description = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(c.title, c.reference, c.description, c.status, c.updated_at, c.id);
    if (changes.length) log(c.id, req.user, `a modifié le dossier (${changes.join(', ')})`);
    realtime.broadcast(c.id, { t: 'case', case: c, origin: origin(req) });
    res.json({ case: c });
  });

  app.delete('/api/cases/:id', auth.requireAdmin, (req, res) => {
    const c = mustGet(getCase, id(req.params.id));
    db.prepare('DELETE FROM cases WHERE id = ?').run(c.id);
    realtime.closeRoom(c.id);
    res.json({ ok: true });
  });

  app.get('/api/cases/:id/activity', auth.requireAuth, (req, res) => {
    const c = mustGet(getCase, id(req.params.id));
    const rows = db.prepare('SELECT * FROM activity WHERE case_id = ? ORDER BY id DESC LIMIT 300').all(c.id);
    res.json({ activity: rows.map(plain) });
  });

  // ── board items ─────────────────────────────────────────────────────
  app.post('/api/cases/:id/items', auth.requireEditor, (req, res) => {
    const c = mustGet(getCase, id(req.params.id));
    const b = req.body || {};
    const type = oneOf(b.type, Object.keys(ITEM_TYPES), 'type');
    const item = {
      type, title: '', subtitle: '', body: '', image: '', event_date: '', color: '',
      x: BOARD_W / 2, y: BOARD_H / 2, w: type === 'zone' ? 700 : 230, h: type === 'zone' ? 450 : 0, rotation: 0,
    };
    for (const [k, fn] of Object.entries({ ...ITEM_FIELDS, ...GEOMETRY_FIELDS })) if (b[k] !== undefined) item[k] = fn(b[k]);
    const now = Date.now();
    const created = tx(() => {
      const { number } = db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS number FROM items WHERE case_id = ? AND type = ?').get(c.id, type);
      const { z } = db.prepare('SELECT COALESCE(MAX(z), 0) + 1 AS z FROM items WHERE case_id = ?').get(c.id);
      const { lastInsertRowid } = db.prepare(`
        INSERT INTO items (case_id, type, number, title, subtitle, body, image, event_date, color, x, y, w, h, rotation, z, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        c.id, type, number, item.title, item.subtitle, item.body, item.image, item.event_date, item.color,
        item.x, item.y, item.w, item.h, item.rotation, type === 'zone' ? -z : z, req.user.id, now, now);
      return getItem(Number(lastInsertRowid));
    });
    touchCase(c.id);
    realtime.broadcast(c.id, { t: 'item', item: created, origin: origin(req) });
    log(c.id, req.user, `a ajouté ${itemName(created)}`);
    res.status(201).json({ item: created });
  });

  app.patch('/api/items/:id', auth.requireEditor, (req, res) => {
    const item = mustGet(getItem, id(req.params.id));
    const b = req.body || {};
    const changed = [];
    for (const [k, fn] of Object.entries(ITEM_FIELDS)) {
      if (b[k] === undefined) continue;
      const value = fn(b[k]);
      if (value !== item[k]) { item[k] = value; changed.push(k); }
    }
    for (const [k, fn] of Object.entries(GEOMETRY_FIELDS)) if (b[k] !== undefined) item[k] = fn(b[k]);
    item.updated_at = Date.now();
    db.prepare(`UPDATE items SET title = ?, subtitle = ?, body = ?, image = ?, event_date = ?, color = ?,
      x = ?, y = ?, w = ?, h = ?, rotation = ?, z = ?, updated_at = ? WHERE id = ?`).run(
      item.title, item.subtitle, item.body, item.image, item.event_date, item.color,
      item.x, item.y, item.w, item.h, item.rotation, item.z, item.updated_at, item.id);
    touchCase(item.case_id);
    realtime.broadcast(item.case_id, { t: 'item', item, origin: origin(req) });
    if (changed.some((k) => k !== 'color')) log(item.case_id, req.user, `a modifié ${itemName(item)}`);
    res.json({ item });
  });

  // Moves several items at once (dragging a zone carries the cards pinned inside it).
  app.post('/api/cases/:id/positions', auth.requireEditor, (req, res) => {
    const c = mustGet(getCase, id(req.params.id));
    const list = Array.isArray(req.body?.items) ? req.body.items.slice(0, 500) : [];
    const update = db.prepare('UPDATE items SET x = ?, y = ?, z = COALESCE(?, z) WHERE id = ? AND case_id = ?');
    const moved = tx(() => list.map((it) => {
      const row = { id: id(it.id), x: GEOMETRY_FIELDS.x(it.x), y: GEOMETRY_FIELDS.y(it.y), z: it.z === undefined ? null : GEOMETRY_FIELDS.z(it.z) };
      update.run(row.x, row.y, row.z, row.id, c.id);
      return row;
    }));
    touchCase(c.id);
    realtime.broadcast(c.id, { t: 'positions', items: moved, origin: origin(req) });
    res.json({ ok: true });
  });

  app.delete('/api/items/:id', auth.requireEditor, (req, res) => {
    const item = mustGet(getItem, id(req.params.id));
    db.prepare('DELETE FROM items WHERE id = ?').run(item.id);
    touchCase(item.case_id);
    realtime.broadcast(item.case_id, { t: 'item:del', id: item.id, origin: origin(req) });
    log(item.case_id, req.user, `a retiré ${itemName(item)}`);
    res.json({ ok: true });
  });

  // ── strings between items ───────────────────────────────────────────
  function linkFields(b, link) {
    if (b.label !== undefined) link.label = str(b.label, 120, 'légende');
    if (b.arrow !== undefined) link.arrow = oneOf(b.arrow, ARROWS, 'flèche');
    if (b.style !== undefined) link.style = oneOf(b.style, LINK_STYLES, 'style');
    if (b.color !== undefined) link.color = color(b.color) || 'rouge';
    return link;
  }

  app.post('/api/cases/:id/links', auth.requireEditor, (req, res) => {
    const c = mustGet(getCase, id(req.params.id));
    const b = req.body || {};
    const from = getItem(Number(b.from_id));
    const to = getItem(Number(b.to_id));
    if (!from || !to || from.case_id !== c.id || to.case_id !== c.id) throw bad('Éléments à relier introuvables.');
    if (from.id === to.id) throw bad('Impossible de relier un élément à lui-même.');
    const link = linkFields(b, { label: '', arrow: 'none', style: 'solid', color: 'rouge' });
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO links (case_id, from_id, to_id, label, arrow, style, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(c.id, from.id, to.id, link.label, link.arrow, link.style, link.color, Date.now());
    const created = getLink(Number(lastInsertRowid));
    touchCase(c.id);
    realtime.broadcast(c.id, { t: 'link', link: created, origin: origin(req) });
    log(c.id, req.user, `a relié ${itemName(from)} à ${itemName(to)}`);
    res.status(201).json({ link: created });
  });

  app.patch('/api/links/:id', auth.requireEditor, (req, res) => {
    const link = linkFields(req.body || {}, mustGet(getLink, id(req.params.id)));
    db.prepare('UPDATE links SET label = ?, arrow = ?, style = ?, color = ? WHERE id = ?')
      .run(link.label, link.arrow, link.style, link.color, link.id);
    touchCase(link.case_id);
    realtime.broadcast(link.case_id, { t: 'link', link, origin: origin(req) });
    res.json({ link });
  });

  app.delete('/api/links/:id', auth.requireEditor, (req, res) => {
    const link = mustGet(getLink, id(req.params.id));
    db.prepare('DELETE FROM links WHERE id = ?').run(link.id);
    touchCase(link.case_id);
    realtime.broadcast(link.case_id, { t: 'link:del', id: link.id, origin: origin(req) });
    const from = getItem(link.from_id);
    const to = getItem(link.to_id);
    if (from && to) log(link.case_id, req.user, `a coupé le fil entre ${itemName(from)} et ${itemName(to)}`);
    res.json({ ok: true });
  });

  // ── image uploads ───────────────────────────────────────────────────
  const MIME_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };
  const upload = multer({
    storage: multer.diskStorage({
      destination: UPLOAD_DIR,
      filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + MIME_EXT[file.mimetype]),
    }),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => cb(MIME_EXT[file.mimetype] ? null : bad('Formats acceptés : PNG, JPEG, GIF, WebP.'), true),
  });

  app.post('/api/uploads', auth.requireEditor, upload.single('image'), (req, res) => {
    if (!req.file) throw bad('Aucune image reçue.');
    res.status(201).json({ url: `/uploads/${req.file.filename}` });
  });

  app.use('/uploads', auth.requireAuth, express.static(UPLOAD_DIR, {
    index: false, dotfiles: 'deny', maxAge: '30d', immutable: true,
  }));

  // ── static front-end ────────────────────────────────────────────────
  const publicDir = path.join(__dirname, '..', 'public');
  app.get('/dossier/:id', (req, res) => res.sendFile(path.join(publicDir, 'dossier.html')));
  app.use(express.static(publicDir, { extensions: ['html'] }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Introuvable.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image trop lourde (10 Mo max).' : 'Envoi invalide.' });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Requête invalide.' });
    if (!err.status || err.status >= 500) console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Erreur interne du serveur.' });
  });

  return app;
}

module.exports = { createApp, BOARD_W, BOARD_H };
