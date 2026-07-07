import { el } from "../router.js";

export class OnboardingScreen {
  constructor(ctx) { this.ctx = ctx; }
  mount() {
    const root = el(`
      <div class="screen--solid screen--onboard">
        <div class="onboard-icon">📍</div>
        <h1>Autorise la localisation</h1>
        <p>Runner Arena a besoin de ta position GPS pour transformer ta course
           en conquête de territoire. Tes zones sont capturées en temps réel
           pendant que tu cours.</p>
        <ul class="onboard-list">
          <li>🏃 Ta position <b>est</b> le runner</li>
          <li>⬡ Chaque hexagone traversé est capturé</li>
          <li>💾 Ton parcours est exportable en GPX</li>
        </ul>
        <button class="btn-primary" id="ob-go">Activer la localisation</button>
        <button class="btn-ghost" id="ob-skip">Plus tard</button>
      </div>`);
    root.querySelector("#ob-go").addEventListener("click", () => this._accept());
    root.querySelector("#ob-skip").addEventListener("click", () => this._accept());
    this.el = root;
    return root;
  }
  async _accept() {
    this.ctx.store.setOnboarded();
    this.ctx.router.go("home");
  }
}
