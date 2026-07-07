/* Persistance légère (localStorage) : onboarding, profil, historique. */
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
    const level = 1 + Math.floor(xp / 100);
    return {
      xp,
      level,
      xpInLevel: xp % 100,
      territory: Math.max(0, d.territory || 0),
      runs: d.runs || [],
    };
  },
};
