import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOps, emptyCase, pushOp, clone } from '../js/model.js';
import * as C from '../js/crypto.js';

const item = (id, fields = {}) => ({ id, type: 'note', number: 1, title: '', body: '', x: 0, y: 0, z: 1, ...fields });

test('deux enquêteurs modifient le même dossier sans s’écraser', () => {
  const base = emptyCase({ id: 'c', title: 'Test' });
  base.items.push(item('a', { number: 1 }), item('b', { number: 2 }));

  // A déplace « a » ; B, en parallèle, modifie le texte de « a » et ajoute une note.
  const opsA = [{ k: 'items:pos', list: [{ id: 'a', x: 50, y: 60, z: 3 }] }];
  const opsB = [{ k: 'item:set', id: 'a', fields: { body: 'hello' } }, { k: 'item:add', item: item('c', { number: 2 }) }];

  const afterA = applyOps(clone(base), opsA);
  const merged = applyOps(clone(afterA), opsB);
  const a = merged.items.find((i) => i.id === 'a');
  assert.equal(a.x, 50);
  assert.equal(a.body, 'hello');
  // Le numéro de la nouvelle note est renuméroté car « b » a déjà le n°2.
  assert.equal(merged.items.find((i) => i.id === 'c').number, 3);
});

test('supprimer un élément coupe ses fils, et un fil vers un élément supprimé est ignoré', () => {
  const doc = emptyCase({ id: 'c' });
  doc.items.push(item('a'), item('b', { number: 2 }));
  applyOps(doc, [{ k: 'link:add', link: { id: 'l1', from_id: 'a', to_id: 'b' } }]);
  assert.equal(doc.links.length, 1);
  applyOps(doc, [{ k: 'link:add', link: { id: 'l2', from_id: 'b', to_id: 'a' } }]);
  assert.equal(doc.links.length, 1, 'pas de doublon dans l’autre sens');
  applyOps(doc, [{ k: 'item:del', id: 'b' }, { k: 'link:add', link: { id: 'l3', from_id: 'a', to_id: 'b' } }]);
  assert.equal(doc.links.length, 0);
  assert.equal(doc.items.length, 1);
});

test('les opérations successives sur le même élément sont fusionnées', () => {
  const q = [];
  pushOp(q, { k: 'item:set', id: 'a', fields: { title: 'x' } });
  pushOp(q, { k: 'item:set', id: 'a', fields: { title: 'xy', body: 'z' } });
  pushOp(q, { k: 'item:set', id: 'b', fields: { title: 'q' } });
  assert.equal(q.length, 2);
  assert.deepEqual(q[0].fields, { title: 'xy', body: 'z' });
});

test('le journal est limité et sans doublon', () => {
  const doc = emptyCase({ id: 'c' });
  const ops = Array.from({ length: 320 }, (_, i) => ({ k: 'log', entry: { id: `e${i}`, action: 'x', at: i } }));
  applyOps(doc, ops);
  applyOps(doc, [{ k: 'log', entry: { id: 'e319', action: 'x', at: 319 } }]);
  assert.equal(doc.activity.length, 300);
  assert.equal(doc.activity.at(-1).id, 'e319');
});

test('chiffrement : bon code, mauvais code, changement de code', async () => {
  const { access, raw } = await C.createAccess('code-du-comite');
  const key = await C.importDataKey(raw);
  const text = await C.encryptJSON(key, { secret: 'Morel a menti — é' });
  assert.ok(!text.includes('Morel'));

  assert.equal(await C.unwrapDataKey('mauvais-code', access), null);
  const again = await C.unwrapDataKey('code-du-comite', access);
  assert.deepEqual(await C.decryptJSON(await C.importDataKey(again), text), { secret: 'Morel a menti — é' });

  // Changer le code garde la même clé de données : les dossiers restent lisibles.
  const access2 = await C.wrapDataKey('nouveau-code', raw);
  assert.equal(await C.unwrapDataKey('code-du-comite', access2), null);
  const raw2 = await C.unwrapDataKey('nouveau-code', access2);
  assert.deepEqual(await C.decryptJSON(await C.importDataKey(raw2), text), { secret: 'Morel a menti — é' });
});
