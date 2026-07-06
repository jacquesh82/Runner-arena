# Runner Arena — maquette de gamification territoriale

Prototype **2D avec effets "3D game"** (particules, halos néon, pulsations, ondes
de capture) pour découper un **territoire réel** en **hexagones** à conquérir.

Pensé comme un jeu de conquête à la *Ingress / Splatoon* : des **runners**
parcourent la ville et capturent le terrain, chaque hexagone bascule à la couleur
de l'équipe qui le prend.

## Lancer

Aucune installation. Un simple serveur statique suffit (les tuiles de carte se
chargent depuis le réseau) :

```bash
npx http-server -p 8080 -s
# puis ouvrir http://localhost:8080
```

> Ouvrir `index.html` en `file://` fonctionne aussi, mais un serveur local évite
> les restrictions navigateur sur certaines ressources.

## Ce qu'on peut faire

- **Clic** sur un hexagone → capture pour ton équipe + burst de particules
- **Choisir son équipe** (AZUR / NOVA / FLUX) dans le panneau
- **Lancer les runners** : des agents autonomes roament la carte et conquièrent
  le territoire (règle le nombre par équipe avec le slider)
- **Glisser / molette** : déplacer et zoomer la vraie carte, la grille reste calée
- **Scoreboard** temps réel : nombre de zones + part de territoire par équipe

## Effets "game"

- Halos néon (`shadowBlur`) et **pulsation** des zones possédées
- **Émetteurs de particules** à chaque capture + sillage des runners
- **Ondes de capture** concentriques
- Ambiance cyber : carte teintée, vignette, scanlines

## Personnaliser

Tout est dans `game.js`, en haut :

```js
const CONFIG = {
  center: [48.8566, 2.3522], // ← latitude/longitude de ta ville
  zoom: 15,
  hexSize: 75,               // rayon d'un hexagone en mètres
  range: 15,                 // taille de la grille (nb d'anneaux)
};
```

Les équipes et couleurs se règlent dans l'objet `TEAMS`.

## Structure

| Fichier            | Rôle                                                     |
| ------------------ | -------------------------------------------------------- |
| `index.html`       | Page + HUD                                               |
| `styles.css`       | Thème néon / HUD                                         |
| `hexgrid.js`       | Maths de la grille hexagonale (axial q,r ↔ mètres ↔ lat/lng) |
| `game.js`          | Rendu canvas, effets, runners, interactions             |
| `vendor/leaflet/`  | Leaflet 1.9.4 (carte, embarqué localement)              |

Fond de carte : [CARTO dark](https://carto.com/) sur données
[OpenStreetMap](https://openstreetmap.org).
