# Runner Arena

**Conquiers un territoire réel découpé en hexagones… en courant.** Ta position
GPS *est* le runner : chaque zone que tu traverses est capturée dans une explosion
de particules. App mobile **iOS + Android** (Capacitor), en **portrait**, avec un
rendu **WebGL « juicy »** (PixiJS) posé sur une **vraie carte** (MapLibre GL).

## Architecture — 2 services découplés

L'app est structurée autour de **deux services** qui ne communiquent que par
événements (aucune dépendance directe) :

```
┌─────────────────────────┐   position / stats    ┌──────────────────────────┐
│   LocationService        │ ────────────────────▶ │      UiService           │
│   (GPS + GPX)            │                       │   (carte + jeu WebGL)    │
│  · suivi position         │                       │  · plateau hexagonal     │
│  · distance / vitesse     │                       │  · capture des zones      │
│  · enregistrement trace   │                       │  · particules / glow      │
│  · export .gpx            │                       │  · HUD portrait           │
└─────────────────────────┘                       └──────────────────────────┘
        src/services/location-service.js                 src/services/ui-service.js
```

- **`LocationService`** — headless. Suit le GPS (Capacitor Geolocation, fallback
  navigateur, et simulateur si aucun capteur), calcule distance/allure, enregistre
  la trace et l'exporte en **GPX**. Ne connaît ni la carte ni les hexagones.
- **`UiService`** — consomme les positions : carte MapLibre inclinée (plateau
  pseudo-3D), plateau hexagonal Pixi, capture des zones traversées, effets
  (particules, halos additifs, pop élastique), HUD portrait.

`src/main.js` instancie les deux et les câble.

## Stack technique

| Besoin | Choix | Pourquoi |
| --- | --- | --- |
| App native iOS + Android | **Capacitor 6** | Une base de code, GPS/haptique natifs, portrait natif |
| Rendu « Royal Match » | **PixiJS 8 (WebGL)** | Particules, glow additif, easing élastique, 60 fps GPU |
| Carte réelle | **MapLibre GL 4** | Carte vectorielle GPU, inclinable, satellite possible |
| GPS / GPX / haptique | **@capacitor/geolocation + haptics** | Suivi live, retour tactile, export `.gpx` |
| Build web | **Vite 5** | Dev server + bundle du WebView |

> Note : Royal Match est un jeu **Unity** avec des assets d'artistes (Spine). Cette
> stack web/WebGL en approche fortement le *ressenti* (juice, particules, rebonds)
> et itère beaucoup plus vite ; on pourra brancher de vrais assets Spine ensuite.

## Développer (web)

```bash
npm install
npm run dev          # http://localhost:5173
# ?sim=1 force le simulateur GPS (démo desktop) : http://localhost:5173/?sim=1
```

`npm run build` produit `dist/` (le WebView de l'app).

## Générer les apps natives

```bash
npm run build
npx cap add android      # nécessite Android Studio / SDK
npx cap add ios          # nécessite Xcode (macOS)
npm run cap:sync         # après chaque build
npx cap open android     # puis Run depuis l'IDE
npx cap open ios
```

Permissions déjà déclarées dans `capacitor.config.json` (localisation, portrait).
Sur device, `LocationService` utilise le vrai GPS ; le simulateur ne sert qu'au
desktop / à l'émulateur sans capteur.

## Charte & assets

Le logo (hexagone vert + runner orange + piste pointillée jaune) fixe la palette
du jeu :

| Élément | Couleur |
| --- | --- |
| Runner / joueur, accents | orange `#ff7a1a` |
| Territoire conquis | vert `#2fbf4a` |
| Onde de capture / piste | jaune `#f2c500` |
| Adversaire | magenta `#ff2d95` |
| Fond | navy `#0b1524` |

- `public/logo-badge.png` — badge carré (écran d'accueil, source d'icône)
- `public/logo-wordmark.png` — logo horizontal
- `resources/icon.png` — source pour générer les icônes natives

Générer les icônes/splash iOS + Android depuis le badge :

```bash
npx @capacitor/assets generate --iconBackgroundColor '#0b1524' --splashBackgroundColor '#0b1524'
```

## Personnaliser

- **Ville de départ** : `START` dans `src/main.js` (avant le 1er fix GPS).
- **Taille des hexagones / portée / inclinaison** : `CONFIG` en haut de
  `src/services/ui-service.js` (`hexSize` en mètres, `pitch`, `captureRadius`).
- **Fond de carte** : `mapStyle()` dans `ui-service.js` (Voyager par défaut ;
  remplaçable par du satellite Esri).

## Structure

```
index.html                     coquille + HUD portrait
src/main.js                    bootstrap : câble les 2 services
src/hexgrid.js                 maths grille hexagonale (axial ↔ mètres ↔ lat/lng)
src/services/location-service.js   SERVICE 1 — GPS + GPX
src/services/ui-service.js         SERVICE 2 — carte MapLibre + jeu PixiJS
src/styles.css                 thème néon, HUD, effets
capacitor.config.json          config app native (portrait, permissions)
```
