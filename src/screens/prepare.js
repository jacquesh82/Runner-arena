import { el } from "../router.js";

export class PrepareScreen {
  constructor(ctx) { this.ctx = ctx; }
  mount() {
    const root = el(`
      <div class="screen--overlay screen--prepare">
        <button class="close-btn" id="pr-cancel">✕</button>
        <div class="prepare-center">
          <div class="gps-status" id="pr-status">
            <div class="gps-spinner"></div>
            <span>Calage GPS…</span>
          </div>
          <div class="countdown" id="pr-count"></div>
        </div>
        <div class="prepare-hint">Place-toi dehors pour un meilleur signal</div>
      </div>`);
    root.querySelector("#pr-cancel").addEventListener("click", () => this._cancel());
    this.el = root;
    this._onFix = (e) => this._fix(e.detail);
    return root;
  }

  async enter() {
    this._done = false;
    this.el.querySelector("#pr-status").style.display = "";
    this.el.querySelector("#pr-count").textContent = "";
    this.ctx.location.addEventListener("fix", this._onFix, { once: true });
    await this.ctx.location.start();
  }

  leave() {
    this.ctx.location.removeEventListener("fix", this._onFix);
    clearInterval(this._iv);
  }

  _fix(latlng) {
    if (this._done) return;
    this._done = true;
    this.ctx.engine.setCenter([latlng.lat, latlng.lng]);
    const status = this.el.querySelector("#pr-status");
    status.innerHTML = '<div class="gps-ok">✓</div><span>GPS calé</span>';
    setTimeout(() => this._countdown(), 550);
  }

  _countdown() {
    const status = this.el.querySelector("#pr-status");
    const box = this.el.querySelector("#pr-count");
    status.style.display = "none";
    let n = 3;
    const tick = () => {
      if (n > 0) {
        box.textContent = n;
        box.classList.remove("pop"); void box.offsetWidth; box.classList.add("pop");
        n--;
      } else {
        box.textContent = "GO !";
        box.classList.remove("pop"); void box.offsetWidth; box.classList.add("pop");
        clearInterval(this._iv);
        setTimeout(() => this._start(), 550);
      }
    };
    tick();
    this._iv = setInterval(tick, 800);
  }

  _start() {
    this.ctx.location.beginRun();
    this.ctx.engine.beginRun();
    this.ctx.router.go("run");
  }

  _cancel() {
    this.ctx.location.stop();
    this.ctx.router.go("home");
  }
}
