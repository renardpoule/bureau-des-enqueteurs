'use strict';

const crypto = require('node:crypto');
const { db } = require('./db');

const COOKIE = 'bde_session';
const SESSION_MS = 14 * 24 * 3600 * 1000;

const ROLES = ['admin', 'enqueteur', 'observateur'];

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), userId, Date.now() + SESSION_MS);
  return token;
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    try { out[key] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed */ }
  }
  return out;
}

function sessionToken(req) {
  return parseCookies(req.headers.cookie)[COOKIE] || null;
}

function userFromRequest(req) {
  const token = sessionToken(req);
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).get(sha256(token), Date.now());
  return row ? { ...row } : null;
}

function setSessionCookie(req, res, token) {
  const secure = process.env.COOKIE_SECURE === '1' || req.secure;
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

const canEdit = (user) => user && (user.role === 'admin' || user.role === 'enqueteur');

function requireAuth(req, res, next) {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Non connecté.' });
  req.user = user;
  next();
}

function requireEditor(req, res, next) {
  requireAuth(req, res, () => {
    if (!canEdit(req.user)) return res.status(403).json({ error: 'Accès en lecture seule.' });
    next();
  });
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs.' });
    next();
  });
}

/** Creates the first administrator account when the database has no users. */
function bootstrapAdmin() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (n > 0) return;
  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(username, 'Président du comité', hashPassword(password), 'admin', Date.now());
  console.log('──────────────────────────────────────────────');
  console.log(' Premier compte administrateur créé :');
  console.log(`   identifiant  : ${username}`);
  if (process.env.ADMIN_PASSWORD) console.log('   mot de passe : (celui de ADMIN_PASSWORD)');
  else console.log(`   mot de passe : ${password}`);
  console.log(' Changez-le dès la première connexion.');
  console.log('──────────────────────────────────────────────');
}

module.exports = {
  ROLES, hashPassword, verifyPassword, createSession, destroySession, sessionToken,
  userFromRequest, setSessionCookie, clearSessionCookie, canEdit,
  requireAuth, requireEditor, requireAdmin, bootstrapAdmin,
};
