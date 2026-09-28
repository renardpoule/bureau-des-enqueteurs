// Session de l'enquêteur, accès aux fichiers chiffrés du dépôt et images.
import * as C from './crypto.js';
import { GitHub, detectRepo } from './github.js';
import { newId } from './model.js';

const SESSION_KEY = 'bde-session';
const CONFIG_KEY = 'bde-github';
const SESSION_MS = 12 * 3600 * 1000;

export const PATHS = {
  access: 'data/acces.json',
  index: 'data/index.json',
  dossier: (id) => `data/dossiers/${id}.json`,
  image: (id) => `data/images/${id}.json`,
};

export const session = { name: '', key: null, raw: null, gh: null, config: {} };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (st, k) => { try { return JSON.parse(st.getItem(k)); } catch { return null; } };
const write = (st, k, v) => { try { st.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } };
const drop = (st, k) => { try { st.removeItem(k); } catch { /* idem */ } };

export const canWrite = () => Boolean(session.gh);

// ── session ───────────────────────────────────────────────────────────
async function openSession(name, raw) {
  session.name = name;
  session.raw = raw;
  session.key = await C.importDataKey(raw);
  session.config = await loadConfig();
  session.gh = session.config.token && session.config.owner && session.config.repo ? new GitHub(session.config) : null;
}

function persist(remember) {
  const value = { name: session.name, raw: C.b64(session.raw), expire: Date.now() + SESSION_MS, remember };
  drop(sessionStorage, SESSION_KEY);
  drop(localStorage, SESSION_KEY);
  write(remember ? localStorage : sessionStorage, SESSION_KEY, value);
}

export async function restoreSession() {
  const s = read(sessionStorage, SESSION_KEY) || read(localStorage, SESSION_KEY);
  if (!s || !s.raw || s.expire < Date.now()) return false;
  try {
    await openSession(s.name, C.unb64(s.raw));
    return true;
  } catch {
    return false;
  }
}

export async function fetchAccess() {
  const res = await fetch(`${PATHS.access}?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null);
  if (!res) throw new Error('Site injoignable.');
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Impossible de lire ${PATHS.access} (${res.status}).`);
  return res.json();
}

export async function login(name, code, remember) {
  const access = await fetchAccess();
  if (!access) throw new Error("Le bureau n'est pas encore installé.");
  const raw = await C.unwrapDataKey(code, access);
  if (!raw) return false;
  await openSession(name, raw);
  persist(remember);
  return true;
}

export function logout() {
  drop(sessionStorage, SESSION_KEY);
  drop(localStorage, SESSION_KEY);
}

export function setName(name) {
  session.name = name;
  const remember = read(localStorage, SESSION_KEY) !== null;
  persist(remember);
}

// ── réglages GitHub (chiffrés avec la clé du bureau) ──────────────────
async function loadConfig() {
  const box = read(localStorage, CONFIG_KEY);
  let config = {};
  if (box) {
    try { config = JSON.parse(new TextDecoder().decode(await C.decryptBytes(session.key, box))); } catch { config = {}; }
  }
  const detected = detectRepo();
  return { owner: config.owner || detected.owner || '', repo: config.repo || detected.repo || '', branch: config.branch || '', token: config.token || '' };
}

export async function saveConfig(config) {
  const clean = { owner: config.owner.trim(), repo: config.repo.trim(), branch: config.branch.trim(), token: config.token.trim() };
  if (clean.token) {
    const gh = new GitHub(clean);
    await gh.check();
    session.gh = gh;
  } else {
    session.gh = null;
  }
  session.config = clean;
  write(localStorage, CONFIG_KEY, await C.encryptBytes(session.key, new TextEncoder().encode(JSON.stringify(clean))));
}

export const defaultConfig = () => ({ owner: '', repo: '', branch: '', token: '', ...detectRepo() });

// ── fichiers ──────────────────────────────────────────────────────────
/** { text, sha } ou null. Sans jeton, on lit la copie publiée par GitHub Pages. */
export async function readText(path) {
  if (session.gh) return session.gh.get(path);
  const res = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null);
  if (!res) throw new Error('Site injoignable.');
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Lecture impossible (${res.status}).`);
  return { text: await res.text(), sha: null };
}

export async function readJSON(path) {
  const file = await readText(path);
  if (!file) return null;
  return { data: await C.decryptJSON(session.key, file.text), sha: file.sha };
}

/**
 * Lit, modifie et réécrit un fichier chiffré, en recommençant si quelqu'un d'autre
 * l'a modifié entre-temps. `mutate(courant)` renvoie la nouvelle valeur.
 */
export async function updateJSON(path, mutate, message = 'Mise à jour du bureau') {
  if (!session.gh) throw new Error('Un jeton GitHub est nécessaire pour enregistrer (menu Réglages).');
  for (let attempt = 0; attempt < 8; attempt++) {
    const file = await session.gh.get(path);
    if (file && session.gh.isSuperseded(path, file.sha)) {
      // GitHub renvoie encore l'ancienne version : on patiente un peu.
      session.gh.cache.delete(path);
      await sleep(600 * (attempt + 1));
      continue;
    }
    const current = file ? await C.decryptJSON(session.key, file.text) : null;
    const next = mutate(current);
    try {
      const sha = await session.gh.put(path, await C.encryptJSON(session.key, next), file ? file.sha : null, message);
      return { data: next, sha };
    } catch (err) {
      if (err.status !== 409) throw err;
      session.gh.cache.delete(path);
      await sleep(300 + Math.random() * 900);
    }
  }
  throw new Error("Impossible d'enregistrer : trop de modifications en même temps. Réessayez.");
}

export async function loadIndex() {
  const res = await readJSON(PATHS.index);
  return res?.data || { v: 1, cases: [] };
}

export function updateIndex(mutator) {
  return updateJSON(PATHS.index, (current) => {
    const index = current || { v: 1, cases: [] };
    mutator(index);
    return index;
  });
}

// ── installation et code du comité ────────────────────────────────────
export async function install({ name, code, config }) {
  const gh = new GitHub(config);
  await gh.check();
  if (await gh.get(PATHS.access)) throw new Error('Le bureau est déjà installé sur ce dépôt : connectez-vous avec le code du comité.');
  const { access, raw } = await C.createAccess(code);
  const key = await C.importDataKey(raw);
  if (!(await gh.get(PATHS.index))) await gh.put(PATHS.index, await C.encryptJSON(key, { v: 1, cases: [] }), null, 'Installation du bureau des enquêteurs');
  await gh.put(PATHS.access, `${JSON.stringify(access, null, 2)}\n`, null, 'Installation du bureau des enquêteurs');
  await openSession(name, raw);
  await saveConfig(config);
  persist(true);
}

export async function changeCode(newCode) {
  if (!session.gh) throw new Error('Un jeton GitHub est nécessaire.');
  const access = await C.wrapDataKey(newCode, session.raw);
  const current = await session.gh.get(PATHS.access);
  await session.gh.put(PATHS.access, `${JSON.stringify(access, null, 2)}\n`, current?.sha ?? null, 'Changement du code du comité');
}

// ── images ────────────────────────────────────────────────────────────
const imageCache = new Map();

async function prepareImage(file) {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error('Formats acceptés : PNG, JPEG, GIF, WebP.');
  if (file.type === 'image/gif' && file.size <= 2e6) return { bytes: new Uint8Array(await file.arrayBuffer()), type: 'image/gif' };
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'image/jpeg' };
}

/** Compresse, chiffre et envoie une image. Renvoie la référence à stocker dans l'élément. */
export async function uploadImage(file) {
  if (!session.gh) throw new Error('Un jeton GitHub est nécessaire pour envoyer des images.');
  const { bytes, type } = await prepareImage(file);
  const id = newId();
  const box = await C.encryptBytes(session.key, bytes, { type });
  await session.gh.put(PATHS.image(id), JSON.stringify(box), null, "Ajout d'une image");
  imageCache.set(id, Promise.resolve(URL.createObjectURL(new Blob([bytes], { type }))));
  return `enc:${id}`;
}

/** URL affichable pour une image (déchiffrée si elle vient du bureau). */
export function imageURL(ref) {
  if (!ref.startsWith('enc:')) return Promise.resolve(ref);
  const id = ref.slice(4);
  if (!/^[a-z0-9]+$/.test(id)) return Promise.reject(new Error('Image invalide.'));
  if (!imageCache.has(id)) {
    const p = (async () => {
      const file = await readText(PATHS.image(id));
      if (!file) throw new Error('Image introuvable.');
      session.gh?.cache.delete(PATHS.image(id));
      const box = JSON.parse(file.text);
      const bytes = await C.decryptBytes(session.key, box);
      return URL.createObjectURL(new Blob([bytes], { type: box.type || 'image/jpeg' }));
    })();
    p.catch(() => imageCache.delete(id));
    imageCache.set(id, p);
  }
  return imageCache.get(id);
}
