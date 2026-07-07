/* ======================================================================
 * SERVICE 1 — Localisation (GPS + GPX)
 * ----------------------------------------------------------------------
 * Cycle de vie :
 *   start()      -> commence à écouter le GPS (calage), état "ready"
 *   beginRun()   -> démarre l'enregistrement de la course, état "running"
 *   pauseRun()   -> suspend l'enregistrement, état "paused"
 *   resumeRun()  -> reprend, état "running"
 *   endRun()     -> arrête tout, renvoie le résumé
 *
 * Événements :
 *   "position" {lat,lng,accuracy,speed,ele,ts,ax,ay,az,am}  à chaque point
 *   "fix"      {lat,lng}                          au 1er point (calage GPS ok)
 *   "stats"    {distance,duration,speed,pace}     pendant la course
 *   "status"   {state,source}
 *
 * CAPTURE ÉCRAN ÉTEINT (fond) — sur mobile natif, on utilise
 * @capacitor-community/background-geolocation qui démarre un SERVICE AU
 * PREMIER PLAN (notification persistante + foregroundServiceType="location").
 * Ce service maintient le processus vivant et continue de recevoir le GPS
 * écran éteint / app en arrière-plan, et il est EXEMPTÉ de Doze et de
 * l'optimiseur de batterie tant qu'il tourne. Le plugin @capacitor/geolocation
 * (WebView) ne sert plus que de repli sur le Web (aperçu navigateur).
 * L'accéléromètre est capté via @capacitor/motion pendant la course.
 * ====================================================================== */

import { Capacitor, registerPlugin } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { Motion } from "@capacitor/motion";
import { buildGpx, saveGpx } from "../gpx.js";

// Service au premier plan (natif) — enregistré via registerPlugin (le paquet
// ne fournit que le code natif + les types, pas d'entrée JS par défaut).
const BackgroundGeolocation = registerPlugin("BackgroundGeolocation");

const M_PER_DEG_LAT = 111320;
const mPerDegLng = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

function haversine(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180, la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export class LocationService extends EventTarget {
  constructor({ simulate = false, start = [48.8566, 2.3522] } = {}) {
    super();
    this.simulate = simulate;
    this.startLatLng = start;
    this.state = "idle"; // idle | ready | running | paused
    this.source = null;

    this.track = [];
    this.last = null;
    this.distance = 0;
    this.startedAt = 0;
    this.gotFix = false;

    this._watchId = null;       // repli Web (@capacitor/geolocation)
    this._bgWatcher = null;     // service au premier plan (natif, écran éteint)
    this._simTimer = null;
    this._sim = null;
    this._fallback = null;
    this._accel = null;         // dernier échantillon accéléromètre {x,y,z,mag}
    this._accelHandle = null;
  }

  get recording() { return this.state === "running"; }

  /* ---- Calage GPS ---------------------------------------------------- */
  async start() {
    if (this.state !== "idle") return;
    this.state = "ready";
    this.gotFix = false;
    this._startAccel();
    let ok = false;
    if (!this.simulate) ok = await this._startGps();
    if (!ok) {
      this._startSimulator();
    } else if (!Capacitor.isNativePlatform()) {
      // Repli simulateur RÉSERVÉ à l'aperçu navigateur (WebGL headless sans GPS).
      // Sur mobile, on attend le vrai fix GPS (calage à froid + dialog de
      // permission peuvent dépasser 4 s) — jamais de bascule silencieuse.
      this._fallback = setTimeout(() => {
        if (!this.gotFix) { this._stopGps(); this._startSimulator(); }
      }, 4000);
    }
    this._emit("status", { state: this.state, source: this.source });
  }

  /* ---- Course -------------------------------------------------------- */
  beginRun() {
    this.track = []; this.last = null; this.distance = 0;
    this.startedAt = this._now();
    this.state = "running";
    this._emit("status", { state: this.state, source: this.source });
  }
  pauseRun() { if (this.state === "running") { this.state = "paused"; this._emit("status", { state: this.state, source: this.source }); } }
  resumeRun() { if (this.state === "paused") { this.state = "running"; this._emit("status", { state: this.state, source: this.source }); } }

  endRun() {
    const summary = {
      distance: this.distance,
      duration: (this._now() - this.startedAt) / 1000,
      points: this.track.length,
    };
    this.stop();
    return summary;
  }

  stop() {
    this.state = "idle";
    this._stopGps();
    this._stopAccel();
    if (this._simTimer) { clearInterval(this._simTimer); this._simTimer = null; }
    if (this._fallback) { clearTimeout(this._fallback); this._fallback = null; }
    this._emit("status", { state: this.state, source: this.source });
  }

  elapsed() { return this.startedAt ? (this._now() - this.startedAt) / 1000 : 0; }

  /* ---- GPS réel ------------------------------------------------------ */
  async _startGps() {
    // Sur mobile : service au premier plan → capture écran éteint + hors Doze.
    if (Capacitor.isNativePlatform()) return this._startBackgroundGps();
    // Sur Web (aperçu navigateur) : watchPosition classique (premier plan seul).
    return this._startWebGps();
  }

  /* Service au premier plan : continue GPS écran éteint / app en fond, et
   * échappe à l'optimiseur de batterie tant que le service tourne. */
  async _startBackgroundGps() {
    try {
      this._bgWatcher = await BackgroundGeolocation.addWatcher(
        {
          backgroundTitle: "Runner Arena — course en cours",
          backgroundMessage: "Enregistrement de ton parcours (GPX). Écran éteint OK.",
          requestPermissions: true,
          stale: false,
          distanceFilter: 4, // mètres : filtre le bruit GPS
        },
        (location, error) => {
          if (error) {
            // Permission refusée → propose d'ouvrir les réglages, puis repli simulateur.
            if (error.code === "NOT_AUTHORIZED") {
              this._emit("permission", { denied: true });
            }
            console.warn("[LocationService] BG geo :", error.code || error.message);
            return;
          }
          if (!location) return;
          this._ingest({
            lat: location.latitude, lng: location.longitude,
            accuracy: location.accuracy, speed: location.speed ?? null,
            ele: location.altitude ?? null, ts: location.time || this._now(),
          });
        }
      );
      this.source = "gps";
      return true;
    } catch (e) {
      console.warn("[LocationService] Service GPS de fond indisponible :", e?.message);
      return this._startWebGps(); // dernier repli
    }
  }

  async _startWebGps() {
    try {
      if (Capacitor.isNativePlatform()) await Geolocation.requestPermissions();
      this._watchId = await Geolocation.watchPosition(
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
        (pos, err) => {
          if (err || !pos) return;
          const c = pos.coords;
          this._ingest({ lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, speed: c.speed ?? null, ele: c.altitude ?? null, ts: pos.timestamp || this._now() });
        }
      );
      this.source = "gps";
      return true;
    } catch (e) {
      console.warn("[LocationService] GPS indisponible :", e?.message);
      return false;
    }
  }

  _stopGps() {
    if (this._bgWatcher != null) {
      try { BackgroundGeolocation.removeWatcher({ id: this._bgWatcher }); } catch (_) {}
      this._bgWatcher = null;
    }
    if (this._watchId != null) { try { Geolocation.clearWatch({ id: this._watchId }); } catch (_) {} this._watchId = null; }
  }

  /* ---- Accéléromètre (et autres capteurs de mouvement) --------------- */
  async _startAccel() {
    if (this._accelHandle) return;
    try {
      this._accelHandle = await Motion.addListener("accel", (e) => {
        const a = e.acceleration || e.accelerationIncludingGravity;
        if (!a) return;
        const mag = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
        this._accel = { x: a.x, y: a.y, z: a.z, mag };
      });
    } catch (e) {
      // Capteur indisponible (ex. desktop) → on continue sans accélération.
      console.warn("[LocationService] Accéléromètre indisponible :", e?.message);
    }
  }
  _stopAccel() {
    if (this._accelHandle) { try { this._accelHandle.remove(); } catch (_) {} this._accelHandle = null; }
    this._accel = null;
  }

  /* Ouvre les réglages de l'app pour désactiver l'optimisation de batterie
   * (fiabilité maximale du suivi écran éteint sur certains constructeurs). */
  async openBatterySettings() {
    if (!Capacitor.isNativePlatform()) return false;
    try { await BackgroundGeolocation.openSettings(); return true; } catch (_) { return false; }
  }

  /* ---- Simulateur ---------------------------------------------------- */
  _startSimulator() {
    this.source = "simulateur";
    this._sim = { lat: this.startLatLng[0], lng: this.startLatLng[1], dir: Math.random() * 6.28, turn: 0, speed: 3.2 };
    let t = this._now();
    this._simTimer = setInterval(() => {
      const s = this._sim, now = this._now(), dt = Math.min((now - t) / 1000, 0.5);
      t = now;
      s.turn += (Math.random() - 0.5) * 1.6 * dt; s.turn *= 0.9; s.dir += s.turn;
      const d = s.speed * dt;
      s.lat += (Math.sin(s.dir) * d) / M_PER_DEG_LAT;
      s.lng += (Math.cos(s.dir) * d) / mPerDegLng(s.lat);
      this._ingest({ lat: s.lat, lng: s.lng, accuracy: 5, speed: s.speed, ele: 35, ts: now });
    }, 250);
  }

  /* ---- Traitement ---------------------------------------------------- */
  _ingest(p) {
    if (this.state === "idle") return;
    // Joint le dernier échantillon d'accélération au point GPS.
    if (this._accel) { p.ax = this._accel.x; p.ay = this._accel.y; p.az = this._accel.z; p.am = this._accel.mag; }
    if (!this.gotFix) { this.gotFix = true; if (this._fallback) { clearTimeout(this._fallback); this._fallback = null; } this._emit("fix", { lat: p.lat, lng: p.lng }); }
    this._emit("position", p);
    if (this.state !== "running") return;

    if (this.last) { const d = haversine(this.last, p); if (d < 200) this.distance += d; }
    this.last = p; this.track.push(p);

    const duration = (this._now() - this.startedAt) / 1000;
    const speed = p.speed && p.speed > 0 ? p.speed : this._avgSpeed();
    this._emit("stats", { distance: this.distance, duration, speed, pace: speed > 0.2 ? 1000 / speed / 60 : null });
  }

  _avgSpeed() {
    const n = this.track.length; if (n < 2) return 0;
    const a = this.track[n - 2], b = this.track[n - 1], dt = (b.ts - a.ts) / 1000;
    return dt > 0 ? haversine(a, b) / dt : 0;
  }

  /* ---- Export GPX (construit depuis la trace GPS réelle) ------------- */
  buildGpx(name = "Runner Arena") {
    return buildGpx(this.track, name);
  }

  async exportGpx() {
    return saveGpx(this.buildGpx(), `runner-arena-${this._stamp()}.gpx`);
  }

  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  _now() { return typeof performance !== "undefined" ? performance.timeOrigin + performance.now() : Date.now(); }
  _stamp() {
    const d = new Date(this._now()), p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }
}
