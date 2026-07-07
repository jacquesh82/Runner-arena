/* ======================================================================
 * BADGES — catalogue + règles d'attribution.
 *
 * En production, l'ÉVALUATION se fait côté backend (source de vérité, anti-triche)
 * à la réception d'une course. Ce fichier décrit le catalogue partagé et la logique
 * de référence, exécutée localement en démo.
 *
 * Un badge : { id, name, desc, icon, rarity, xp, test(ctx) }
 *   ctx = {
 *     life: { territory, runs, km, zones, merveilles },   // cumulés
 *     run:  { net, zones, km, pace, lost, merveilles },    // course courante
 *   }
 * rarity : common | rare | epic | legendary
 * ==================================================================== */
export const BADGES = [
  { id: "first_run",   name: "Premier pas",       desc: "Terminer ta première course",        icon: "🏁", rarity: "common",    xp: 20,  test: (c) => c.life.runs >= 1 },
  { id: "explorer",    name: "Explorateur",       desc: "Conquérir 10 zones au total",         icon: "🧭", rarity: "common",    xp: 30,  test: (c) => c.life.zones >= 10 },
  { id: "regular",     name: "Assidu",            desc: "Courir 5 fois",                        icon: "🔁", rarity: "common",    xp: 30,  test: (c) => c.life.runs >= 5 },
  { id: "conqueror",   name: "Conquérant",        desc: "Posséder 50 zones",                    icon: "👑", rarity: "rare",      xp: 60,  test: (c) => c.life.territory >= 50 },
  { id: "marathon",    name: "Marathonien",       desc: "Cumuler 10 km",                        icon: "🏃", rarity: "rare",      xp: 60,  test: (c) => c.life.km >= 10 },
  { id: "sprinter",    name: "Sprinteur",         desc: "Allure sous 5 min/km sur une course", icon: "⚡", rarity: "rare",      xp: 50,  test: (c) => c.run.pace != null && c.run.pace > 0 && c.run.pace < 5 },
  { id: "flawless",    name: "Invaincu",          desc: "0 zone perdue en combat",             icon: "🛡️", rarity: "rare",      xp: 40,  test: (c) => c.run.zones >= 3 && c.run.lost === 0 },
  { id: "hill_king",   name: "Roi de la colline", desc: "Gagner 10 zones en une course",       icon: "🏔️", rarity: "epic",      xp: 80,  test: (c) => c.run.net >= 10 },
  { id: "guardian",    name: "Gardien de merveille", desc: "Revendiquer une merveille",        icon: "⭐", rarity: "epic",      xp: 80,  test: (c) => c.life.merveilles >= 1 },
  { id: "collector",   name: "Collectionneur",    desc: "Revendiquer 5 merveilles",            icon: "🏆", rarity: "legendary", xp: 150, test: (c) => c.life.merveilles >= 5 },
];

export const BADGE_BY_ID = Object.fromEntries(BADGES.map((b) => [b.id, b]));

export const RARITY = {
  common:    { label: "Commun",    color: "#8aa0c8" },
  rare:      { label: "Rare",      color: "#34ad69" },
  epic:      { label: "Épique",    color: "#ec7a1c" },
  legendary: { label: "Légendaire",color: "#f2c400" },
};

/* Renvoie les ids de badges nouvellement débloqués (non déjà possédés). */
export function evaluateBadges(ctx, owned) {
  const out = [];
  for (const b of BADGES) {
    if (owned.has(b.id)) continue;
    try { if (b.test(ctx)) out.push(b.id); } catch (_) {}
  }
  return out;
}
