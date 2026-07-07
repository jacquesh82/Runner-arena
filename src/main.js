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

const START = [48.8566, 2.3522]; // Paris — position de repli avant le 1er fix GPS

async function boot() {
  const isNative = Capacitor.isNativePlatform();
  const forceSim = new URLSearchParams(window.location.search).has("sim");
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

  router.go("splash");

  if (isNative) {
    try {
      const { ScreenOrientation } = await import("@capacitor/screen-orientation");
      await ScreenOrientation.lock({ orientation: "portrait" });
    } catch (_) {}
  }

  window.__arena = { location, engine, router, store };
}

boot().catch((e) => console.error("Boot error:", e));
