/* ======================================================================
 * AuthManager — logique d'authentification, DÉCOUPLÉE du rendu.
 *
 * Trois chemins derrière une interface commune (IAuthProvider) :
 *   1. Google   — OAuth / Google Identity Services   (stub, attend un client_id)
 *   2. Mindlog  — OAuth / OpenID de ton fournisseur   (stub, attend endpoint+client_id)
 *   3. Local    — UUID joueur en localStorage, jouable hors-ligne, MIGRABLE
 *
 * Cette classe n'émet que des données (profil + évènements). Aucune UI ici :
 * au passage Unity, seul le layer présentation change, l'interface reste.
 *
 * Profil renvoyé : { id, provider, name, avatar?, local: boolean }
 * ==================================================================== */

const PROFILE_KEY = "arena.profile";
const LOCAL_ID_KEY = "arena.localId";

/** Erreur levée quand un fournisseur OAuth n'a pas encore ses clés. */
export class AuthNotConfiguredError extends Error {
  constructor(provider) {
    super(`Fournisseur « ${provider} » non configuré (clés manquantes)`);
    this.name = "AuthNotConfiguredError";
    this.provider = provider;
  }
}

/* ---- UUID v4 (crypto natif, fallback simple) ------------------------ */
function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/* ---- Interface IAuthProvider ---------------------------------------
 * { id: string, label: string, configured: boolean,
 *   signIn(): Promise<Profile> }
 * -------------------------------------------------------------------- */

class LocalAuthProvider {
  id = "local";
  label = "Jouer sans compte";
  configured = true;

  async signIn() {
    let uid = localStorage.getItem(LOCAL_ID_KEY);
    if (!uid) {
      uid = "local-" + uuid();
      localStorage.setItem(LOCAL_ID_KEY, uid);
    }
    return { id: uid, provider: "local", name: "Invité", local: true };
  }
}

class GoogleAuthProvider {
  id = "google";
  label = "Continuer avec Google";
  constructor({ clientId } = {}) {
    this.clientId = clientId || null;
    this.configured = Boolean(this.clientId);
  }

  async signIn() {
    if (!this.configured) throw new AuthNotConfiguredError("google");
    // TODO(prod) : Google Identity Services.
    //   1. charger https://accounts.google.com/gsi/client
    //   2. google.accounts.id.initialize({ client_id, callback })
    //   3. récupérer le credential (JWT) → l'échanger côté backend
    //   4. renvoyer { id, provider: "google", name, avatar, local: false }
    throw new AuthNotConfiguredError("google");
  }
}

class MindlogAuthProvider {
  id = "mindlog";
  label = "Continuer avec Mindlog.ID";
  constructor({ authorizeUrl, clientId } = {}) {
    this.authorizeUrl = authorizeUrl || null;
    this.clientId = clientId || null;
    this.configured = Boolean(this.authorizeUrl && this.clientId);
  }

  async signIn() {
    if (!this.configured) throw new AuthNotConfiguredError("mindlog");
    // TODO(prod) : flux OAuth/OpenID Mindlog.ID (redirect ou popup)
    //   → token → profil → { id, provider: "mindlog", name, avatar, local: false }
    throw new AuthNotConfiguredError("mindlog");
  }
}

export class AuthManager extends EventTarget {
  /**
   * @param {object} config
   * @param {{clientId?:string}}  [config.google]
   * @param {{authorizeUrl?:string, clientId?:string}} [config.mindlog]
   */
  constructor(config = {}) {
    super();
    this.providers = {
      google: new GoogleAuthProvider(config.google),
      mindlog: new MindlogAuthProvider(config.mindlog),
      local: new LocalAuthProvider(),
    };
    this.profile = null;
  }

  /** Liste ordonnée pour l'UI (bouton principal → secondaire). */
  list() {
    return [this.providers.google, this.providers.mindlog, this.providers.local];
  }

  /** Profil déjà connecté lors d'une session précédente (ou null). */
  restore() {
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      this.profile = raw ? JSON.parse(raw) : null;
    } catch {
      this.profile = null;
    }
    return this.profile;
  }

  /**
   * Connecte via le fournisseur demandé.
   * États émis : "state" (busy/idle) → "success" | "error".
   */
  async signIn(providerId) {
    const provider = this.providers[providerId];
    if (!provider) throw new Error(`Fournisseur inconnu: ${providerId}`);

    this.dispatchEvent(new CustomEvent("state", { detail: { busy: true, providerId } }));
    try {
      const profile = await provider.signIn();
      this.profile = profile;
      try {
        localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      } catch {
        /* stockage indispo (mode privé) : on garde en mémoire */
      }
      this.dispatchEvent(new CustomEvent("success", { detail: { profile } }));
      return profile;
    } catch (err) {
      this.dispatchEvent(new CustomEvent("error", { detail: { providerId, error: err } }));
      throw err;
    } finally {
      this.dispatchEvent(new CustomEvent("state", { detail: { busy: false, providerId } }));
    }
  }

  /** Déconnexion (conserve l'UUID local pour re-migration éventuelle). */
  signOut() {
    this.profile = null;
    try {
      localStorage.removeItem(PROFILE_KEY);
    } catch {
      /* noop */
    }
    this.dispatchEvent(new CustomEvent("signout"));
  }
}
