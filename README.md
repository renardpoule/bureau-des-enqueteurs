# Bureau des enquêteurs

Tableau d'enquête collaboratif pour le **comité disciplinaire** d'un département (RP Garry's Mod).

Chaque dossier a son propre tableau en bois gris, façon film policier. On y épingle des photos, des témoignages, des pièces à conviction, des notes… On les relie avec des fils rouges, et tout le monde voit les changements en direct.

## Fonctionnalités

- **Un tableau par dossier** : panoramique à la souris ou au doigt, zoom à la molette ou par pincement, bouton « tout afficher ».
- **Des éléments pour chaque type d'information** :
  | Type | Apparence sur le tableau |
  |---|---|
  | Personne (suspect, témoin, victime…) | Polaroïd avec tampon de statut |
  | Témoignage | Feuille lignée : témoin, date, déposition |
  | Pièce à conviction | Sachet de scellé numéroté (P-01, P-02…) avec photo |
  | Document / rapport | Feuille dactylographiée |
  | Photo | Polaroïd avec légende manuscrite |
  | Lieu, Événement (chronologie) | Fiches bristol |
  | Note | Post-it de couleur |
  | Zone | Cadre délimité par du ruban, pour regrouper (« Suspects », « Pièces »…) |
- **Le classeur** (colonne de gauche) range tout par catégorie : personnes, témoignages, pièces à conviction, etc. Un clic sur un élément centre le tableau dessus, et le bouton « + » d'une catégorie en ajoute un.
- **Fils entre les éléments** : on tire la punaise rouge d'un élément vers un autre. Chaque fil peut avoir une légende (« a menti », « complice ? »), une flèche (→, ←, ↔), une couleur, et être soit « établi » (fil tendu) soit « hypothèse » (pointillés).
- **Déplacement libre** : on glisse les éléments où on veut, et une zone déplacée emporte les éléments épinglés dedans. On peut aussi redimensionner et incliner.
- **Images** : envoi de fichier, lien http(s), **copier-coller d'une capture d'écran (Ctrl+V)** ou glisser-déposer directement sur le tableau.
- **Temps réel** : on voit les autres enquêteurs connectés et leurs modifications au moment où ils les font, déplacements compris.
- **Journal** du dossier : qui a ajouté, modifié, relié ou retiré quoi, et quand.
- **Comptes et rôles** :
  - *Administrateur* : gère les membres et peut supprimer un dossier.
  - *Enquêteur* : crée et modifie les dossiers et les tableaux.
  - *Observateur* : lecture seule.

## Installation

Il faut **Node.js 22.13 ou plus récent** (la base SQLite est intégrée à Node, il n'y a rien d'autre à installer).

```bash
npm install
ADMIN_PASSWORD='un-mot-de-passe-solide' npm start
```

Le site est ensuite disponible sur <http://localhost:3000>.

Au premier démarrage, un compte administrateur `admin` est créé. Si `ADMIN_PASSWORD` n'est pas défini, un mot de passe aléatoire est affiché dans la console. Pensez à le changer depuis le site (bouton « Mot de passe »), puis ajoutez les membres du comité avec le bouton « Membres ».

Pour essayer avec un dossier d'exemple déjà rempli :

```bash
npm run demo
```

### Variables d'environnement

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` | Port HTTP | `3000` |
| `HOST` | Adresse d'écoute | `0.0.0.0` |
| `DATA_DIR` | Dossier de la base et des images envoyées | `./data` |
| `ADMIN_USER` / `ADMIN_PASSWORD` | Premier compte administrateur (utilisés seulement quand la base est vide) | `admin` / aléatoire |
| `TRUST_PROXY` | À mettre à `1` derrière un reverse proxy (nginx, Caddy…) | — |
| `COOKIE_SECURE` | À mettre à `1` si le site est servi en HTTPS | — |

Toutes les données (base `bureau.db` et dossier `uploads/`) sont dans `DATA_DIR`. **C'est ce dossier qu'il faut sauvegarder.**

## Mise en ligne

N'importe quel VPS avec Node.js convient. Exemple avec nginx en HTTPS : pensez à transmettre les en-têtes WebSocket, sinon le temps réel ne fonctionne pas.

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 12m;
}
```

Lancez ensuite le serveur avec `TRUST_PROXY=1 COOKIE_SECURE=1 npm start`, idéalement sous `pm2` ou un service systemd.

## Raccourcis sur le tableau

| Action | Comment |
|---|---|
| Se déplacer | Glisser le fond du tableau (ou clic molette) |
| Zoomer | Molette, pincement, ou touches `+` / `-` |
| Tout afficher | Touche `0` ou clic sur le pourcentage de zoom |
| Ajouter un élément | Double-clic ou clic droit sur le bois, bouton « + Ajouter », ou « + » dans le classeur |
| Relier deux éléments | Tirer la punaise rouge vers l'autre élément (ou « Relier à… » dans le panneau) |
| Lire une fiche en grand | Double-clic sur l'élément |
| Supprimer la sélection | `Suppr` |
| Désélectionner | `Échap` |

## Développement

```bash
npm run dev   # redémarre le serveur à chaque modification
npm test      # tests de l'API
```

- `server/` : Express, SQLite (`node:sqlite`), WebSocket (`ws`) et envoi d'images (`multer`).
- `public/` : front-end en JavaScript natif (modules ES), sans étape de build.
- Les polices (Special Elite, Courier Prime, Caveat, Permanent Marker, Inter) sont incluses dans `public/fonts`, sous licences libres OFL / Apache 2.0.
