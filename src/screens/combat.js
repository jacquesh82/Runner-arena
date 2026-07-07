import { el } from "../router.js";

export class CombatScreen {
  constructor(ctx) { this.ctx = ctx; }
  mount() {
    const root = el(`
      <div class="screen--hud screen--combat">
        <div class="combat-title" id="c-title">⚔ COMBAT DE TERRITOIRE</div>
        <div class="combat-tally">
          <div class="tally tally--won"><span id="c-won">0</span><small>conquises</small></div>
          <div class="tally-vs">VS</div>
          <div class="tally tally--lost"><span id="c-lost">0</span><small>perdues</small></div>
        </div>
        <button class="combat-next hidden" id="c-next">Voir le bilan →</button>
      </div>`);
    root.querySelector("#c-next").addEventListener("click", () => this._toSummary());
    this.el = root;
    return root;
  }

  async enter(runData) {
    this.runData = runData;
    const wonEl = this.el.querySelector("#c-won");
    const lostEl = this.el.querySelector("#c-lost");
    const title = this.el.querySelector("#c-title");
    const next = this.el.querySelector("#c-next");
    wonEl.textContent = "0"; lostEl.textContent = "0";
    next.classList.add("hidden");
    title.classList.remove("out"); void title.offsetWidth; title.classList.add("in");

    // laisse l'intro respirer, puis lance la résolution
    await new Promise((r) => setTimeout(r, 900));
    title.classList.add("out");

    this.result = await this.ctx.engine.playCombat(({ won, lost }) => {
      wonEl.textContent = won; lostEl.textContent = lost;
      if (won) this._bump(wonEl); if (lost) this._bump(lostEl);
    });

    await new Promise((r) => setTimeout(r, 600));
    this._ready = true;
    next.classList.remove("hidden");
    // auto-avance si l'utilisateur ne tape pas
    this._auto = setTimeout(() => this._toSummary(), 2200);
  }

  leave() { clearTimeout(this._auto); }

  _bump(node) { node.classList.remove("bump"); void node.offsetWidth; node.classList.add("bump"); }

  _toSummary() {
    if (!this._ready) return;
    clearTimeout(this._auto);
    this.ctx.router.go("summary", { ...this.runData, ...this.result });
  }
}
