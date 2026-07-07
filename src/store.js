/* Cache local (localStorage) — miroir du backend distant.
 * En production, ces données sont la source de vérité côté serveur ;
 * ici on persiste localement pour que l'app tourne en démo hors-ligne. */
const KEY = "runnerarena.v1";

function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (_) {} }

export const store = {
  isFirstLaunch() { return !load().onboarded; },
  setOnboarded() { const d = load(); d.onboarded = true; save(d); },

  addRun(run) {
    const d = load();
    d.runs = d.runs || [];
    d.runs.unshift(run);
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
