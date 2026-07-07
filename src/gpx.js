/* Construction & export GPX — utilitaire partagé (LocationService + Profil).
 * La trace vient du signal GPS réel (LocationService.track), points
 * { lat, lng, ele?, ts? }. */
import { Capacitor } from "@capacitor/core";

export function buildGpx(track, name = "Runner Arena") {
  const pts = (track || [])
    .filter((p) => p && p.lat != null && p.lng != null)
    .map(
      (p) =>
        `      <trkpt lat="${(+p.lat).toFixed(6)}" lon="${(+p.lng).toFixed(6)}">` +
        (p.ele != null ? `<ele>${(+p.ele).toFixed(1)}</ele>` : "") +
        (p.ts != null ? `<time>${new Date(p.ts).toISOString()}</time>` : "") +
        `</trkpt>`
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

export async function saveGpx(gpx, filename = "runner-arena.gpx") {
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
    await Filesystem.writeFile({ path: filename, data: gpx, directory: Directory.Documents, encoding: Encoding.UTF8 });
    return { native: true, path: filename };
  }
  const blob = new Blob([gpx], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { native: false, path: filename };
}

/* Réduit une trace à ~max points (garde 1er + dernier) pour un stockage léger. */
export function downsampleTrack(track, max = 600) {
  if (!track || track.length <= max) return track ? track.slice() : [];
  const step = track.length / max;
  const out = [];
  for (let i = 0; i < max; i++) out.push(track[Math.floor(i * step)]);
  if (out[out.length - 1] !== track[track.length - 1]) out.push(track[track.length - 1]);
  return out;
}
