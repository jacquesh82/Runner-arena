/* ======================================================================
 * Runner Arena — point d'entrée.
 * Instancie les 2 services et les câble ensemble.
 *   LocationService (GPS/GPX)  ──position──▶  UiService (carte + jeu)
 * ====================================================================== */

import "./styles.css";
import { LocationService } from "./services/location-service.js";
import { UiService } from "./services/ui-service.js";
import { Capacitor } from "@capacitor/core";

// Position de départ par défaut (avant le 1er point GPS). Change pour ta ville.
const START = [48.8566, 2.3522]; // Paris

async function boot() {
  const params = new URLSearchParams(window.location.search);

  // ?replay=1 → cinématique « fin de course » sur la vraie carte (démo GPX).
  if (params.has("replay")) {
    const { ReplayService, parseGpx } = await import("./services/replay-service.js");
    const src = params.get("gpx") || "/demo.gpx";
    const track = parseGpx(await (await fetch(src)).text());
    const replay = new ReplayService(track, {
      container: "map",
      map: params.get("map") || "light",
      mode: params.get("mode") || "passes",
    });
    await replay.init();
    window.__arena = { replay };
    return;
  }

  // Mode moteur du jeu (blitz / endurance / handicap). Par défaut endurance,
  // surchargé par ?mode=… puis par le choix du hub post-login.
  let gameMode = params.get("mode") || "endurance";

  // Intro (title screen) → Hub de gamification (monde + mode) → jeu.
  // ?nointro=1 saute intro + hub (dev / démos rapides).
  if (!params.has("nointro")) {
    const { IntroScreen } = await import("./services/intro-service.js");
    const intro = new IntroScreen();
    const session = await intro.show(); // résolu après auth (Google/Mindlog/local)

    const { GameHub } = await import("./services/menu-service.js");
    const hub = new GameHub(session);
    const choice = await hub.show(); // { worldId, modeId, mode }
    gameMode = choice.mode || gameMode;

    window.__arena = { ...(window.__arena || {}), session, choice };
  }

  // Sur desktop web sans GPS, on force le simulateur pour une démo jouable.
  // ?sim=1 force aussi la simulation (démo / captures).
  const isNative = Capacitor.isNativePlatform();
  const forceSim = new URLSearchParams(window.location.search).has("sim");
  const simulate = forceSim || (!isNative && !("geolocation" in navigator));

  const location = new LocationService({ simulate, start: START });
  const ui = new UiService(location, { start: START, mode: gameMode });
  await ui.init();

  // Verrouillage portrait sur mobile natif.
  if (isNative) {
    try {
      const { ScreenOrientation } = await import("@capacitor/screen-orientation");
      await ScreenOrientation.lock({ orientation: "portrait" });
    } catch (_) {}
  }

  // exposé pour debug console
  window.__arena = { ...(window.__arena || {}), location, ui };
}

boot().catch((e) => console.error("Boot error:", e));
