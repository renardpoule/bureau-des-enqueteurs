import { h, toast, formDialog, STATUS_LABELS, timeAgo, logout, settingsDialog, githubFields } from './common.js';
import {
  session, canWrite, restoreSession, fetchAccess, login, install, loadIndex, updateIndex, updateJSON, PATHS, defaultConfig,
} from './session.js';
import { emptyCase, newId } from './model.js';
import { demoCase } from './demo.js';

const $ = (sel) => document.querySelector(sel);
let cases = [];

async function start() {
  if (await restoreSession()) return showApp();
  let access;
  try {
    access = await fetchAccess();
  } catch (err) {
    showLogin();
    $('#login-error').textContent = err.message;
    return;
  }
  if (access) showLogin(); else showSetup();
}

function showLogin() {
  $('#login-view').hidden = false;
  const form = $('#login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#login-error').textContent = '';
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Vérification…';
    try {
      const ok = await login(form.username.value.trim(), form.password.value, form.remember.checked);
      if (!ok) {
        await new Promise((r) => setTimeout(r, 800));
        $('#login-error').textContent = 'Code du comité incorrect.';
        return;
      }
      const next = new URLSearchParams(location.search).get('next');
      if (next && /^dossier\.html\?id=[a-z0-9]+$/.test(next)) { location.href = next; return; }
      form.reset();
      $('#login-view').hidden = true;
      showApp();
    } catch (err) {
      $('#login-error').textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Entrer';
    }
  });
  form.username.focus();
}

function showSetup() {
  $('#setup-view').hidden = false;
  const gh = githubFields(defaultConfig());
  $('#setup-github').append(h('h3', { class: 'setup-sub' }, 'Enregistrement sur GitHub'), gh.el);
  const form = $('#setup-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#setup-error');
    err.textContent = '';
    const name = form.name.value.trim();
    const code = form.code.value;
    const config = gh.values();
    if (!name) { err.textContent = 'Indiquez votre nom.'; return; }
    if (code.length < 8) { err.textContent = 'Le code du comité doit faire au moins 8 caractères.'; return; }
    if (code !== form.code2.value) { err.textContent = 'Les deux codes ne correspondent pas.'; return; }
    if (!config.owner || !config.repo || !config.token) { err.textContent = 'Le compte, le dépôt et le jeton GitHub sont nécessaires pour installer le bureau.'; return; }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Installation…';
    try {
      await install({ name, code, config });
      toast('Bureau installé ! Donnez le code du comité aux autres membres.', 'ok');
      $('#setup-view').hidden = true;
      showApp();
    } catch (error) {
      err.textContent = error.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Installer le bureau';
    }
  });
}

async function showApp() {
  $('#app-view').hidden = false;
  refreshChrome();
  await loadCases();
}

function refreshChrome() {
  $('#whoami').textContent = `${session.name}${canWrite() ? '' : ' · lecture seule'}`;
  $('#btn-new-case').hidden = !canWrite();
  $('#readonly-banner').hidden = canWrite();
}

async function loadCases() {
  try {
    ({ cases } = await loadIndex());
  } catch (err) {
    toast(`Impossible de lire les dossiers : ${err.message}`, 'error');
    cases = [];
  }
  renderCases();
}

function renderCases() {
  const q = $('#case-search').value.trim().toLowerCase();
  const status = $('#case-filter').value;
  const sorted = [...cases].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  const shown = sorted.filter((c) => (!status || c.status === status)
    && (!q || `${c.reference} ${c.title} ${c.description}`.toLowerCase().includes(q)));
  const open = cases.filter((c) => c.status === 'ouvert' || c.status === 'en_cours').length;
  $('#case-count').textContent = `${cases.length} dossier${cases.length > 1 ? 's' : ''} · ${open} en cours d'instruction`;

  const box = $('#cases');
  box.replaceChildren();
  if (!shown.length) {
    box.append(h('div', { class: 'empty' },
      h('strong', {}, cases.length ? 'Aucun dossier ne correspond.' : 'Aucun dossier pour le moment.'),
      cases.length ? 'Modifiez la recherche ou le filtre.' : (canWrite() ? 'Ouvrez le premier dossier avec « Nouveau dossier », ou découvrez le tableau avec un exemple.' : ''),
      !cases.length && canWrite() && h('div', { class: 'empty-actions' },
        h('button', { type: 'button', class: 'btn', onclick: (e) => demo(e.currentTarget) }, "Créer un dossier d'exemple"))));
    return;
  }
  for (const c of shown) {
    box.append(h('a', { class: 'folder', href: `dossier.html?id=${c.id}`, dataset: { ref: c.reference } },
      h('span', { class: `stamp status-${c.status}` }, STATUS_LABELS[c.status]),
      h('h2', {}, c.title),
      c.description && h('p', {}, c.description),
      h('div', { class: 'folder-meta' },
        h('span', {}, c.item_count !== undefined ? `${c.item_count} élément${c.item_count > 1 ? 's' : ''} au tableau` : ''),
        c.updated_at && h('span', { title: new Date(c.updated_at).toLocaleString('fr-FR') }, `Modifié ${timeAgo(c.updated_at)}`)),
    ));
  }
}

/** Crée l'entrée dans la liste puis le fichier du dossier. */
async function createCase({ title, reference = '', description = '' }, buildDoc) {
  const now = Date.now();
  const id = newId();
  let meta;
  // La liste est mise à jour en premier pour que la référence générée soit unique.
  await updateIndex((index) => {
    const ref = reference.trim() || `CD-${new Date().getFullYear()}-${String(index.cases.length + 1).padStart(3, '0')}`;
    meta = {
      id, reference: ref, title: title.trim(), description: description.trim(),
      status: 'ouvert', created_by: session.name, created_at: now, updated_at: now, item_count: 0,
    };
    index.cases = index.cases.filter((c) => c.id !== id).concat(meta);
  });
  const doc = buildDoc(meta);
  await updateJSON(PATHS.dossier(id), () => doc, 'Nouveau dossier');
  return id;
}

async function demo(btn) {
  btn.disabled = true;
  btn.textContent = 'Création…';
  try {
    const id = await createCase({
      title: 'Saisie disparue — Agent K. Morel (exemple)',
      reference: 'EXEMPLE',
      description: "Le 12/03, 40 000 $ saisis lors d'une descente au port ne figurent plus au registre des scellés. L'agent Morel était seul de garde au dépôt ce soir-là.",
    }, (meta) => {
      const doc = demoCase({ ...meta, status: 'en_cours' }, session.name);
      return doc;
    });
    await updateIndex((index) => {
      const e = index.cases.find((c) => c.id === id);
      if (e) Object.assign(e, { status: 'en_cours', item_count: 12 });
    });
    location.href = `dossier.html?id=${id}`;
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = "Créer un dossier d'exemple";
  }
}

async function newCase() {
  const result = await formDialog({
    title: 'Ouvrir un dossier',
    ok: 'Ouvrir le dossier',
    fields: [
      { name: 'title', label: 'Intitulé', required: true, placeholder: 'Ex. : Abus de pouvoir — Agent Martin' },
      { name: 'reference', label: 'Référence (laisser vide pour la générer)', placeholder: `CD-${new Date().getFullYear()}-001` },
      { name: 'description', label: 'Résumé des faits', type: 'textarea' },
    ],
    submit: async (v) => {
      const id = await createCase(v, (meta) => {
        const doc = emptyCase(meta);
        doc.activity.push({ id: newId(), user: session.name, action: `a ouvert le dossier « ${meta.title} »`, at: meta.created_at });
        return doc;
      });
      return { id };
    },
  });
  if (result?.id) location.href = `dossier.html?id=${result.id}`;
}

$('#case-search').addEventListener('input', renderCases);
$('#case-filter').addEventListener('change', renderCases);
$('#btn-new-case').addEventListener('click', newCase);
$('#btn-settings').addEventListener('click', () => settingsDialog(() => { refreshChrome(); loadCases(); }));
$('#btn-banner-settings').addEventListener('click', () => settingsDialog(() => { refreshChrome(); loadCases(); }));
$('#btn-logout').addEventListener('click', logout);

start();
