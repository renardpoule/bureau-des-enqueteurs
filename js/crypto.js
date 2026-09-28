// Chiffrement des données du bureau (AES-GCM 256).
// Une clé de données aléatoire chiffre tous les fichiers ; elle est elle-même chiffrée
// par une clé dérivée du code du comité (PBKDF2). Changer le code ne réécrit que acces.json.

const enc = new TextEncoder();
const dec = new TextDecoder();
const ITERATIONS = 310000;

export function b64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export const unb64 = (s) => Uint8Array.from(atob(s.replace(/\s/g, '')), (c) => c.charCodeAt(0));
export const textToB64 = (text) => b64(enc.encode(text));
export const b64ToText = (s) => dec.decode(unb64(s));

const random = (n) => crypto.getRandomValues(new Uint8Array(n));

async function keyFromCode(code, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(code.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export const importDataKey = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

/** Nouvelle clé de données, protégée par le code du comité. */
export async function createAccess(code) {
  const raw = random(32);
  return { access: await wrapDataKey(code, raw), raw };
}

/** Contenu de acces.json : la clé de données chiffrée par le code. */
export async function wrapDataKey(code, raw) {
  const salt = random(16);
  const iv = random(12);
  const key = await keyFromCode(code, salt, ITERATIONS);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, raw);
  return { v: 1, sel: b64(salt), iterations: ITERATIONS, iv: b64(iv), cle: b64(data) };
}

/** Retourne la clé de données, ou null si le code est faux. */
export async function unwrapDataKey(code, access) {
  const key = await keyFromCode(code, unb64(access.sel), access.iterations);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(access.iv) }, key, unb64(access.cle)));
  } catch {
    return null;
  }
}

export async function encryptBytes(key, bytes, extra = {}) {
  const iv = random(12);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { v: 1, ...extra, iv: b64(iv), data: b64(data) };
}

export async function decryptBytes(key, box) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.data)));
}

export async function encryptJSON(key, value) {
  return `${JSON.stringify(await encryptBytes(key, enc.encode(JSON.stringify(value))))}\n`;
}

export async function decryptJSON(key, text) {
  return JSON.parse(dec.decode(await decryptBytes(key, JSON.parse(text))));
}
