import { el } from "../router.js";

export class HomeScreen {
  constructor(ctx) { this.ctx = ctx; }
  mount() {
    const root = el(`
      <div class="screen--solid screen--home">
        <header class="home-top">
          <img class="home-logo" src="logo-wordmark.png" alt="Runner Arena" />
        </header>

        <section class="home-card">
          <div class="home-rank">
            <span class="rank-badge" id="h-level">1</span>
            <div>
              <div class="rank-title">Niveau <span id="h-level2">1</span></div>
              <div class="xp-bar"><i id="h-xp"></i></div>
            </div>
          </div>
          <div class="home-stats">
            <div><span class="hs-val" id="h-territory">0</span><span class="hs-lbl">zones possédées</span></div>
            <div><span class="hs-val" id="h-runs">0</span><span class="hs-lbl">courses</span></div>
          </div>
        </section>

        <button class="run-cta" id="h-run"><span>COURIR</span></button>

        <nav class="home-nav">
          <button class="nav-btn" id="h-coll">🎖<span>Collection</span></button>
          <button class="nav-btn" id="h-lead">🏆<span>Classement</span></button>
          <button class="nav-btn" id="h-prof">👤<span>Profil</span></button>
        </nav>
      </div>`);
    root.querySelector("#h-run").addEventListener("click", () => this.ctx.router.go("prepare"));
    root.querySelector("#h-coll").addEventListener("click", () => this.ctx.router.go("collection"));
    root.querySelector("#h-lead").addEventListener("click", () => this.ctx.router.go("leaderboard"));
    root.querySelector("#h-prof").addEventListener("click", () => this.ctx.router.go("profile"));
    this.el = root;
    return root;
  }
  enter() {
    const p = this.ctx.store.profile();
    this.el.querySelector("#h-level").textContent = p.level;
    this.el.querySelector("#h-level2").textContent = p.level;
    this.el.querySelector("#h-xp").style.width = p.xpInLevel + "%";
    this.el.querySelector("#h-territory").textContent = p.territory;
    this.el.querySelector("#h-runs").textContent = p.runs.length;
  }
}
