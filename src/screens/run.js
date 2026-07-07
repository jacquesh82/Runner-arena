import { el } from "../router.js";

export class RunScreen {
  constructor(ctx) { this.ctx = ctx; }
  mount() {
    const root = el(`
      <div class="screen--hud screen--run">
        <header class="hud-top">
          <div class="stat"><span class="stat-val" id="r-zones">0</span><span class="stat-lbl">zones</span></div>
          <div class="stat"><span class="stat-val" id="r-dist">0.00</span><span class="stat-lbl">km</span></div>
          <div class="stat"><span class="stat-val" id="r-time">00:00</span><span class="stat-lbl">durée</span></div>
          <div class="stat"><span class="stat-val" id="r-pace">--</span><span class="stat-lbl">min/km</span></div>
        </header>

        <div class="run-banner" id="r-banner"></div>

        <footer class="hud-bottom">
          <button class="fab" id="r-pause">⏸</button>
          <button class="run-btn running" id="r-stop"><span class="run-ring"></span><span>STOP</span></button>
          <button class="fab" id="r-recenter">◎</button>
        </footer>

        <div class="pause-overlay" id="r-pauseov">
          <div class="pause-card">
            <h2>Course en pause</h2>
            <button class="btn-primary" id="r-resume">Reprendre</button>
            <button class="btn-ghost" id="r-end">Terminer la course</button>
          </div>
        </div>`);
    root.querySelector("#r-stop").addEventListener("click", () => this._finish());
    root.querySelector("#r-pause").addEventListener("click", () => this._pause());
    root.querySelector("#r-resume").addEventListener("click", () => this._resume());
    root.querySelector("#r-end").addEventListener("click", () => this._finish());
    root.querySelector("#r-recenter").addEventListener("click", () => this.ctx.engine.recenter());
    this.el = root;
    this._onStats = (e) => this._stats(e.detail);
    this._onCapture = (e) => this._capture(e.detail);
    return root;
  }

  enter() {
    this.el.querySelector("#r-zones").textContent = "0";
    this.el.querySelector("#r-dist").textContent = "0.00";
    this.el.querySelector("#r-pace").textContent = "--";
    this.el.querySelector("#r-pauseov").classList.remove("show");
    this.ctx.location.addEventListener("stats", this._onStats);
    this.ctx.engine.addEventListener("capture", this._onCapture);
    this._timer = setInterval(() => this._tick(), 250);
  }
  leave() {
    this.ctx.location.removeEventListener("stats", this._onStats);
    this.ctx.engine.removeEventListener("capture", this._onCapture);
    clearInterval(this._timer);
  }

  _tick() {
    const s = this.ctx.location.state === "running" ? this.ctx.location.elapsed() : this._frozen || 0;
    if (this.ctx.location.state === "running") this._frozen = s;
    const mm = Math.floor(s / 60), ss = Math.floor(s % 60);
    this.el.querySelector("#r-time").textContent = String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
  }
  _stats(d) {
    this.el.querySelector("#r-dist").textContent = (d.distance / 1000).toFixed(2);
    this.el.querySelector("#r-pace").textContent = d.pace && isFinite(d.pace) ? d.pace.toFixed(1) : "--";
  }
  _capture(d) {
    this.el.querySelector("#r-zones").textContent = d.zones;
    this._banner(d.stolen ? "Zone volée à l'adversaire !" : "Zone conquise !");
  }
  _banner(msg) {
    const b = this.el.querySelector("#r-banner");
    b.textContent = msg; b.classList.add("show");
    clearTimeout(this._bt); this._bt = setTimeout(() => b.classList.remove("show"), 1500);
  }

  _pause() { this.ctx.location.pauseRun(); this.el.querySelector("#r-pauseov").classList.add("show"); }
  _resume() { this.ctx.location.resumeRun(); this.el.querySelector("#r-pauseov").classList.remove("show"); }

  _finish() {
    const zones = this.ctx.engine.zones;
    const summary = this.ctx.location.endRun();
    this.ctx.engine.endRun();
    const pace = summary.distance > 20 ? summary.duration / 60 / (summary.distance / 1000) : null;
    this.ctx.router.go("combat", {
      zones,
      distance: summary.distance,
      duration: summary.duration,
      pace,
    });
  }
}
