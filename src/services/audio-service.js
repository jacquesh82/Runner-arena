/* ======================================================================
 * AudioManager — musique + SFX de la page d'intro.
 *
 * Pas d'assets audio pour l'instant : la boucle est SYNTHÉTISÉE via WebAudio
 * (nappe douce type marimba/pad + LFO), ce qui évite tout fichier et démontre
 * la logique portable (déblocage au geste, mute persistant, fondu d'entrée).
 *
 * ⚠️ WebGL : l'autoplay est bloqué → `unlock()` DOIT être appelé depuis un
 * geste utilisateur (tap). Au passage Unity, remplacer le moteur WebAudio par
 * AudioSource/AudioMixer ; l'API publique (unlock/toggleMute/sfx) reste la même.
 * ==================================================================== */

const MUTE_KEY = "arena.muted";
const MUSIC_VOL = 0.5; // volume cible (bas au démarrage, cf. spec)

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.voices = [];
    this.started = false;
    this.muted = localStorage.getItem(MUTE_KEY) === "1";
  }

  get isMuted() {
    return this.muted;
  }

  /** À appeler depuis un geste utilisateur. Idempotent. */
  async unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return; // pas de WebAudio : on reste silencieux, sans casser l'UI

    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.0001; // départ silencieux → fondu d'entrée
    this.master.connect(this.ctx.destination);

    this._buildMusic();
    this.started = true;

    if (!this.muted) this._fadeMaster(MUSIC_VOL, 1.6);
  }

  /* ---- Nappe douce en boucle (continue, donc pas de raccord audible) --- */
  _buildMusic() {
    const music = this.ctx.createGain();
    music.gain.value = 1;
    music.connect(this.master);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 850; // feutré, chaleureux
    filter.connect(music);

    // Accord de La majeur, doux (A3 / C#4 / E4)
    const chord = [220.0, 277.18, 329.63];
    this.voices = chord.map((freq, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;

      const gain = this.ctx.createGain();
      gain.gain.value = 0.11;

      // léger mouvement (vibrato très lent) pour un rendu « vivant »
      const lfo = this.ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 0.05 + i * 0.017;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 2.2;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);

      osc.connect(gain);
      gain.connect(filter);
      osc.start();
      lfo.start();
      return { osc, lfo };
    });
  }

  /** Effet ponctuel : "tap" (interaction) ou "success" (login réussi). */
  sfx(type) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "triangle";
    osc.connect(gain);
    gain.connect(this.master);

    const dur = type === "success" ? 0.55 : 0.2;
    if (type === "success") {
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.exponentialRampToValueAtTime(1046.5, now + 0.18); // C6
    } else {
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
    }
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  /** Bascule + persiste la préférence. Renvoie l'état muet. */
  toggleMute() {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? "1" : "0");
    } catch {
      /* noop */
    }
    if (this.started) this._fadeMaster(this.muted ? 0.0001 : MUSIC_VOL, 0.4);
    return this.muted;
  }

  _fadeMaster(to, dur) {
    if (!this.master) return;
    const now = this.ctx.currentTime;
    const g = this.master.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(0.0001, g.value), now);
    g.linearRampToValueAtTime(Math.max(0.0001, to), now + dur);
  }

  /** Coupe et libère (transition vers le jeu). */
  dispose() {
    this._fadeMaster(0.0001, 0.4);
    setTimeout(() => {
      try {
        this.voices.forEach(({ osc, lfo }) => {
          osc.stop();
          lfo.stop();
        });
        this.ctx?.close();
      } catch {
        /* noop */
      }
      this.ctx = null;
      this.voices = [];
    }, 450);
  }
}
