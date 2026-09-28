// Outils communs à toutes les pages : construction du DOM, fenêtres, notifications, réglages.
import { session, saveConfig, changeCode, setName, logout as endSession, canWrite } from './session.js';

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


export function logout() {
  endSession();
  location.href = 'index.html';
}

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

/** Champs « compte / dépôt / branche / jeton » réutilisés à l'installation et dans les réglages. */
export function githubFields(config) {
  const f = {
    owner: h('input', { type: 'text', value: config.owner || '', autocomplete: 'off', spellcheck: 'false' }),
    repo: h('input', { type: 'text', value: config.repo || '', autocomplete: 'off', spellcheck: 'false' }),
    branch: h('input', { type: 'text', value: config.branch || '', placeholder: '(branche par défaut)', autocomplete: 'off', spellcheck: 'false' }),
    token: h('input', { type: 'password', value: config.token || '', autocomplete: 'off', spellcheck: 'false', placeholder: 'github_pat_…' }),
  };
  const el = h('div', { class: 'gh-fields' },
    h('div', { class: 'field-row' },
      h('label', { class: 'field' }, h('span', {}, 'Compte GitHub'), f.owner),
      h('label', { class: 'field' }, h('span', {}, 'Dépôt'), f.repo)),
    h('label', { class: 'field' }, h('span', {}, 'Branche'), f.branch),
    h('label', { class: 'field' }, h('span', {}, 'Jeton d’accès GitHub'), f.token,
      h('small', { class: 'muted' }, 'Jeton « fine-grained » limité à ce dépôt, avec le droit ',
        h('b', {}, 'Contents : Read and write'), '. ',
        h('a', { href: TOKEN_URL, target: '_blank', rel: 'noopener' }, 'Créer un jeton'), '. Sans jeton, le bureau est en lecture seule.')));
  const values = () => ({ owner: f.owner.value, repo: f.repo.value, branch: f.branch.value, token: f.token.value });
  return { el, values };
}

/** Fenêtre de réglages : nom, accès GitHub, code du comité. `onChange` est appelé après un enregistrement. */
export function settingsDialog(onChange) {
  return modal((close) => {
    const name = h('input', { type: 'text', value: session.name, maxlength: 60 });
    const gh = githubFields(session.config);
    const error = h('p', { class: 'form-error', role: 'alert' });
    const save = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Enregistrer');

    const code1 = h('input', { type: 'password', autocomplete: 'new-password' });
    const code2 = h('input', { type: 'password', autocomplete: 'new-password' });
    const codeError = h('p', { class: 'form-error', role: 'alert' });
    const codeBtn = h('button', { type: 'button', class: 'btn' }, 'Changer le code');
    codeBtn.addEventListener('click', async () => {
      codeError.textContent = '';
      if (code1.value.length < 8) { codeError.textContent = 'Le code doit faire au moins 8 caractères.'; return; }
      if (code1.value !== code2.value) { codeError.textContent = 'Les deux codes ne correspondent pas.'; return; }
      codeBtn.disabled = true;
      try {
        await changeCode(code1.value);
        code1.value = code2.value = '';
        toast('Code du comité changé. Il sera actif pour tous d’ici une à deux minutes.', 'ok');
      } catch (err) { codeError.textContent = err.message; }
      codeBtn.disabled = false;
    });

    const form = h('form', { class: 'modal-body' },
      h('h2', {}, 'Réglages'),
      h('label', { class: 'field' }, h('span', {}, 'Votre nom d’enquêteur (apparaît dans le journal)'), name),
      h('h3', { class: 'modal-sub' }, 'Enregistrement sur GitHub'),
      gh.el,
      error,
      h('div', { class: 'modal-actions' },
        h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Fermer'),
        save),
      canWrite() && h('details', { class: 'code-change' },
        h('summary', {}, 'Changer le code du comité'),
        h('p', { class: 'muted' }, 'À faire quand un membre quitte le comité. Communiquez ensuite le nouveau code aux autres membres.'),
        h('div', { class: 'field-row' },
          h('label', { class: 'field' }, h('span', {}, 'Nouveau code'), code1),
          h('label', { class: 'field' }, h('span', {}, 'Confirmer'), code2)),
        codeError,
        h('div', { class: 'modal-actions' }, codeBtn)),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.textContent = '';
      if (!name.value.trim()) { error.textContent = 'Indiquez votre nom.'; return; }
      save.disabled = true;
      save.textContent = 'Vérification…';
      try {
        setName(name.value.trim());
        await saveConfig(gh.values());
        toast(canWrite() ? 'Réglages enregistrés : vous pouvez modifier les dossiers.' : 'Réglages enregistrés (lecture seule).', 'ok');
        onChange?.();
        close();
      } catch (err) {
        error.textContent = err.message;
      }
      save.disabled = false;
      save.textContent = 'Enregistrer';
    });
    return form;
  });
}
