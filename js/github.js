// Lecture / écriture des fichiers du dépôt via l'API GitHub (comme le site « lastwar »).
import { textToB64, b64ToText } from './crypto.js';

export class GitHubError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Devine le compte et le dépôt quand le site est servi par GitHub Pages. */
export function detectRepo() {
  const host = location.hostname;
  if (!host.endsWith('.github.io')) return {};
  const owner = host.split('.')[0];
  const first = location.pathname.split('/').filter(Boolean)[0];
  const repo = !first || first.includes('.') ? `${owner}.github.io` : first;
  return { owner, repo };
}

export class GitHub {
  constructor({ owner, repo, branch, token }) {
    this.owner = owner;
    this.repo = repo;
    this.branch = branch || '';
    this.token = token;
    this.cache = new Map(); // chemin -> { etag, text, sha }
    this.superseded = new Map(); // chemin -> Set(sha) : versions qu'on sait dépassées
  }

  get ready() { return Boolean(this.owner && this.repo && this.token); }

  async request(method, path, body, extraHeaders = {}) {
    let res;
    try {
      res = await fetch(`https://api.github.com/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}${path}`, {
        method,
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...extraHeaders,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new GitHubError(0, 'GitHub est injoignable (connexion internet ?).');
    }
    return res;
  }

  async fail(res) {
    const j = await res.json().catch(() => ({}));
    const msg = {
      401: 'Jeton GitHub invalide ou expiré.',
      403: "Le jeton GitHub n'a pas le droit d'écrire sur ce dépôt (ou limite d'utilisation atteinte).",
      404: 'Dépôt ou fichier introuvable : vérifiez le compte, le dépôt, la branche et les droits du jeton.',
    }[res.status];
    throw new GitHubError(res.status, (msg || `Erreur GitHub ${res.status}`) + (j.message && !msg ? ` (${j.message})` : ''));
  }

  ref() { return this.branch ? `?ref=${encodeURIComponent(this.branch)}` : ''; }

  /** { text, sha } ou null si le fichier n'existe pas. */
  async get(path) {
    const cached = this.cache.get(path);
    const res = await this.request('GET', `/contents/${path}${this.ref()}`, null, cached ? { 'If-None-Match': cached.etag } : {});
    if (res.status === 304 && cached) return { text: cached.text, sha: cached.sha };
    if (res.status === 404) return null;
    if (!res.ok) await this.fail(res);
    const j = await res.json();
    let content = j.content;
    if (!content && j.size > 0) {
      // Fichier de plus de 1 Mo : l'API « contents » ne renvoie pas le contenu, on passe par le blob.
      const blob = await this.request('GET', `/git/blobs/${j.sha}`);
      if (!blob.ok) await this.fail(blob);
      content = (await blob.json()).content;
    }
    const text = b64ToText(content || '');
    if (res.headers.get('ETag')) this.cache.set(path, { etag: res.headers.get('ETag'), text, sha: j.sha });
    return { text, sha: j.sha };
  }

  isSuperseded(path, sha) {
    return Boolean(sha && this.superseded.get(path)?.has(sha));
  }

  /** Écrit un fichier. `sha` = version lue (null pour une création). Renvoie la nouvelle version. */
  async put(path, text, sha, message) {
    const body = { message, content: textToB64(text) };
    if (sha) body.sha = sha;
    if (this.branch) body.branch = this.branch;
    const res = await this.request('PUT', `/contents/${path}`, body);
    if (res.status === 409 || (res.status === 422 && sha !== undefined)) {
      throw new GitHubError(409, 'Conflit de version.');
    }
    if (!res.ok) await this.fail(res);
    const j = await res.json();
    if (sha) {
      if (!this.superseded.has(path)) this.superseded.set(path, new Set());
      this.superseded.get(path).add(sha);
    }
    this.cache.delete(path);
    return j.content.sha;
  }

  async remove(path, sha, message) {
    const body = { message, sha };
    if (this.branch) body.branch = this.branch;
    const res = await this.request('DELETE', `/contents/${path}`, body);
    if (res.status === 404) return;
    if (!res.ok) await this.fail(res);
    this.cache.delete(path);
  }

  /** Vérifie l'accès en écriture au dépôt. */
  async check() {
    const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json' },
    }).catch(() => null);
    if (!res) throw new GitHubError(0, 'GitHub est injoignable.');
    if (!res.ok) await this.fail(res);
    const j = await res.json();
    if (j.permissions && !j.permissions.push) throw new GitHubError(403, "Ce jeton peut lire le dépôt mais pas y écrire (droit « Contents : Read and write » manquant).");
    return j;
  }
}
