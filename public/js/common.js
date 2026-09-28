// Shared helpers for every page: API calls, DOM building, dialogs, toasts.

export const CLIENT_ID = (globalThis.crypto?.randomUUID?.() ?? `c${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(method, url, body) {
  const opts = { method, headers: { 'X-Requested-With': 'bde', 'X-Client-Id': CLIENT_ID } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try { res = await fetch(url, opts); } catch { throw new ApiError(0, 'Serveur injoignable.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Erreur ${res.status}`);
  return data;
}

export async function uploadImage(file) {
  const form = new FormData();
  form.append('image', file);
  const res = await fetch('/api/uploads', { method: 'POST', body: form, headers: { 'X-Requested-With': 'bde' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || "Échec de l'envoi de l'image.");
  return data.url;
}

/** h('div', { class: 'x', onclick }, child, 'text', [more]) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null) continue;
    if (v === false) {
      if (k === 'draggable') el.setAttribute(k, 'false');
      continue;
    }
    // Boolean attributes go through setAttribute so they also set the default state
    // (e.g. `selected` must survive a form.reset()).
    if (v === true) el.setAttribute(k, '');
    else if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, val); else el.style[prop] = val;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === undefined || c === null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

let toastBox;
export function toast(message, kind = 'info') {
  if (!toastBox) toastBox = document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const t = h('div', { class: `toast toast-${kind}` }, message);
  toastBox.append(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3700);
}

/**
 * Opens a modal dialog. `build(close)` returns the dialog content.
 * Resolves with the value passed to close().
 */
export function modal(build, { className = '' } = {}) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: `modal ${className}` });
    let result;
    const close = (value) => { result = value; dlg.close(); };
    dlg.append(build(close));
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector('[autofocus]')?.focus();
  });
}

export function confirmDialog(message, { ok = 'Confirmer', danger = false, title = 'Confirmation' } = {}) {
  return modal((close) => h('div', { class: 'modal-body' },
    h('h2', {}, title),
    h('p', {}, message),
    h('div', { class: 'modal-actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => close(false) }, 'Annuler'),
      h('button', { type: 'button', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, autofocus: true, onclick: () => close(true) }, ok),
    ),
  )).then(Boolean);
}

/**
 * Form dialog. fields: [{ name, label, type?, value?, options?, required?, placeholder? }]
 * `submit(values)` may throw an Error to keep the dialog open and show its message.
 */
export function formDialog({ title, fields, ok = 'Enregistrer', intro, submit }) {
  return modal((close) => {
    const error = h('p', { class: 'form-error', role: 'alert' });
    const inputs = {};
    const form = h('form', { class: 'modal-body', novalidate: true },
      h('h2', {}, title),
      intro && h('p', { class: 'muted' }, intro),
      fields.map((f, i) => {
        let input;
        if (f.type === 'select') {
          input = h('select', { name: f.name }, f.options.map(([v, label]) => h('option', { value: v, selected: v === f.value }, label)));
        } else if (f.type === 'textarea') {
          input = h('textarea', { name: f.name, rows: 4, placeholder: f.placeholder || '' });
          input.value = f.value || '';
        } else {
          input = h('input', { name: f.name, type: f.type || 'text', placeholder: f.placeholder || '', autocomplete: f.autocomplete || 'off' });
          input.value = f.value || '';
        }
        if (i === 0) input.autofocus = true;
        inputs[f.name] = input;
        return h('label', { class: 'field' }, h('span', {}, f.label), input);
      }),
      error,
      h('div', { class: 'modal-actions' },
        h('button', { type: 'button', class: 'btn', onclick: () => close(null) }, 'Annuler'),
        h('button', { type: 'submit', class: 'btn btn-primary' }, ok),
      ),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value]));
      for (const f of fields) {
        if (f.required && !values[f.name].trim()) { error.textContent = `« ${f.label} » est obligatoire.`; inputs[f.name].focus(); return; }
      }
      try {
        const result = submit ? await submit(values) : values;
        close(result ?? values);
      } catch (err) {
        error.textContent = err.message;
      }
    });
    return form;
  });
}

export const ROLE_LABELS = { admin: 'Administrateur', enqueteur: 'Enquêteur', observateur: 'Observateur' };
export const STATUS_LABELS = { ouvert: 'Ouvert', en_cours: 'En cours', clos: 'Clos', classe: 'Classé sans suite' };

export function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return "à l'instant";
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `il y a ${hr} h`;
  const d = Math.round(hr / 24);
  if (d < 30) return `il y a ${d} j`;
  return new Date(ts).toLocaleDateString('fr-FR');
}

export function initials(name) {
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
}

export async function logout() {
  await api('POST', '/api/logout').catch(() => {});
  location.href = '/';
}

export function changePasswordDialog() {
  return formDialog({
    title: 'Changer mon mot de passe',
    ok: 'Changer',
    fields: [
      { name: 'current', label: 'Mot de passe actuel', type: 'password', autocomplete: 'current-password', required: true },
      { name: 'next', label: 'Nouveau mot de passe (8 caractères min.)', type: 'password', autocomplete: 'new-password', required: true },
      { name: 'confirm', label: 'Confirmer le nouveau mot de passe', type: 'password', autocomplete: 'new-password', required: true },
    ],
    submit: async (v) => {
      if (v.next !== v.confirm) throw new Error('Les deux mots de passe ne correspondent pas.');
      await api('POST', '/api/me/password', { current: v.current, next: v.next });
      toast('Mot de passe modifié.', 'ok');
    },
  });
}
