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
  // Sur desktop web sans GPS, on force le simulateur pour une démo jouable.
  // ?sim=1 force aussi la simulation (démo / captures).
  const isNative = Capacitor.isNativePlatform();
  const forceSim = new URLSearchParams(window.location.search).has("sim");
  const simulate = forceSim || (!isNative && !("geolocation" in navigator));

  const location = new LocationService({ simulate, start: START });
  const ui = new UiService(location, { start: START });
  await ui.init();

  // Verrouillage portrait sur mobile natif.
  if (isNative) {
    try {
      const { ScreenOrientation } = await import("@capacitor/screen-orientation");
      await ScreenOrientation.lock({ orientation: "portrait" });
    } catch (_) {}
  }

  // exposé pour debug console
  window.__arena = { location, ui };
}

boot().catch((e) => console.error("Boot error:", e));
