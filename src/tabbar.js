/* Barre de navigation persistante (bottom tab bar) pour les écrans « menu ».
 * Masquée pendant le jeu (préparation, course, combat, résumé, intro). */
const TABS = [
  { id: "home", icon: "🏠", label: "Accueil" },
  { id: "collection", icon: "🎖", label: "Collection" },
  { id: "territory", icon: "🗺️", label: "Territoire" },
  { id: "leaderboard", icon: "🏆", label: "Classement" },
  { id: "options", icon: "⚙️", label: "Options" },
];
// Profil n'a plus d'onglet mais reste un écran « menu » (barre visible dessus).
const MENU = new Set([...TABS.map((t) => t.id), "profile"]);

export function createTabBar(router) {
  const el = document.getElementById("tabbar");
  el.innerHTML = TABS.map(
    (t) => `<button class="tab" data-tab="${t.id}">
      <span class="tab-ic">${t.icon}</span><span class="tab-lb">${t.label}</span>
    </button>`
  ).join("");
  el.querySelectorAll(".tab").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (router.currentName !== btn.dataset.tab) router.go(btn.dataset.tab);
    })
  );

  return {
    update(name) {
      const inMenu = MENU.has(name);
      el.classList.toggle("show", inMenu);
      if (inMenu) el.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    },
  };
}
