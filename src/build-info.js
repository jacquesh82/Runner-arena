/* ======================================================================
 * BuildInfo — source unique de la version/build/plateforme.
 * Les constantes sont injectées au build par Vite (voir vite.config.js).
 * En dev, elles retombent sur des valeurs par défaut lisibles.
 *
 * Portabilité Unity : côté Unity, remplacer ce module par un lecteur de
 * `Application.version` + build number ; l'UI ne consomme que `BuildInfo.label`.
 * ==================================================================== */
/* global __APP_VERSION__, __BUILD_NUMBER__, __BUILD_PLATFORM__ */

const version =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";
const build =
  typeof __BUILD_NUMBER__ !== "undefined" ? __BUILD_NUMBER__ : "dev";
const platform =
  typeof __BUILD_PLATFORM__ !== "undefined" ? __BUILD_PLATFORM__ : "WebGL";

export const BuildInfo = {
  version,
  build,
  platform,
  /** Ex. « v0.2.0 (build 128) — WebGL » */
  label: `v${version} (build ${build}) — ${platform}`,
};
