'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bde-test-'));
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'admin-password';

const { createApp } = require('../server/app');
const { bootstrapAdmin } = require('../server/auth');
const realtime = require('../server/realtime');

let base;
let server;

test.before(async () => {
  const log = console.log;
  console.log = () => {};
  bootstrapAdmin();
  console.log = log;
  server = http.createServer(createApp());
  realtime.setup(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.closeAllConnections();
  server.close();
});

function client() {
  let cookie = '';
  return async (method, url, body, { csrf = true } = {}) => {
    const headers = { cookie };
    if (csrf) headers['x-requested-with'] = 'bde';
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}

test('login, cases, items, links and permissions', async () => {
  const admin = client();
  assert.equal((await admin('GET', '/api/me')).status, 401);
  assert.equal((await admin('POST', '/api/login', { username: 'admin', password: 'nope' })).status, 401);
  assert.equal((await admin('POST', '/api/login', { username: 'admin', password: 'admin-password' })).status, 200);

  // CSRF guard: writes without the custom header are refused.
  assert.equal((await admin('POST', '/api/cases', { title: 'X' }, { csrf: false })).status, 403);

  const created = await admin('POST', '/api/cases', { title: 'Affaire test' });
  assert.equal(created.status, 201);
  const caseId = created.body.case.id;
  assert.match(created.body.case.reference, /^CD-\d{4}-\d{3}$/);

  const a = await admin('POST', `/api/cases/${caseId}/items`, { type: 'piece', title: 'Couteau', x: 100, y: 100 });
  const b = await admin('POST', `/api/cases/${caseId}/items`, { type: 'piece', title: 'Gant' });
  const c = await admin('POST', `/api/cases/${caseId}/items`, { type: 'temoignage', title: 'Témoin' });
  assert.equal(a.body.item.number, 1);
  assert.equal(b.body.item.number, 2);
  assert.equal(c.body.item.number, 1, 'numbering is per type');

  assert.equal((await admin('POST', `/api/cases/${caseId}/items`, { type: 'inconnu' })).status, 400);
  assert.equal((await admin('PATCH', `/api/items/${a.body.item.id}`, { image: 'javascript:alert(1)' })).status, 400);
  const patched = await admin('PATCH', `/api/items/${a.body.item.id}`, { body: 'Taché de sang', x: 250 });
  assert.equal(patched.body.item.body, 'Taché de sang');
  assert.equal(patched.body.item.x, 250);

  const link = await admin('POST', `/api/cases/${caseId}/links`, { from_id: a.body.item.id, to_id: c.body.item.id, label: 'vu par' });
  assert.equal(link.status, 201);
  assert.equal((await admin('POST', `/api/cases/${caseId}/links`, { from_id: a.body.item.id, to_id: a.body.item.id })).status, 400);
  assert.equal((await admin('PATCH', `/api/links/${link.body.link.id}`, { arrow: 'end', style: 'dashed' })).body.link.arrow, 'end');

  assert.equal((await admin('POST', `/api/cases/${caseId}/positions`, { items: [{ id: b.body.item.id, x: 10, y: 20, z: 99 }] })).status, 200);

  // Deleting an item cuts its strings.
  assert.equal((await admin('DELETE', `/api/items/${c.body.item.id}`)).status, 200);
  const board = await admin('GET', `/api/cases/${caseId}`);
  assert.equal(board.body.items.length, 2);
  assert.equal(board.body.links.length, 0);
  assert.deepEqual(board.body.items.find((i) => i.id === b.body.item.id).z, 99);

  const activity = await admin('GET', `/api/cases/${caseId}/activity`);
  assert.ok(activity.body.activity.length >= 4);

  // An observer can read but not write.
  assert.equal((await admin('POST', '/api/users', { username: 'obs', display_name: 'Observateur', password: 'password1', role: 'observateur' })).status, 201);
  const obs = client();
  assert.equal((await obs('POST', '/api/login', { username: 'obs', password: 'password1' })).status, 200);
  assert.equal((await obs('GET', `/api/cases/${caseId}`)).status, 200);
  assert.equal((await obs('POST', `/api/cases/${caseId}/items`, { type: 'note' })).status, 403);
  assert.equal((await obs('GET', '/api/users')).status, 403);
  assert.equal((await obs('DELETE', `/api/cases/${caseId}`)).status, 403);

  // An investigator can edit but not delete a whole case.
  assert.equal((await admin('POST', '/api/users', { username: 'enq', display_name: 'Enquêteur', password: 'password2' })).status, 201);
  const enq = client();
  await enq('POST', '/api/login', { username: 'enq', password: 'password2' });
  assert.equal((await enq('POST', `/api/cases/${caseId}/items`, { type: 'note', body: 'hello' })).status, 201);
  assert.equal((await enq('DELETE', `/api/cases/${caseId}`)).status, 403);
  assert.equal((await admin('DELETE', `/api/cases/${caseId}`)).status, 200);
  assert.equal((await admin('GET', `/api/cases/${caseId}`)).status, 404);

  // Uploaded files are only served to logged-in users.
  const anon = client();
  assert.equal((await anon('GET', '/uploads/whatever.png')).status, 401);
});
