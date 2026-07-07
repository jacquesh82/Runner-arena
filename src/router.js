/* Routeur d'écrans minimal. Chaque écran : { mount(): HTMLElement, enter?(p), leave?() }.
 * Les écrans sont montés paresseusement dans #screens et affichés via la classe .active. */
export class Router {
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx;
    this.screens = {};
    this.current = null;
    this.currentName = null;
  }

  register(name, screen) { this.screens[name] = screen; }

  go(name, params) {
    const next = this.screens[name];
    if (!next) throw new Error("Écran inconnu : " + name);
    if (!next.el) { next.el = next.mount(); next.el.classList.add("screen"); this.root.appendChild(next.el); }
    if (this.current && this.current !== next) {
      this.current.leave && this.current.leave();
      this.current.el.classList.remove("active");
    }
    next.el.classList.add("active");
    next.enter && next.enter(params || {});
    this.current = next;
    this.currentName = name;
    this.onNavigate && this.onNavigate(name);
  }
}

/* Petit helper : crée un élément depuis une chaîne HTML. */
export function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
