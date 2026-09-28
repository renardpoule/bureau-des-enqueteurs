'use strict';

// Creates an example case so the board can be tried out straight away.
// Usage: npm run demo

const { db, tx } = require('../server/db');
const { bootstrapAdmin } = require('../server/auth');

bootstrapAdmin();
const admin = db.prepare("SELECT id, display_name FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
const now = Date.now();

const caseId = tx(() => {
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO cases (reference, title, description, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, 'en_cours', ?, ?, ?)`).run(
    `CD-DEMO-${String(now).slice(-4)}`,
    'Saisie disparue — Agent K. Morel',
    "Le 12/03, 40 000 $ saisis lors d'une descente au port ne figurent plus au registre des scellés. "
      + "L'agent Morel était seul de garde au dépôt ce soir-là.",
    admin.id, now, now);
  const id = Number(lastInsertRowid);

  const counters = {};
  let z = 0;
  const add = (type, x, y, fields = {}) => {
    counters[type] = (counters[type] || 0) + 1;
    z += 1;
    const it = {
      title: '', subtitle: '', body: '', image: '', event_date: '', color: '',
      w: type === 'zone' ? 700 : 230, h: 0, rotation: 0, ...fields,
    };
    const r = db.prepare(`
      INSERT INTO items (case_id, type, number, title, subtitle, body, image, event_date, color, x, y, w, h, rotation, z, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, type, counters[type], it.title, it.subtitle, it.body, it.image, it.event_date, it.color,
      x, y, it.w, it.h, it.rotation, type === 'zone' ? -z : z, admin.id, now, now);
    return Number(r.lastInsertRowid);
  };
  const link = (from, to, fields = {}) => db.prepare(`
    INSERT INTO links (case_id, from_id, to_id, label, arrow, style, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, from, to, fields.label || '', fields.arrow || 'none', fields.style || 'solid', fields.color || 'rouge', now);

  add('zone', 1900, 1450, { title: 'Personnes impliquées', w: 820, h: 560, color: 'blanc' });
  add('zone', 2820, 1450, { title: 'Pièces à conviction', w: 760, h: 560, color: 'rouge' });
  add('zone', 1900, 2110, { title: 'Témoignages', w: 1060, h: 640, color: 'jaune' });
  add('zone', 3060, 2110, { title: 'Chronologie', w: 520, h: 640, color: 'bleu' });

  const morel = add('personne', 1960, 1540, { title: 'Agent K. Morel', subtitle: 'Mis en cause', body: 'Matricule 2217 · 3 ans de service', w: 210, rotation: -2 });
  const vasquez = add('personne', 2230, 1560, { title: 'Sgt. Vasquez', subtitle: 'Témoin', body: 'Supérieur direct de Morel', w: 200, rotation: 1.5 });
  const inconnu = add('personne', 2480, 1530, { title: 'Individu non identifié', subtitle: 'Suspect', body: 'Veste verte, vu sur la caméra 3', w: 200, rotation: 3 });

  const registre = add('piece', 2880, 1540, { title: 'Registre des scellés', subtitle: 'Bureau du dépôt, tiroir 2', body: 'Page du 12/03 arrachée. Traces de correcteur sur la ligne 14.', rotation: -1.5 });
  const cle = add('piece', 3150, 1560, { title: 'Double de la clé du dépôt', subtitle: 'Casier de Morel', body: 'Non déclaré à l\'armurerie.', w: 210, rotation: 2 });
  const video = add('document', 3380, 1530, { title: 'Relevé caméra 3', subtitle: 'Service technique', body: '22:41 — la porte du dépôt s\'ouvre.\n22:47 — un individu en veste verte sort avec un sac.\n22:49 — coupure de 6 minutes.', w: 180, rotation: -2.5 });

  const temVasquez = add('temoignage', 1960, 2200, { title: 'Sgt. Vasquez', subtitle: 'Insp. Leroy', event_date: '14/03, 10h', body: "Morel m'a demandé à être seul de garde ce soir-là. Ce n'était pas son tour.", w: 300, rotation: -1 });
  const temMorel = add('temoignage', 2300, 2230, { title: 'Agent K. Morel', subtitle: 'Insp. Leroy', event_date: '14/03, 11h', body: "Je n'ai quitté le dépôt qu'une seule fois, pour une pause de cinq minutes. Je n'ai croisé personne.", w: 300, rotation: 1.5 });
  const note = add('note', 2650, 2230, { title: 'À vérifier', body: 'Qui d\'autre a accès à la caméra 3 ?\nPause de 5 min ≠ coupure de 6 min', color: 'jaune', w: 220, rotation: 3 });

  const e1 = add('evenement', 3130, 2200, { title: 'Descente au port, saisie de 40 000 $', event_date: '12/03 — 18:30', w: 380, rotation: -1 });
  const e2 = add('evenement', 3130, 2440, { title: 'Ouverture du dépôt, sortie du sac', event_date: '12/03 — 22:41', w: 380, rotation: 1 });

  link(temVasquez, morel, { label: 'contredit', arrow: 'end' });
  link(temMorel, video, { label: 'incohérence horaire', color: 'rouge' });
  link(cle, morel, { label: 'trouvée chez', arrow: 'end' });
  link(inconnu, video, { label: 'caméra 3', color: 'noir' });
  link(inconnu, morel, { label: 'complice ?', style: 'dashed', color: 'bleu' });
  link(registre, e1);
  link(e2, video, { color: 'noir' });
  link(note, temMorel, { color: 'jaune', style: 'dashed' });
  link(vasquez, temVasquez, { color: 'noir' });

  db.prepare('INSERT INTO activity (case_id, user_name, action, created_at) VALUES (?, ?, ?, ?)')
    .run(id, admin.display_name, 'a ouvert le dossier de démonstration', now);
  return id;
});

console.log(`Dossier de démonstration créé : /dossier/${caseId}`);
