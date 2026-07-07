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
    features: tiles.map((t) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: [hexRing(t.lat, t.lng)] }, properties: {} })),
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
}
