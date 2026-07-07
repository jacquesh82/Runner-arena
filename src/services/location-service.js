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
 *   "position" {lat,lng,accuracy,speed,ele,ts}   à chaque point (même en ready)
 *   "fix"      {lat,lng}                          au 1er point (calage GPS ok)
 *   "stats"    {distance,duration,speed,pace}     pendant la course
 *   "status"   {state,source}
 * ====================================================================== */

import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";

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

    this._watchId = null;
    this._simTimer = null;
    this._sim = null;
    this._fallback = null;
  }

  get recording() { return this.state === "running"; }

  /* ---- Calage GPS ---------------------------------------------------- */
  async start() {
    if (this.state !== "idle") return;
    this.state = "ready";
    this.gotFix = false;
    let ok = false;
    if (!this.simulate) ok = await this._startGps();
    if (!ok) {
      this._startSimulator();
    } else {
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
    if (this._simTimer) { clearInterval(this._simTimer); this._simTimer = null; }
    if (this._fallback) { clearTimeout(this._fallback); this._fallback = null; }
    this._emit("status", { state: this.state, source: this.source });
  }

  elapsed() { return this.startedAt ? (this._now() - this.startedAt) / 1000 : 0; }

  /* ---- GPS réel ------------------------------------------------------ */
  async _startGps() {
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
    if (this._watchId != null) { try { Geolocation.clearWatch({ id: this._watchId }); } catch (_) {} this._watchId = null; }
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

  /* ---- Export GPX ---------------------------------------------------- */
  buildGpx(name = "Runner Arena") {
    const pts = this.track.map((p) =>
      `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}">` +
      (p.ele != null ? `<ele>${p.ele.toFixed(1)}</ele>` : "") +
      `<time>${new Date(p.ts).toISOString()}</time></trkpt>`
    ).join("\n");
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
      await Filesystem.writeFile({ path: fname, data: gpx, directory: Directory.Documents, encoding: Encoding.UTF8 });
      return { native: true, path: fname };
    }
    const blob = new Blob([gpx], { type: "application/gpx+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fname; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { native: false, path: fname };
  }

  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  _now() { return typeof performance !== "undefined" ? performance.timeOrigin + performance.now() : Date.now(); }
  _stamp() {
    const d = new Date(this._now()), p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }
}
