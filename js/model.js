// Modèle d'un dossier et fusion des modifications.
// Chaque modification locale est une « opération ». À l'enregistrement, on relit la dernière
// version du dossier sur GitHub et on y rejoue nos opérations : deux enquêteurs peuvent donc
// travailler en même temps sans écraser le travail de l'autre.

export const ITEM_TYPES = ['personne', 'temoignage', 'piece', 'document', 'photo', 'lieu', 'evenement', 'note', 'zone'];
export const CASE_STATUSES = ['ouvert', 'en_cours', 'clos', 'classe'];
export const BOARD = { width: 6000, height: 4000 };
const MAX_LOG = 300;

export function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
}

export function emptyCase(meta) {
  return { v: 1, case: { ...meta }, items: [], links: [], activity: [] };
}

export function nextNumber(doc, type) {
  return doc.items.reduce((max, i) => (i.type === type && i.number > max ? i.number : max), 0) + 1;
}

export const clone = (value) => structuredClone(value);

/** Applique une liste d'opérations à un dossier (le modifie et le renvoie). */
export function applyOps(doc, ops) {
  const items = new Map(doc.items.map((i) => [i.id, i]));
  const links = new Map(doc.links.map((l) => [l.id, l]));
  for (const op of ops) {
    switch (op.k) {
      case 'item:add': {
        if (items.has(op.item.id)) break;
        const item = { ...op.item };
        // Un autre enquêteur a pu créer le même numéro entre-temps.
        if ([...items.values()].some((i) => i.type === item.type && i.number === item.number)) {
          item.number = nextNumber({ items: [...items.values()] }, item.type);
        }
        items.set(item.id, item);
        break;
      }
      case 'item:set': {
        const item = items.get(op.id);
        if (item) Object.assign(item, op.fields);
        break;
      }
      case 'items:pos':
        for (const p of op.list) {
          const item = items.get(p.id);
          if (!item) continue;
          item.x = p.x;
          item.y = p.y;
          if (p.z !== undefined) item.z = p.z;
        }
        break;
      case 'item:del':
        items.delete(op.id);
        for (const [id, l] of links) if (l.from_id === op.id || l.to_id === op.id) links.delete(id);
        break;
      case 'link:add': {
        const l = op.link;
        if (links.has(l.id) || !items.has(l.from_id) || !items.has(l.to_id)) break;
        const duplicate = [...links.values()].some((o) => (o.from_id === l.from_id && o.to_id === l.to_id) || (o.from_id === l.to_id && o.to_id === l.from_id));
        if (!duplicate) links.set(l.id, { ...l });
        break;
      }
      case 'link:set': {
        const link = links.get(op.id);
        if (link) Object.assign(link, op.fields);
        break;
      }
      case 'link:del':
        links.delete(op.id);
        break;
      case 'case:set':
        Object.assign(doc.case, op.fields);
        break;
      case 'log':
        if (!doc.activity.some((a) => a.id === op.entry.id)) doc.activity.push(op.entry);
        break;
      default:
    }
  }
  doc.items = [...items.values()];
  doc.links = [...links.values()];
  if (doc.activity.length > MAX_LOG) doc.activity = doc.activity.slice(-MAX_LOG);
  return doc;
}

/** Ajoute une opération à la file, en fusionnant avec la précédente quand c'est possible. */
export function pushOp(queue, op) {
  const last = queue[queue.length - 1];
  if (last && last.k === op.k && (op.k === 'item:set' || op.k === 'link:set') && last.id === op.id) {
    last.fields = { ...last.fields, ...op.fields };
    return;
  }
  if (last && op.k === 'case:set' && last.k === 'case:set') {
    last.fields = { ...last.fields, ...op.fields };
    return;
  }
  queue.push(op);
}
