/* ======================================================================
 * MERVEILLES — quartiers & monuments emblématiques posés sur le plateau.
 *
 * En production, ce catalogue est GÉNÉRÉ par le backend à partir de POI réels
 * (OpenStreetMap / Overpass + Wikidata) : chaque monument ou quartier devient
 * une "merveille" ancrée sur la ou les tuiles qui le recouvrent. Ici, on fournit
 * un échantillon local (offsets axiaux q,r autour du centre) pour la démo.
 *
 * Une merveille :
 *  - vaut plus de points et donne un bonus de contrôle
 *  - peut être "sponsorisée" (monétisation) -> champ sponsor renseigné par le backend
 * ==================================================================== */
export const MERVEILLES = [
  { id: "eiffel",     name: "Tour Eiffel",      type: "monument", icon: "🗼", tier: 3, q: 2,  r: -1 },
  { id: "notredame",  name: "Notre-Dame",       type: "monument", icon: "⛪", tier: 3, q: -2, r: 1 },
  { id: "louvre",     name: "Le Louvre",        type: "monument", icon: "🏛️", tier: 2, q: 1,  r: 2 },
  { id: "marais",     name: "Le Marais",        type: "quartier", icon: "🏘️", tier: 2, q: -3, r: 0 },
  { id: "montmartre", name: "Montmartre",       type: "quartier", icon: "⛰️", tier: 2, q: 0,  r: -3 },
  { id: "arc",        name: "Arc de Triomphe",  type: "monument", icon: "🏹", tier: 2, q: 3,  r: 1 },
];

export const MERVEILLE_BY_ID = Object.fromEntries(MERVEILLES.map((m) => [m.id, m]));
