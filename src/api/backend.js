/* ======================================================================
 * CLIENT BACKEND — frontière app <-> backend web (gaming + commerce).
 *
 * Toute la logique "sérieuse" (validation des courses, attribution des badges,
 * économie des tuiles, paiements) vit sur un BACKEND WEB SÉPARÉ, hors de l'app
 * Android. Ce module est la seule porte d'entrée : soit il tape l'API REST
 * distante (VITE_API_BASE défini), soit il utilise un mock local (démo).
 *
 * Contrat REST (voir docs/strategy-*.md) :
 *   GET  /me
 *   POST /runs                 { track, capturedTiles, merveilles } -> { xpGained, badgesEarned, territory }
 *   GET  /badges               -> { catalogue, earned }
 *   GET  /merveilles?bbox=...   -> [ { id, name, type, tiles, tier, sponsor } ]
 *   POST /merveilles/:id/claim -> { ok, bonus }
 *   GET  /tiles/:id            -> { owner, sponsor, price, forSale }
 *   POST /tiles/:id/purchase   -> { ok, receiptId }   (monétisation)
 *   GET  /leaderboard
 * ==================================================================== */
import { store } from "../store.js";
import { BADGES, BADGE_BY_ID, evaluateBadges } from "../data/badges.js";
import { MERVEILLES } from "../data/merveilles.js";

/* -------- Backend distant (serveur web `server/`) --------
 * Câblé sur le vrai contrat : POST /runs (captures autoritatives côté serveur),
 * GET /leaderboard. Les badges/merveilles/monétisation ne sont pas encore
 * exposés par l'API → délégués au mock local (source de vérité à venir côté
 * serveur, tables `badges`/`partners` déjà prévues au schéma). */
class RemoteBackend {
  constructor(base) {
    this.base = base.replace(/\/$/, "");
    this._local = new MockBackend(); // pour badges/merveilles en attendant l'API
  }
  async _req(path, opts) {
    const res = await fetch(this.base + path, {
      headers: { "Content-Type": "application/json", ...(this.token ? { Authorization: "Bearer " + this.token } : {}) },
      ...opts,
    });
    if (!res.ok) throw new Error("API " + res.status);
    return res.json();
  }
  setToken(t) { this.token = t; }

  /* Soumet la trace brute ; le serveur applique les captures (anti-triche). */
  async submitRun(run) {
    const body = {
      mode: run.mode || "endurance",
      origin: run.origin || [48.8566, 2.3522],
      player: run.player || { id: "local" },
      track: (run.track || []).map((p) => ({ lat: p.lat, lng: p.lng, ele: p.ele ?? null, ts: p.ts ?? null })),
    };
    const r = await this._req("/runs", { method: "POST", body: JSON.stringify(body) });
    // Badges composés localement (en attendant leur exposition serveur).
    const localBadges = await this._local.submitRun(run).catch(() => ({ badgesEarned: [] }));
    return {
      xpGained: r.score ?? localBadges.xpGained ?? 0,
      badgesEarned: localBadges.badgesEarned || [],
      territory: (r.gained ?? 0),
      server: r,
    };
  }

  getLeaderboard(mode = "endurance") { return this._req(`/leaderboard?mode=${encodeURIComponent(mode)}`); }
  getTiles(bbox, mode = "endurance") { return this._req(`/tiles?bbox=${bbox.join(",")}&mode=${mode}`); }
  // État complet d'une tuile : owner + attributs + top 10.
  getTile(id, mode = "endurance") { return this._req(`/tiles/${encodeURIComponent(id)}?mode=${mode}`); }

  // Délégués au mock local (pas d'endpoint serveur pour l'instant)
  getBadges() { return this._local.getBadges(); }
  getMerveilles() { return this._local.getMerveilles(); }
  claimMerveille(id) { return this._local.claimMerveille(id); }
  purchaseTile(id, p) { return this._local.purchaseTile(id, p); }
}

/* -------- Mock local (démo hors-ligne) : mêmes signatures -------- */
class MockBackend {
  async submitRun(run) {
    const xp = Math.max(0, run.net || 0) * 12 + (run.zones || 0) * 6 + (run.won || 0) * 10;
    store.addRun({
      date: Date.now(), zones: run.zones || 0, km: run.km || 0, duration: run.duration || 0,
      pace: run.pace || null, won: run.won || 0, lost: run.lost || 0, net: run.net || 0, xp,
    });
    (run.merveilles || []).forEach((id) => store.claimMerveille(id));

    const p = store.profile();
    const life = {
      territory: p.territory, runs: p.runs.length,
      km: p.runs.reduce((s, r) => s + (r.km || 0), 0),
      zones: p.runs.reduce((s, r) => s + (r.zones || 0), 0),
      merveilles: store.claimedMerveilles().size,
    };
    const ctx = { life, run: { net: run.net || 0, zones: run.zones || 0, km: run.km || 0, pace: run.pace, lost: run.lost || 0, merveilles: (run.merveilles || []).length } };
    const earned = evaluateBadges(ctx, store.badges());
    store.awardBadges(earned);
    const bonusXp = earned.reduce((s, id) => s + (BADGE_BY_ID[id]?.xp || 0), 0);
    if (bonusXp) store.addRun({ date: Date.now(), zones: 0, km: 0, duration: 0, net: 0, xp: bonusXp, _bonus: true });

    return { xpGained: xp + bonusXp, badgesEarned: earned, territory: store.profile().territory };
  }

  async getBadges() {
    return { catalogue: BADGES.map(({ test, ...b }) => b), earned: [...store.badges()] };
  }
  async getMerveilles() {
    const claimed = store.claimedMerveilles();
    return MERVEILLES.map((m) => ({ ...m, claimed: claimed.has(m.id) }));
  }
  async claimMerveille(id) { store.claimMerveille(id); return { ok: true, bonus: 3 }; }

  /* État persistant d'une tuile (owner + attributs + top 10). Cache local. */
  async getTile(id) {
    const t = store.getTile(id);
    const top10 = t ? [{ player: "Toi", points: t.count, passes: t.count }] : [];
    return {
      id,
      owner: t && t.owner === "me" ? { id: "me", name: "Toi", me: true } : null,
      attributes: { count: t?.count || 0, capturedAt: t?.capturedAt || null, lat: t?.lat, lng: t?.lng },
      top10,
      forSale: !t, price: 4.99, // monétisation (indicatif)
    };
  }
  async purchaseTile(id) { return { ok: true, receiptId: "mock-" + id }; }

  async getLeaderboard() {
    return [
      { name: "Kova", zones: 342 }, { name: "Diesel", zones: 287 }, { name: "Nyx", zones: 231 },
      { name: "Piston", zones: 198 }, { name: "Aria", zones: 156 }, { name: "Zephyr", zones: 121 }, { name: "Blitz", zones: 88 },
    ];
  }
}

export function createBackend() {
  const base = import.meta.env && import.meta.env.VITE_API_BASE;
  return base ? new RemoteBackend(base) : new MockBackend();
}
