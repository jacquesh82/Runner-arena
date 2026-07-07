/* Registre d'instances (arènes) — origine + taille hex.
 * SOURCE DE VÉRITÉ de l'identité de tuile, à garder en miroir de src/tiles.js.
 * L'id global d'une tuile = `${instanceId}:${q},${r}` (q,r relatifs à l'origine). */
export const INSTANCES = {
  paris: { origin: [48.8566, 2.3522], size: 55 },
};
export const DEFAULT_INSTANCE = "paris";

export function instanceOf(id) {
  return INSTANCES[id] || INSTANCES[DEFAULT_INSTANCE];
}
export const globalTileId = (instanceId, tileKey) => `${instanceId}:${tileKey}`;
export function parseGlobalId(id) {
  const i = id.indexOf(":");
  return { instanceId: id.slice(0, i), tileKey: id.slice(i + 1) };
}
