import { el } from "../router.js";

/* Classement — données de démonstration + ta ligne (territoire réel). */
const BOTS = [
  { name: "Kova", zones: 342 }, { name: "Diesel", zones: 287 }, { name: "Nyx", zones: 231 },
  { name: "Piston", zones: 198 }, { name: "Aria", zones: 156 }, { name: "Zephyr", zones: 121 },
  { name: "Blitz", zones: 88 },
];

export class LeaderboardScreen {
  constructor(ctx) { this.ctx = ctx; }
  mount() {
    const root = el(`
      <div class="screen--solid screen--list">
        <header class="list-top">
          <button class="close-btn" id="lb-back">←</button>
          <h1>🏆 Classement</h1>
        </header>
        <div class="list-body" id="lb-body"></div>
      </div>`);
    root.querySelector("#lb-back").addEventListener("click", () => this.ctx.router.go("home"));
    this.el = root;
    return root;
  }
  enter() {
    const me = { name: "Toi", zones: this.ctx.store.profile().territory, me: true };
    const rows = [...BOTS, me].sort((a, b) => b.zones - a.zones);
    this.el.querySelector("#lb-body").innerHTML = rows.map((r, i) => `
      <div class="lb-row ${r.me ? "lb-row--me" : ""}">
        <span class="lb-rank">${i + 1}</span>
        <span class="lb-name">${r.name}</span>
        <span class="lb-zones">${r.zones}<small>⬡</small></span>
      </div>`).join("");
  }
}
