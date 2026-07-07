/* ======================================================================
 * Runner Arena — point d'entrée.
 *   LocationService (GPS/GPX) ──▶ GameEngine (carte + jeu) ──▶ Router (écrans)
 * ====================================================================== */

import "./styles.css";
import { Capacitor } from "@capacitor/core";
import { LocationService } from "./services/location-service.js";
import { GameEngine } from "./game/game-engine.js";
import { store } from "./store.js";
import { createBackend } from "./api/backend.js";
import { Router } from "./router.js";
import { SplashScreen } from "./screens/splash.js";
import { OnboardingScreen } from "./screens/onboarding.js";
import { HomeScreen } from "./screens/home.js";
import { PrepareScreen } from "./screens/prepare.js";
import { RunScreen } from "./screens/run.js";
import { CombatScreen } from "./screens/combat.js";
import { SummaryScreen } from "./screens/summary.js";
import { LeaderboardScreen } from "./screens/leaderboard.js";
import { ProfileScreen } from "./screens/profile.js";
import { CollectionScreen } from "./screens/collection.js";
import { IntroScreen } from "./services/intro-service.js";
import { AuthManager } from "./services/auth-service.js";

const START = [48.8566, 2.3522]; // Paris — position de repli avant le 1er fix GPS

async function boot() {
  const params = new URLSearchParams(window.location.search);

  // ── Cinématique de fin « Prise de territoire » (combat + boss Nyx) ──
  // ?replay=1 rejoue la DERNIÈRE course réelle (sinon un tracé de démo).
  if (params.has("replay")) {
    document.getElementById("screens").style.display = "none";
    const { ReplayService, parseGpx } = await import("./services/replay-service.js");
    let track = null;
    try { const s = sessionStorage.getItem("arena.lastTrack"); if (s) track = JSON.parse(s); } catch (_) {}
    if (!track || track.length < 2) track = parseGpx(await (await fetch("demo.gpx")).text());
    const replay = new ReplayService(track, { container: "map", map: params.get("map") || "voyager" });
    await replay.init();
    const back = document.createElement("button");
    back.textContent = "← Accueil";
    back.style.cssText = "position:fixed;top:calc(env(safe-area-inset-top,0px) + 12px);left:12px;z-index:200;padding:10px 16px;border-radius:30px;border:1px solid rgba(120,160,255,.3);background:rgba(12,20,36,.8);color:#eaf0ff;font-weight:800;backdrop-filter:blur(8px)";
    back.onclick = () => { window.location.href = window.location.pathname; };
    document.body.appendChild(back);
    window.__arena = { replay };
    return;
  }

  const isNative = Capacitor.isNativePlatform();
  const forceSim = params.has("sim");
  const simulate = forceSim || (!isNative && !("geolocation" in navigator));

  const location = new LocationService({ simulate, start: START });
  const engine = new GameEngine(location, { start: START });
  engine.setClaimedMerveilles(store.claimedMerveilles());
  await engine.init();

  const backend = createBackend();
  const ctx = { location, engine, store, backend, START };
  const router = new Router(document.getElementById("screens"), ctx);
  ctx.router = router;

  router.register("splash", new SplashScreen(ctx));
  router.register("onboarding", new OnboardingScreen(ctx));
  router.register("home", new HomeScreen(ctx));
  router.register("prepare", new PrepareScreen(ctx));
  router.register("run", new RunScreen(ctx));
  router.register("combat", new CombatScreen(ctx));
  router.register("summary", new SummaryScreen(ctx));
  router.register("leaderboard", new LeaderboardScreen(ctx));
  router.register("profile", new ProfileScreen(ctx));
  router.register("collection", new CollectionScreen(ctx));

  // Intro AAA + connexion (Google / Mindlog / invité). Sautée si déjà connecté.
  const auth = new AuthManager();
  let profile = auth.restore();
  if (!profile) {
    const intro = new IntroScreen({ start: START });
    const res = await intro.show();
    profile = res.profile;
  }
  ctx.profile = profile;

  router.go("home");

  if (isNative) {
    try {
      const { ScreenOrientation } = await import("@capacitor/screen-orientation");
      await ScreenOrientation.lock({ orientation: "portrait" });
    } catch (_) {}
  }

  window.__arena = { location, engine, router, store, profile };
}

boot().catch((e) => console.error("Boot error:", e));
