# Bureau des enquêteurs

Tableau d'enquête collaboratif pour le **comité disciplinaire** (RP Garry's Mod), hébergé sur **GitHub Pages**, comme le site *Front des Cendres* (`lastwar`).

Chaque dossier a son propre tableau en bois gris, façon film policier. On y épingle des photos, des témoignages, des pièces à conviction et des notes, puis on les relie avec des fils rouges.

- Aucun serveur à installer : le site est statique, et les dossiers sont enregistrés dans le dossier `data/` de ce dépôt via l'API GitHub.
- **Les dossiers sont chiffrés** (AES-256) avec le **code du comité**. Le dépôt est public, mais sans le code, personne ne peut lire les dossiers ni voir les images.

## Mise en route (une seule fois)

1. **Activer GitHub Pages** : sur GitHub, *Settings → Pages → Build and deployment*, choisir *Deploy from a branch*, la branche `main` et le dossier `/ (root)`, puis *Save*.
   Le site sera en ligne d'ici une à deux minutes sur <https://renardpoule.github.io/bureau-des-enqueteurs/>.
2. **Créer un jeton GitHub** (c'est lui qui permet d'enregistrer) : <https://github.com/settings/personal-access-tokens/new>
   - *Repository access* : **Only select repositories** → `bureau-des-enqueteurs`
   - *Permissions → Repository permissions → Contents* : **Read and write**
   - Copier le jeton (`github_pat_…`).
3. **Ouvrir le site**. Il affiche « Installer le bureau » :
   - votre nom d'enquêteur ;
   - le **code du comité** (8 caractères minimum). Notez-le bien : sans lui, les dossiers sont illisibles ;
   - le compte et le dépôt, déjà remplis automatiquement, puis le jeton.
4. Dans la liste des dossiers, cliquez sur **« Créer un dossier d'exemple »** pour découvrir le tableau.

## Pour les membres du comité

- Donnez-leur l'adresse du site et le **code du comité**. Ils se connectent avec leur nom d'enquêteur (celui qui apparaît dans le journal) et ce code.
- Sans jeton, ils sont en **lecture seule**. Pour qu'un membre puisse modifier, il faut coller un jeton dans ⚙ **Réglages** :
  - soit un jeton que vous lui donnez (le même que le vôtre, ou un deuxième créé de la même façon) ;
  - soit son propre jeton, s'il a un compte GitHub et que vous l'avez ajouté comme collaborateur du dépôt.
- Le jeton reste dans le navigateur de chacun, chiffré. Il n'est jamais envoyé ailleurs que sur GitHub.
- Quand un membre quitte le comité : changez le code dans ⚙ Réglages, puis supprimez ou régénérez le jeton qu'il utilisait.

## Fonctionnalités

- **Un tableau par dossier** : on se déplace en glissant le fond, on zoome à la molette ou par pincement, et le bouton « tout afficher » recadre sur l'ensemble.
- **Types d'éléments** :

  | Type | Apparence |
  |---|---|
  | Personne (suspect, témoin, victime…) | Polaroïd avec tampon de statut |
  | Témoignage | Feuille lignée : témoin, date, déposition |
  | Pièce à conviction | Sachet de scellé numéroté (P-01, P-02…) |
  | Document / rapport | Feuille dactylographiée |
  | Photo | Polaroïd avec légende manuscrite |
  | Lieu, Événement (chronologie) | Fiches bristol |
  | Note | Post-it de couleur |
  | Zone | Cadre à ruban pour regrouper (« Suspects », « Pièces »…) |

- **Classeur** à gauche : les éléments sont rangés par catégorie. Un clic centre le tableau sur l'élément, et le bouton « + » en ajoute un.
- **Fils** : on tire la punaise rouge d'un élément vers un autre. Chaque fil peut avoir une légende, une flèche (→ ← ↔), une couleur, et être « établi » (fil plein) ou « hypothèse » (pointillés).
- **Déplacement libre**, redimensionnement et inclinaison des éléments. Une zone déplacée emporte les éléments épinglés dedans.
- **Images** : envoi de fichier, lien http(s), **copier-coller d'une capture d'écran (Ctrl+V)** ou glisser-déposer. Les images sont réduites (1600 px maximum) puis chiffrées avant l'envoi.
- **Travail à plusieurs** : les modifications sont enregistrées automatiquement toutes les quelques secondes. Le tableau se met à jour avec celles des autres toutes les 15 secondes. Si deux personnes modifient en même temps, les deux modifications sont conservées.
- **Journal** du dossier : qui a ajouté, modifié, relié ou retiré quoi.

## Raccourcis sur le tableau

| Action | Comment |
|---|---|
| Se déplacer | Glisser le fond du tableau (ou clic molette) |
| Zoomer | Molette, pincement, ou touches `+` / `-` |
| Tout afficher | Touche `0` ou clic sur le pourcentage |
| Ajouter | Double-clic ou clic droit sur le bois, « + Ajouter », ou « + » dans le classeur |
| Relier | Tirer la punaise rouge vers l'autre élément (ou « Relier à… ») |
| Lire une fiche en grand | Double-clic sur l'élément |
| Supprimer la sélection | `Suppr` |

## Limites à connaître

- Chaque enregistrement crée un commit dans le dépôt. C'est normal : c'est ce qui sert de base de données.
- Sans jeton (lecture seule), les nouveautés apparaissent après la republication de GitHub Pages, soit une à deux minutes.
- Le chiffrement protège le contenu, mais pas les métadonnées : on peut voir sur GitHub *quand* le bureau est modifié, et combien de dossiers il contient.

## Développement

Le site est en HTML/CSS/JavaScript natif, sans étape de build. Pour le tester en local :

```bash
python3 -m http.server 8000   # puis http://localhost:8000
npm test                      # tests de la fusion des modifications et du chiffrement
```

Organisation des fichiers :

- `js/board.js` : le tableau (rendu, glisser-déposer, fils, synchronisation) ;
- `js/model.js` : les opérations et leur fusion ;
- `js/session.js` : la connexion et les fichiers chiffrés ;
- `js/github.js` : l'API GitHub ;
- `js/crypto.js` : le chiffrement.
- `data/` : créé à l'installation. Il contient `acces.json` (la clé des dossiers, chiffrée par le code), `index.json`, `dossiers/` et `images/`.

Les polices incluses (Special Elite, Courier Prime, Caveat, Permanent Marker, Inter) sont sous licences libres OFL / Apache 2.0.
