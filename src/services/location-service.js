/* ======================================================================
 * SERVICE 1 — Localisation (GPS + GPX)
 * ----------------------------------------------------------------------
 * Rôle unique : suivre la position, calculer distance/vitesse, enregistrer
 * la trace et l'exporter en GPX. Ne connaît NI la carte NI les hexagones.
 *
 * Communication avec le reste de l'app : via des événements (EventTarget).
 *   - "position"  { lat, lng, accuracy, speed, ele, ts }
 *   - "stats"     { distance, duration, pace, speed }
 *   - "status"    { state, source }   state: idle|running|paused
 * ====================================================================== */

import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";

const M_PER_DEG_LAT = 111320;
const mPerDegLng = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

function haversine(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export class LocationService extends EventTarget {
  constructor({ simulate = false, start = [48.8566, 2.3522] } = {}) {
    super();
    this.simulate = simulate;
    this.startLatLng = start;
    this.state = "idle"; // idle | running | paused
    this.source = null; // gps | simulateur

    this.track = []; // points enregistrés { lat,lng,ele,ts,speed }
    this.last = null; // dernière position
    this.distance = 0; // mètres
    this.startedAt = 0;

    this._watchId = null;
    this._simTimer = null;
    this._sim = null;
  }

  /* ---- Cycle de vie -------------------------------------------------- */
  async start() {
    if (this.state === "running") return;
    this.state = "running";
    this.startedAt = this._now();
    this.distance = 0;
    this.track = [];
    this.last = null;

    let ok = false;
    if (!this.simulate) ok = await this._startGps();
    if (!ok) {
      this._startSimulator();
    } else {
      // Filet de sécurité : sans fix GPS sous 4 s, on bascule en simulation
      // (utile sur desktop / émulateur sans capteur).
      this._fallback = setTimeout(() => {
        if (this.state === "running" && this.track.length === 0) {
          console.warn("[LocationService] aucun fix GPS → simulateur");
          this._stopGps();
          this._startSimulator();
          this._emit("status", { state: this.state, source: this.source });
        }
      }, 4000);
    }

    this._emit("status", { state: this.state, source: this.source });
  }

  stop() {
    this.state = "idle";
    this._stopGps();
    if (this._simTimer) { clearInterval(this._simTimer); this._simTimer = null; }
    if (this._fallback) { clearTimeout(this._fallback); this._fallback = null; }
    this._emit("status", { state: this.state, source: this.source });
  }

  _stopGps() {
    if (this._watchId != null) {
      try { Geolocation.clearWatch({ id: this._watchId }); } catch (_) {}
      this._watchId = null;
    }
  }

  /* ---- GPS réel ------------------------------------------------------ */
  async _startGps() {
    try {
      if (Capacitor.isNativePlatform()) {
        await Geolocation.requestPermissions();
      }
      this._watchId = await Geolocation.watchPosition(
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
        (pos, err) => {
          if (err || !pos) return;
          const c = pos.coords;
          this._ingest({
            lat: c.latitude,
            lng: c.longitude,
            accuracy: c.accuracy,
            speed: c.speed ?? null,
            ele: c.altitude ?? null,
            ts: pos.timestamp || this._now(),
          });
        }
      );
      this.source = "gps";
      return true;
    } catch (e) {
      console.warn("[LocationService] GPS indisponible, bascule simulateur :", e?.message);
      return false;
    }
  }

  /* ---- Simulateur (desktop / démo sans GPS) -------------------------- */
  _startSimulator() {
    this.source = "simulateur";
    this._sim = {
      lat: this.startLatLng[0],
      lng: this.startLatLng[1],
      dir: Math.random() * Math.PI * 2,
      turn: 0,
      speed: 3.2, // m/s ~ course tranquille
    };
    let t = this._now();
    this._simTimer = setInterval(() => {
      const s = this._sim;
      const now = this._now();
      const dt = Math.min((now - t) / 1000, 0.5);
      t = now;
      s.turn += (Math.random() - 0.5) * 1.6 * dt;
      s.turn *= 0.9;
      s.dir += s.turn;
      const dist = s.speed * dt;
      s.lat += (Math.sin(s.dir) * dist) / M_PER_DEG_LAT;
      s.lng += (Math.cos(s.dir) * dist) / mPerDegLng(s.lat);
      this._ingest({
        lat: s.lat, lng: s.lng, accuracy: 5,
        speed: s.speed, ele: 35, ts: now,
      });
    }, 250);
  }

  /* ---- Traitement d'une position ------------------------------------ */
  _ingest(p) {
    if (this.state !== "running") return;
    if (this._fallback) { clearTimeout(this._fallback); this._fallback = null; }
    if (this.last) {
      const d = haversine(this.last, p);
      if (d < 200) this.distance += d; // garde-fou anti-saut GPS
    }
    this.last = p;
    this.track.push(p);

    this._emit("position", p);

    const duration = (this._now() - this.startedAt) / 1000;
    const speed = p.speed && p.speed > 0 ? p.speed : this._avgSpeed();
    this._emit("stats", {
      distance: this.distance,
      duration,
      speed,
      pace: speed > 0.2 ? 1000 / speed / 60 : null, // min/km
    });
  }

  _avgSpeed() {
    const n = this.track.length;
    if (n < 2) return 0;
    const a = this.track[n - 2], b = this.track[n - 1];
    const dt = (b.ts - a.ts) / 1000;
    return dt > 0 ? haversine(a, b) / dt : 0;
  }

  /* ---- Export GPX ---------------------------------------------------- */
  buildGpx(name = "Runner Arena") {
    const pts = this.track
      .map(
        (p) =>
          `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}">` +
          (p.ele != null ? `<ele>${p.ele.toFixed(1)}</ele>` : "") +
          `<time>${new Date(p.ts).toISOString()}</time></trkpt>`
      )
      .join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Runner Arena" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${name}</name></metadata>
  <trk><name>${name}</name><trkseg>
${pts}
  </trkseg></trk>
</gpx>`;
  }

  async exportGpx() {
    const gpx = this.buildGpx();
    const fname = `runner-arena-${this._stamp()}.gpx`;
    if (Capacitor.isNativePlatform()) {
      const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
      await Filesystem.writeFile({
        path: fname, data: gpx, directory: Directory.Documents, encoding: Encoding.UTF8,
      });
      return { native: true, path: fname };
    }
    // Web : téléchargement
    const blob = new Blob([gpx], { type: "application/gpx+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fname; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { native: false, path: fname };
  }

  /* ---- utils --------------------------------------------------------- */
  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  _now() { return typeof performance !== "undefined" ? performance.timeOrigin + performance.now() : Date.now(); }
  _stamp() {
    const d = new Date(this._now());
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }
}
