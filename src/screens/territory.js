import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { el } from "../router.js";
import { mPerDegLng } from "../hexgrid.js";

const SIZE = 55; // rayon hex en mètres (identique au jeu)

function hexRing(lat, lng) {
  const mLng = mPerDegLng(lat);
  const ring = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    ring.push([lng + (SIZE * Math.cos(a)) / mLng, lat + (SIZE * Math.sin(a)) / 111320]);
  }
  ring.push(ring[0]);
  return ring;
}
function toGeoJSON(tiles) {
  return {
    type: "FeatureCollection",
    features: tiles.map((t) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: [hexRing(t.lat, t.lng)] }, properties: { id: t.id } })),
  };
}
function mapStyle() {
  return {
    version: 8,
    sources: { base: { type: "raster", tiles: ["a", "b", "c"].map((s) => `https://${s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png`), tileSize: 256, attribution: "© OpenStreetMap © CARTO" } },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#0c1a2b" } },
      { id: "base", type: "raster", source: "base", paint: { "raster-brightness-max": 0.85, "raster-saturation": -0.1 } },
    ],
  };
}

/* Carte des territoires déjà conquis (persistés dans le store). */
export class TerritoryScreen {
  constructor(ctx) { this.ctx = ctx; }
  mount() {
    const root = el(`
      <div class="screen--solid screen--territory">
        <header class="list-top"><h1>🗺️ Territoire</h1><span class="terr-count" id="terr-count"></span></header>
        <div class="terr-wrap">
          <div id="terr-map" class="terr-map"></div>
          <div class="terr-empty" id="terr-empty" hidden>
            <div class="terr-empty-ic">🗺️</div>
            <p>Aucun territoire conquis pour l'instant.<br>Lance une course pour t'emparer de tes premières zones !</p>
          </div>
          <div class="terr-detail" id="terr-detail" hidden></div>
        </div>
      </div>`);
    this.el = root;
    return root;
  }

  enter() {
    const tiles = this.ctx.store.getTerritory();
    this.el.querySelector("#terr-count").textContent = tiles.length ? `${tiles.length} zones` : "";
    const empty = this.el.querySelector("#terr-empty");
    if (!tiles.length) {
      empty.hidden = false;
      if (this.map) this.map.getContainer().style.visibility = "hidden";
      return;
    }
    empty.hidden = true;
    if (!this.map) this._create();
    this.map.getContainer().style.visibility = "visible";
    this._render(tiles);
  }

  _create() {
    this.map = new maplibregl.Map({
      container: this.el.querySelector("#terr-map"),
      style: mapStyle(),
      center: [this.ctx.START[1], this.ctx.START[0]],
      zoom: 14, dragRotate: false, attributionControl: { compact: true },
    });
    this._loaded = new Promise((res) => { let d = false; const go = () => { if (!d) { d = true; res(); } }; this.map.once("load", go); setTimeout(go, 3000); });
  }

  async _render(tiles) {
    await this._loaded;
    const data = toGeoJSON(tiles);
    if (this.map.getSource("terr")) {
      this.map.getSource("terr").setData(data);
    } else {
      this.map.addSource("terr", { type: "geojson", data });
      this.map.addLayer({ id: "terr-fill", type: "fill", source: "terr", paint: { "fill-color": "#237749", "fill-opacity": 0.42 } });
      this.map.addLayer({ id: "terr-line", type: "line", source: "terr", paint: { "line-color": "#34ad69", "line-width": 1.4, "line-opacity": 0.9 } });
      // Tap sur une tuile → fiche (id, owner, attributs, top 10)
      this.map.on("click", "terr-fill", (e) => { const f = e.features && e.features[0]; if (f) this._openTile(f.properties.id); });
      this.map.on("mouseenter", "terr-fill", () => { this.map.getCanvas().style.cursor = "pointer"; });
      this.map.on("mouseleave", "terr-fill", () => { this.map.getCanvas().style.cursor = ""; });
    }
    let mnLng = 180, mnLat = 90, mxLng = -180, mxLat = -90;
    for (const t of tiles) {
      if (t.lng < mnLng) mnLng = t.lng; if (t.lng > mxLng) mxLng = t.lng;
      if (t.lat < mnLat) mnLat = t.lat; if (t.lat > mxLat) mxLat = t.lat;
    }
    const fit = () => {
      this.map.resize(); // le conteneur a sa taille définitive avant de cadrer
      try { this.map.fitBounds([[mnLng, mnLat], [mxLng, mxLat]], { padding: 60, maxZoom: 16.5, duration: 0 }); } catch (_) {}
    };
    fit();
    requestAnimationFrame(fit); // filet de sécurité après un frame de layout
  }

  async _openTile(id) {
    const panel = this.el.querySelector("#terr-detail");
    panel.hidden = false;
    panel.innerHTML = `<div class="td-head"><b>Tuile</b><button class="td-close" id="td-close">✕</button></div><div class="td-id">${id}</div><div class="td-load">…</div>`;
    panel.querySelector("#td-close").onclick = () => { panel.hidden = true; };
    let info = null;
    try { info = await this.ctx.backend.getTile(id); } catch (_) {}
    if (panel.hidden) return;
    const owner = info?.owner ? (info.owner.me ? "Toi" : info.owner.name || info.owner.id) : "Libre";
    const attr = info?.attributes || {};
    const when = attr.capturedAt ? new Date(attr.capturedAt).toLocaleDateString() : "—";
    const top = (info?.top10 || []);
    const topHtml = top.length
      ? top.map((t, i) => `<div class="td-rank"><span>${i + 1}</span><span class="td-name">${t.player}</span><span class="td-pts">${t.points ?? t.passes ?? 0}</span></div>`).join("")
      : `<div class="td-empty">Aucun classement pour l'instant</div>`;
    panel.innerHTML = `
      <div class="td-head"><b>${info?.merveille ? info.merveille.icon + " " + info.merveille.name : "Tuile"}</b><button class="td-close" id="td-close">✕</button></div>
      <div class="td-id">${id}</div>
      <div class="td-grid">
        <div><label>Propriétaire</label><span class="${info?.owner?.me ? "td-me" : ""}">${owner}</span></div>
        <div><label>Captures</label><span>${attr.count ?? 0}</span></div>
        <div><label>Depuis</label><span>${when}</span></div>
      </div>
      <div class="td-sec">🏆 Top 10 de la tuile</div>
      <div class="td-top">${topHtml}</div>`;
    panel.querySelector("#td-close").onclick = () => { panel.hidden = true; };
  }
}
