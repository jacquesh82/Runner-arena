/* Cache local (localStorage) — miroir du backend distant.
 * En production, ces données sont la source de vérité côté serveur ;
 * ici on persiste localement pour que l'app tourne en démo hors-ligne. */
import { downsampleTrack } from "./gpx.js";

const KEY = "runnerarena.v1";

function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (_) {} }

export const store = {
  isFirstLaunch() { return !load().onboarded; },
  setOnboarded() { const d = load(); d.onboarded = true; save(d); },

  addRun(run) {
    const d = load();
    d.runs = d.runs || [];
    // La trace GPS réelle est stockée (allégée) dans l'historique pour
    // re-générer le GPX à tout moment depuis le profil.
    const track = run.track && run.track.length ? downsampleTrack(run.track, 600) : null;
    const stored = { ...run };
    if (track) { stored.track = track; stored.points = run.track.length; }
    delete stored._raw;
    d.runs.unshift(stored);
    if (d.runs.length > 50) d.runs.length = 50;
    d.territory = (d.territory || 0) + (run.net || 0);
    d.xp = (d.xp || 0) + (run.xp || 0);
    save(d);
  },

  profile() {
    const d = load();
    const xp = d.xp || 0;
    return {
      xp, level: 1 + Math.floor(xp / 100), xpInLevel: xp % 100,
      territory: Math.max(0, d.territory || 0),
      runs: d.runs || [],
    };
  },

  /* ---- Badges ---- */
  badges() { return new Set(load().badges || []); },
  awardBadges(ids) {
    if (!ids || !ids.length) return;
    const d = load();
    const set = new Set(d.badges || []);
    ids.forEach((id) => set.add(id));
    d.badges = [...set];
    save(d);
  },

  /* ---- État persistant PAR TUILE (clé = id global) ----
   * Chaque tuile : { id, lat, lng, owner, count, capturedAt }.
   * Cache local, aligné sur le modèle serveur (owner + attributs + top10). */
  tiles() { return load().tiles || {}; },
  getTile(id) { return (load().tiles || {})[id] || null; },
  upsertTiles(list) {
    if (!list || !list.length) return;
    const d = load();
    const t = d.tiles || {};
    const now = Date.now();
    for (const x of list) {
      const e = t[x.id] || { id: x.id, lat: x.lat, lng: x.lng, count: 0 };
      e.owner = x.owner || e.owner || "me";
      if (x.lat != null) e.lat = x.lat;
      if (x.lng != null) e.lng = x.lng;
      e.count = (e.count || 0) + 1;
      e.capturedAt = now;
      t[x.id] = e;
    }
    d.tiles = t;
    save(d);
  },
  /* compat : liste de tuiles pour la carte du territoire */
  getTerritory() { return Object.values(load().tiles || {}); },

  /* ---- Merveilles ---- */
  claimedMerveilles() { return new Set(load().merveilles || []); },
  claimMerveille(id) {
    const d = load();
    const set = new Set(d.merveilles || []);
    set.add(id);
    d.merveilles = [...set];
    save(d);
  },
};
