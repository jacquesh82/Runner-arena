import { el } from "../router.js";

export class SplashScreen {
  constructor(ctx) { this.ctx = ctx; }
  mount() {
    return el(`
      <div class="screen--solid screen--splash">
        <img class="splash-badge" src="logo-badge.png" alt="Runner Arena" />
        <div class="splash-tag">Cours pour conquérir le territoire</div>
      </div>`);
  }
  enter() {
    clearTimeout(this._t);
    this._t = setTimeout(() => {
      this.ctx.router.go(this.ctx.store.isFirstLaunch() ? "onboarding" : "home");
    }, 1700);
  }
  leave() { clearTimeout(this._t); }
}
