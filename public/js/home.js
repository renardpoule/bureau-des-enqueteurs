import {
  api, h, toast, modal, confirmDialog, formDialog, ROLE_LABELS, STATUS_LABELS, timeAgo, initials,
  logout, changePasswordDialog,
} from './common.js';

const $ = (sel) => document.querySelector(sel);
let me = null;
let cases = [];

async function start() {
  try {
    ({ user: me } = await api('GET', '/api/me'));
  } catch {
    return showLogin();
  }
  showApp();
}

function showLogin() {
  $('#login-view').hidden = false;
  $('#app-view').hidden = true;
  const form = $('#login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#login-error').textContent = '';
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      ({ user: me } = await api('POST', '/api/login', {
        username: form.username.value, password: form.password.value,
      }));
      const next = new URLSearchParams(location.search).get('next');
      if (next && /^\/dossier\/\d+$/.test(next)) { location.href = next; return; }
      form.reset();
      showApp();
    } catch (err) {
      $('#login-error').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
  form.username.focus();
}

async function showApp() {
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  $('#whoami').textContent = `${me.display_name} · ${ROLE_LABELS[me.role]}`;
  $('#btn-members').hidden = me.role !== 'admin';
  $('#btn-new-case').hidden = me.role === 'observateur';
  await loadCases();
}

async function loadCases() {
  try {
    ({ cases } = await api('GET', '/api/cases'));
  } catch (err) {
    toast(err.message, 'error');
  }
  renderCases();
}

function renderCases() {
  const q = $('#case-search').value.trim().toLowerCase();
  const status = $('#case-filter').value;
  const shown = cases.filter((c) => (!status || c.status === status)
    && (!q || `${c.reference} ${c.title} ${c.description}`.toLowerCase().includes(q)));
  const open = cases.filter((c) => c.status === 'ouvert' || c.status === 'en_cours').length;
  $('#case-count').textContent = `${cases.length} dossier${cases.length > 1 ? 's' : ''} · ${open} en cours d'instruction`;

  const box = $('#cases');
  box.replaceChildren();
  if (!shown.length) {
    box.append(h('div', { class: 'empty' },
      h('strong', {}, cases.length ? 'Aucun dossier ne correspond.' : 'Aucun dossier pour le moment.'),
      cases.length ? 'Modifiez la recherche ou le filtre.' : (me.role !== 'observateur' ? 'Ouvrez le premier dossier avec « Nouveau dossier ».' : '')));
    return;
  }
  for (const c of shown) {
    box.append(h('a', { class: 'folder', href: `/dossier/${c.id}`, dataset: { ref: c.reference } },
      h('span', { class: `stamp status-${c.status}` }, STATUS_LABELS[c.status]),
      h('h2', {}, c.title),
      c.description && h('p', {}, c.description),
      h('div', { class: 'folder-meta' },
        h('span', {}, `${c.item_count} élément${c.item_count > 1 ? 's' : ''} au tableau`),
        h('span', { title: new Date(c.updated_at).toLocaleString('fr-FR') }, `Modifié ${timeAgo(c.updated_at)}`)),
    ));
  }
}

async function newCase() {
  const result = await formDialog({
    title: 'Ouvrir un dossier',
    ok: 'Ouvrir le dossier',
    fields: [
      { name: 'title', label: 'Intitulé', required: true, placeholder: 'Ex. : Abus de pouvoir — Agent Martin' },
      { name: 'reference', label: 'Référence (laisser vide pour la générer)', placeholder: 'CD-2026-001' },
      { name: 'description', label: 'Résumé des faits', type: 'textarea' },
    ],
    submit: (v) => api('POST', '/api/cases', v),
  });
  if (result?.case) location.href = `/dossier/${result.case.id}`;
}

// ── members management (admins) ─────────────────────────────
async function membersDialog() {
  let users = [];
  const list = h('div', { class: 'member-list' });

  const refresh = async () => {
    ({ users } = await api('GET', '/api/users'));
    list.replaceChildren(...users.map(memberRow));
  };

  const memberRow = (u) => {
    const role = h('select', { 'aria-label': `Rôle de ${u.display_name}` },
      Object.entries(ROLE_LABELS).map(([v, l]) => h('option', { value: v, selected: v === u.role }, l)));
    role.addEventListener('change', async () => {
      try { await api('PATCH', `/api/users/${u.id}`, { role: role.value }); toast('Rôle mis à jour.', 'ok'); } catch (err) { toast(err.message, 'error'); role.value = u.role; }
    });
    return h('div', { class: 'member' },
      h('span', { class: 'avatar' }, initials(u.display_name)),
      h('div', {}, h('strong', {}, u.display_name), h('small', {}, `@${u.username}`)),
      role,
      h('div', { class: 'member-actions' },
        h('button', {
          type: 'button', class: 'btn btn-sm', onclick: () => formDialog({
            title: `Nouveau mot de passe pour ${u.display_name}`,
            ok: 'Définir',
            fields: [{ name: 'password', label: 'Mot de passe (8 caractères min.)', type: 'text', required: true }],
            submit: async (v) => { await api('PATCH', `/api/users/${u.id}`, { password: v.password }); toast('Mot de passe réinitialisé.', 'ok'); },
          }),
        }, 'Mot de passe'),
        u.id !== me.id && h('button', {
          type: 'button', class: 'btn btn-sm btn-danger', onclick: async () => {
            if (!await confirmDialog(`Supprimer le compte de ${u.display_name} ?`, { ok: 'Supprimer', danger: true })) return;
            try { await api('DELETE', `/api/users/${u.id}`); await refresh(); } catch (err) { toast(err.message, 'error'); }
          },
        }, 'Retirer'),
      ));
  };

  const error = h('p', { class: 'form-error', role: 'alert' });
  const addForm = h('form', { class: 'member-add' },
    h('h3', {}, 'Ajouter un membre du comité'),
    h('label', { class: 'field' }, h('span', {}, 'Nom affiché (RP)'), h('input', { name: 'display_name', required: true, placeholder: 'Insp. Dupont' })),
    h('label', { class: 'field' }, h('span', {}, 'Identifiant de connexion'), h('input', { name: 'username', required: true, placeholder: 'dupont' })),
    h('label', { class: 'field' }, h('span', {}, 'Mot de passe provisoire'), h('input', { name: 'password', required: true, minlength: 8 })),
    h('label', { class: 'field' }, h('span', {}, 'Rôle'),
      h('select', { name: 'role' }, Object.entries(ROLE_LABELS).map(([v, l]) => h('option', { value: v, selected: v === 'enqueteur' }, l)))),
    error,
    h('div', { class: 'modal-actions' }, h('button', { type: 'submit', class: 'btn btn-primary' }, 'Ajouter')),
  );
  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    const data = Object.fromEntries(new FormData(addForm));
    try {
      await api('POST', '/api/users', data);
      addForm.reset();
      toast(`${data.display_name} a été ajouté(e).`, 'ok');
      await refresh();
    } catch (err) {
      error.textContent = err.message;
    }
  });

  try { await refresh(); } catch (err) { return toast(err.message, 'error'); }
  await modal((close) => h('div', { class: 'modal-body' },
    h('h2', {}, 'Membres du comité'),
    h('p', { class: 'muted' }, 'Enquêteurs : modifient les tableaux. Observateurs : lecture seule. Administrateurs : gèrent aussi les membres et peuvent supprimer des dossiers.'),
    list,
    addForm,
    h('div', { class: 'modal-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Fermer')),
  ), { className: 'members' });
}

$('#case-search').addEventListener('input', renderCases);
$('#case-filter').addEventListener('change', renderCases);
$('#btn-new-case').addEventListener('click', newCase);
$('#btn-members').addEventListener('click', membersDialog);
$('#btn-password').addEventListener('click', changePasswordDialog);
$('#btn-logout').addEventListener('click', logout);

start();
