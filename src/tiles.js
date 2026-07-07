/* ======================================================================
 * Identité de tuile GLOBALE et STABLE.
 *
 * Chaque tuile physique a un id déterministe `"{instance}:{q},{r}"` où (q,r)
 * sont les coordonnées axiales calculées depuis l'ORIGINE FIXE de l'instance
 * (arène géographique). Le même endroit → toujours le même id, indépendamment
 * de la course. Ce module DOIT rester le miroir de server/instances.js.
 * ==================================================================== */
import { metersToHex, hexToMeters, mPerDegLng } from "./hexgrid.js";

const M_PER_DEG_LAT = 111320;

/* Registre d'instances (origine + taille hex en mètres). Source de vérité
 * partagée client/serveur — toute modif doit être répliquée côté serveur. */
export const INSTANCES = {
  paris: { origin: [48.8566, 2.3522], size: 55 },
};
export const DEFAULT_INSTANCE = "paris";

/* lat/lng → id de tuile global. */
export function tileIdAt(lat, lng, instanceId = DEFAULT_INSTANCE) {
  const inst = INSTANCES[instanceId];
  const x = (lng - inst.origin[1]) * mPerDegLng(inst.origin[0]);
  const y = (lat - inst.origin[0]) * M_PER_DEG_LAT;
  const { q, r } = metersToHex(x, y, inst.size);
  return `${instanceId}:${q},${r}`;
}

/* id → centre lat/lng de la tuile. */
export function tileCenter(id) {
  const { instanceId, q, r } = parseTileId(id);
  const inst = INSTANCES[instanceId];
  const m = hexToMeters(q, r, inst.size);
  return { lat: inst.origin[0] + m.y / M_PER_DEG_LAT, lng: inst.origin[1] + m.x / mPerDegLng(inst.origin[0]) };
}

export function parseTileId(id) {
  const [instanceId, qr] = id.split(":");
  const [q, r] = qr.split(",").map(Number);
  return { instanceId, q, r };
}
