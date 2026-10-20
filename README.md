# Deckforge — optimiseur de decks pour SPAM

Application locale (un seul fichier HTML) qui trouve le meilleur deck de 4 cartes à partir de ta collection,
en simulant des milliers de parties contre une méta de decks forts et un « ladder » de joueurs intermédiaires.

Projet de fan non officiel, sans lien avec Ticroco. « Spam » et ses contenus appartiennent à leurs ayants droit.
Données et illustrations : [SpamDex officiel](https://www.spamgame.com/spamdex), utilisées selon les
[conditions publiées](https://spamgame.com/conditions-donnees-cartes) ; les artistes sont crédités dans l'appli.

## Utilisation

Ouvre `Deckforge.html` dans Chrome, Edge ou Firefox (double-clic). Aucune installation, fonctionne hors ligne.
Au démarrage, l'appli vérifie si une nouvelle version du SpamDex est publiée et la charge automatiquement.

Deux écrans, tout tourne autour du **winrate** :

- **Deck** : filtres à gauche, cartes au centre, **Mon deck** à droite. Le rond ✓ d'une carte = tu la possèdes
  (les cases dessous = talents débloqués) ; un clic sur la carte l'ajoute au deck. Le winrate du deck se calcule
  en direct, avec le rôle de chaque carte (carry, support, soigneur, tank) et le bouton **Voir la tactique**
  (plan de jeu, quand utiliser chaque compétence, ordre des 5 premiers tours, matchups contre les decks les plus
  joués). **Améliorer ce deck** teste les meilleurs talents et chaque échange d'une carte avec ta collection.
  **Trouver mon meilleur deck** cherche les synergies de ta collection : mini-parties contre les decks les plus
  joués (valeur de chaque carte et de chaque paire, recherche locale par échanges), puis vraies simulations des
  meilleurs candidats. Les cartes que tu ajoutes toi-même sont **gardées** (épingle dorée sur la carte dans
  « Mon deck ») : la recherche construit alors le meilleur deck autour sans jamais les remplacer, et « Améliorer ce
  deck » ne propose plus de les échanger. Un clic sur l'épingle garde ou libère une carte. Le bouton **Construire un
  deck autour** de la fiche d'une carte fait la même chose en partant de cette seule carte.
  **Cartes à obtenir** cherche, parmi les cartes que tu n'as pas encore, celles qui feraient le plus gagner ton deck.
  Sous le deck : les **synergies** (duos) qu'il contient et le **niveau de tes adversaires** (tous, débutants,
  intermédiaires, confirmés selon la taille de leur collection) ; winrates, tier list, duos et recherche s'adaptent
  au niveau choisi, aussi dans l'onglet Winrates.
- **Winrates** : le winrate de tous les decks simulés (avec rôles et Tox clés ; clic sur un deck = sa tactique),
  le winrate par carte (tier list) et les **duos qui gagnent ensemble** (paires de cartes dont le meilleur deck commun
  fait mieux que le meilleur deck de chacune sans l'autre ; clic = deck chargé avec les deux cartes gardées). En haut, le panneau du **dernier patch** : règles modifiées, cartes qui
  montent / descendent et liste des cartes modifiées (aussi repérables par leur badge ▲ / ◆ et le filtre
  « Modifiées en 1.23 »).

Codes de deck `DECK:102-178.1-2-82` (numéro de carte, point, talent) et liens de partage `…/#deck-102-178.1-2-82`.
L'ancienne version complète (duel, journal de classé, méta…) est gardée dans `archive/v1-complete/`.

Règles : version **SpamDex 1.23** (14 octobre 2026). Depuis la sortie (1.20) : le Gel remplace l'Étourdissement
(la cible saute son prochain tour ; un autre dégât, un soin ou un nouveau Tox brise la glace, 60 dégâts depuis la 1.21),
les critiques et Berserk s'appliquent aux soins, Contre riposte sur l'attaquant, Anticipation lance toutes les compétences
au début. En 1.23 : les « Dégâts bonus » (PV manquants d'Aleera et de Rongeur Nuageux) ne profitent plus des bonus
élémentaires, Cavalerie et Vitalité des Âmes sont réduites, les Rois élémentaires frappent plus souvent. Les valeurs des
talents sont lues dans le SpamDex. Le terrain aléatoire n'existe plus dans le jeu et n'est pas simulé. Les versions 1.19,
1.20 et 1.21 sont archivées dans `archive/`.

**Winrate** : chaque deck affronte les decks d'un ladder de **3000 joueurs simulés** (collections tirées selon une
progression réaliste, en trois niveaux : débutants, intermédiaires, confirmés). Comme dans les vraies parties, **95 % des
joueurs jouent un deck à thème** : monté autour d'un élément avec plutôt les cartes réputées fortes, sans chercher le
meilleur deck possible. Ce comportement est calé sur les decks de vrais adversaires lus dans des replays (force de leurs
decks, part de decks d'un même élément) : les vrais joueurs n'optimisent presque jamais. Les 5 % restants cherchent le
meilleur deck de leur collection ; le ladder se construit en plusieurs tours où ils s'adaptent à la méta moyenne des tours
précédents, sans toujours jouer leur meilleur (60 / 25 / 15 % sur leurs trois meilleurs decks). Les winrates sont
pondérés par la fréquence de chaque deck adverse, pour chaque niveau. La boutique de Tox est simulée dans chaque partie.

**Vraies parties** : `src/barometre.json` reprend les statistiques (cartes, decks, duos) du
[« Spamomètre » (ex-Baromètre SPAM), stats de la communauté (non officiel)](https://barometre-spam.netlify.app)
de Peto_SPAM (parties envoyées par les joueurs), tous rangs confondus et **rang par rang** (`ranks` : Bronze, Argent, Or,
Cristal, Céleste, Légende), avec la répartition des parties par rang, les éléments, les tendances de la semaine et les
cartes gagnantes / perdantes du patch. La « popularité en face » d'un deck ou d'une carte compte seulement les adversaires
rencontrés : c'est la mesure à comparer au ladder (le nombre de parties compte aussi les decks de ceux qui envoient leurs
parties). `node tools/barometre.js` compare le ladder simulé à ces vraies parties, carte par carte (popularité,
victoires), puis chaque rang à chaque niveau simulé ; `CASUAL_APPEAL=real` fait choisir aux joueurs à thème les cartes
que les vrais joueurs jouent.

## En ligne et mises à jour automatiques

Le site est publié sur **https://dylanlabanane.github.io/deckforge/** (GitHub Pages), sans rien faire à la main :

- **à chaque push** sur `main`, `.github/workflows/deploy.yml` reconstruit le site (`node tools/build.js`) et le publie ;
- **plusieurs fois par heure** (GitHub en saute souvent : en pratique un patch est repéré en quelques heures au plus),
  `.github/workflows/update.yml` regarde si un nouveau SpamDex est sorti. Si oui, il installe les nouvelles données
  et publie tout de suite le site avec les nouvelles cartes et les notes de patch, puis lance le
  **recalcul complet sur 20 machines GitHub en parallèle** (`tools/cloud.sh`, mêmes étapes et réglages que
  `tools/night.sh`, environ 2 h 20 au lieu de 8 h sur un PC), enregistre les résultats dans le dépôt et republie le site.
  Entre-temps, l'appli charge elle-même le nouveau SpamDex au démarrage : les cartes sont à jour dès la sortie du
  patch, seuls les winrates attendent le recalcul.
  Aucun calcul sur le PC. Si le simulateur ne connaît pas une nouvelle mécanique, un ticket (issue) est ouvert.
- à la main : onglet *Actions* → *Mise à jour SpamDex* → *Run workflow* (`force` pour recalculer sans nouveau patch,
  `test` pour un essai minuscule de toute la chaîne sans rien publier).

`node tools/build.js` produit aussi le dossier **`site/`** (PWA : `index.html`, icônes, `manifest.webmanifest`,
`sw.js` pour le hors-ligne, `og.png`) qu'on peut héberger ailleurs (Netlify : `netlify.toml` est prêt). Pour l'aperçu
des liens (Discord…), construire avec l'adresse du site : `$env:SITE_URL="https://…"; node tools/build.js`.

Tes données (collection, journal) restent dans le navigateur, par site : pour passer du fichier local au site,
utilise *Exporter / sauvegarder* puis *Importer*. Conditions des données SpamDex : projet de fan gratuit et non
commercial, artistes crédités, mention « non officiel », pas de logo du jeu (déjà respecté par l'appli).

## Développement

```
src/engine.js      moteur de simulation d'une partie (règles, talents, Tox, IA)
src/optimizer.js   recherche du meilleur deck (score solo + score interactif en mini-parties), calcul de méta
src/app.*          interface
src/meta.json      méta + ladder précalculés
data/cards.fr.json SpamDex brut
assets/            miniatures intégrées au fichier final
tools/             build, calcul de méta, traces de parties
```

Commandes (Node.js 18+). Les scripts marqués « parallèle » utilisent tous les cœurs du processeur moins 2
(`tools/pool.js` + `tools/worker.js` ; variable `WORKERS` pour changer le nombre) :

```
node tools/build.js              # régénère Deckforge.html, dist/artifact.html et site/
python tools/make_images.py      # icônes et image d'aperçu (Pillow)
node tools/meta.js precise 4     # recalcule la méta (≈ 5 min)
node tools/tiers.js normal 3     # tier list : 3 meilleurs decks par carte (parallèle)
node tools/pairs.js 40 fast      # meilleur deck de chaque paire parmi les 40 meilleures cartes (parallèle)
node tools/ladder.js 3000 4 normal 30   # ladder : 3000 joueurs, 4 tours (parallèle, reprise avec --resume)
node tools/winrates.js 6000 200  # winrate de toute la base de decks, 6000 parties par deck (parallèle)
node tools/patch.js archive/spamdex-1.19   # notes de patch : changements par carte et winrate avant / après
node tools/trace.js "Carte1,Carte2,Carte3,Carte4" "Carte1,..."   # trace une partie tour par tour
```

Après une mise à jour du jeu, **une seule commande** :

```
node tools/update.js --check        # y a-t-il une nouvelle version du SpamDex ?
node tools/update.js                # l'installe : archive l'ancienne, télécharge données et miniatures,
                                    # contrôle le simulateur et génère les notes de patch
node tools/update.js --run quick    # … puis recalcul rapide (≈ 30 min) et construction du site
node tools/update.js --run full     # … puis recalcul complet (≈ 8 h, tools/night.sh) et construction du site
```

Le **contrôle du simulateur** liste ce qu'il ne connaît peut-être pas encore : nouvelles actions, talents ou Tox,
nouveaux mots-clés, textes de compétence jamais vus. S'il signale quelque chose, adapter `src/engine.js` avant le
recalcul (ou forcer avec `--force`). Les changements de **valeurs** (PV, dégâts, recharges, valeurs des talents comme
Cavalerie ou Vitalité des Âmes, valeur du Gel…) sont lus directement dans le SpamDex : rien à faire. Dans
`tools/patch.js`, ajouter si besoin un résumé des règles modifiées (`RULES`, `TITLE`, `HEADLINE` pour la version).

Si une nouvelle version sort et que l'appli n'a pas encore été reconstruite, elle charge quand même les nouvelles
cartes au démarrage et signale dans l'onglet Winrates que les winrates datent de l'ancienne version (bouton
« Recalculer »).

Normalement tout le recalcul tourne sur GitHub (voir « En ligne et mises à jour automatiques »). En secours, il peut
tourner sur un PC : `bash tools/night.sh` (complet) ou `bash tools/night.sh --resume`, qui saute les étapes finies et
reprend chaque étape au dernier point sauvegardé (ladder tous les 25 joueurs, winrates tous les 50 decks). Il tourne en
priorité basse. Après un calcul local, faire `git pull` avant de pousser : GitHub enregistre aussi ses résultats.
Le moteur de simulation est optimisé (objets de forme fixe, boucle de tour sans tri) : ~0,14 ms par partie.
