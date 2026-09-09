import { EngineSound } from './EngineSound.js';
import { noiseBuffer, noiseSource, burst, glide, clamp } from './Synth.js';

/**
 * Hele lydbildet, drevet av det bilen faktisk gjør.
 *
 * Ingenting er spilt inn. Motoren følger turtallet, dekkene skriker når de
 * mister grepet, vinden vokser med farten, og underlaget høres forskjellig ut
 * på asfalt og gress. Det er samme telemetri som HUD-en leser, så lyden kan
 * aldri komme i utakt med det som skjer.
 *
 * Nettlesere krever et tastetrykk eller en berøring før lyd får spille. Derfor
 * bygges ingenting før `start()` kalles fra første input — før det er dette et
 * tomt skall som koster ingenting.
 */

// Hvor grovt hvert underlag låter, og hvor lyst.
const SURFACES = {
  asphalt: { rumble: 1.0, brightness: 1.0 },
  kerb:    { rumble: 3.4, brightness: 1.6 },
  grass:   { rumble: 2.6, brightness: 0.7 },
  gravel:  { rumble: 3.8, brightness: 1.3 },
};

export class Audio {
  constructor(cfg, { volume = 0.92 } = {}) {
    this.cfg = cfg;
    this.volume = volume;
    this.muted = false;
    this.ready = false;
    this.ctx = null;

    this._gear = 1;
    this._prevSpeed = 0;
    this._bumped = [false, false, false, false];
    this._skid = 0;
    this._unlocked = false;
  }

  /** Bygger lydkjeden. Må kalles fra en ekte brukerhandling. */
  start() {
    if (this.ready) return true;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;

    const ctx = new Ctx();
    this.ctx = ctx;

    // Kompressoren holder helheten samlet: uten den drukner dekkeskrik og
    // sammenstøt i motoren så snart turtallet er høyt.
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    this.master.connect(comp).connect(ctx.destination);

    this.noise = noiseBuffer(ctx, 2.5);

    this.engine = new EngineSound(ctx, this.master, this.noise, {
      cylinders: 6,
      idleRpm: this.cfg.engine.idleRpm,
      limiterRpm: this.cfg.engine.limiterRpm,
    });

    // Dekk: båndpasset støy. Frekvensen stiger når de sklir mer.
    this.tyre = noiseSource(ctx, this.noise, { playbackRate: 1.1 });
    this.tyreBand = ctx.createBiquadFilter();
    this.tyreBand.type = 'bandpass';
    this.tyreBand.frequency.value = 1200;
    this.tyreBand.Q.value = 5.5;
    this.tyreGain = ctx.createGain();
    this.tyreGain.gain.value = 0;
    this.tyre.connect(this.tyreBand).connect(this.tyreGain).connect(this.master);
    this.tyre.start();

    // Vind: lavpasset støy som åpner seg med farten.
    this.wind = noiseSource(ctx, this.noise, { playbackRate: 0.7 });
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 400;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    this.wind.start();

    // Veibane: den lave rumlingen fra underlaget.
    this.road = noiseSource(ctx, this.noise, { playbackRate: 0.35 });
    this.roadFilter = ctx.createBiquadFilter();
    this.roadFilter.type = 'lowpass';
    this.roadFilter.frequency.value = 220;
    this.roadGain = ctx.createGain();
    this.roadGain.gain.value = 0;
    this.road.connect(this.roadFilter).connect(this.roadGain).connect(this.master);
    this.road.start();

    this.ready = true;
    return true;
  }

  /** Kjører lyden akkurat nå? Det er dette som avgjør om du hører noe. */
  get running() {
    return this.ready && this.ctx.state === 'running';
  }

  /**
   * Prøver å få lyden i gang. Må kalles fra en ekte brukerhandling.
   *
   * Ett forsøk holder ikke. På mobil kan konteksten bli opprettet i pauset
   * tilstand, og resume() svarer først etterpå — slår det feil, må neste
   * berøring få prøve på nytt. Derfor kalles denne fra hver interaksjon helt
   * til `running` er sann, i stedet for bare fra den første.
   */
  async unlock() {
    if (!this.start()) return false;
    if (this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch { /* neste berøring får prøve */ }
    }
    // En stum lyd gjennom et <audio>-element bytter lydøkten på iOS fra
    // "ambient" til "playback". Uten det tier Web Audio når ringelyd-bryteren
    // står på lydløs. Gjør ingen skade andre steder.
    if (!this._unlocked && this.running) {
      this._unlocked = true;
      this._silentTap();
    }
    return this.running;
  }

  _silentTap() {
    try {
      const el = document.createElement('audio');
      el.setAttribute('playsinline', '');
      el.muted = false;
      el.volume = 0.001;
      // 0,05 s stillhet som WAV.
      el.src = 'data:audio/wav;base64,UklGRjIAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQ4AAAAAAAAAAAAAAAAAAAAAAA==';
      el.play().catch(() => { /* ikke kritisk */ });
    } catch { /* ikke kritisk */ }
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.ready) glide(this.master.gain, muted ? 0 : this.volume, this.ctx, 0.05);
    return this.muted;
  }

  toggleMute() { return this.setMuted(!this.muted); }

  /**
   * @param {number} dt sekunder siden forrige bilde
   * @param {object} vehicle kjøretøyet, for telemetri og fjæringstilstand
   */
  update(dt, vehicle) {
    if (!this.ready || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const t = vehicle.telemetry;

    this.engine.update(dt, t, 1);

    const fart = t.speed;
    const flate = SURFACES[t.surface] ?? SURFACES.asphalt;

    // --- dekk ---
    // Skriket følger metningen, men bare når hjulene faktisk ruller fort nok
    // til at det ville laget lyd. Det holdes litt igjen på vei ned, ellers
    // flakker det når grepet kommer og går.
    const slip = Math.max(t.frontSlip ?? 0, t.rearSlip ?? 0);
    const fartsdel = clamp((fart - 2.5) / 12, 0, 1);
    const mål = clamp((slip - 0.55) / 0.45, 0, 1) * fartsdel;
    this._skid += (mål - this._skid) * clamp(dt * (mål > this._skid ? 14 : 5), 0, 1);
    glide(this.tyreGain.gain, this._skid * 0.30 * flate.brightness, ctx, 0.03);
    glide(this.tyreBand.frequency, 900 + this._skid * 1500 + fart * 8, ctx, 0.04);

    // --- vind ---
    // Vindstøy vokser med kvadratet av farten, som luftmotstanden selv.
    const v = fart / 80;
    glide(this.windGain.gain, clamp(v * v, 0, 1) * 0.30, ctx, 0.08);
    glide(this.windFilter.frequency, 300 + fart * 26, ctx, 0.08);

    // --- underlag ---
    const påBakken = (t.grounded ?? 4) > 0 ? 1 : 0;
    glide(this.roadGain.gain,
      clamp(fart / 60, 0, 1) * 0.16 * flate.rumble * påBakken, ctx, 0.05);
    glide(this.roadFilter.frequency, 140 + fart * 5 * flate.brightness, ctx, 0.06);

    this._transients(dt, vehicle, t, fart);
    this._prevSpeed = fart;
  }

  /** Enkelthendelser: girskift, fjæringen i bunn, sammenstøt. */
  _transients(dt, vehicle, t, fart) {
    const ctx = this.ctx;

    if (t.gear !== this._gear) {
      // Et kort, tørt klikk fra girkassen.
      burst(ctx, this.master, this.noise,
        { gain: 0.18, attack: 0.001, decay: 0.05, frequency: 2600, q: 2.4 });
      this._gear = t.gear;
    }

    // Gummistoppen som tar imot er et dumpt slag, ikke et smell.
    vehicle.wheels.forEach((w, i) => {
      const nede = w.overTravel > 0.004;
      if (nede && !this._bumped[i]) {
        burst(ctx, this.master, this.noise, {
          gain: clamp(w.overTravel * 12, 0.05, 0.5),
          attack: 0.003, decay: 0.16, frequency: 90, q: 0.9, type: 'lowpass',
        });
      }
      this._bumped[i] = nede;
    });

    // Et brått fartstap som ikke kommer av bremsene er en kollisjon.
    const tap = this._prevSpeed - fart;
    if (tap > 2.2 && (t.brake ?? 0) < 0.5) {
      burst(ctx, this.master, this.noise, {
        gain: clamp(tap / 14, 0.1, 0.85),
        attack: 0.002, decay: 0.28, frequency: 260 + tap * 20, q: 0.8,
      });
    }
  }

  dispose() {
    if (!this.ready) return;
    this.engine.dispose();
    for (const s of [this.tyre, this.wind, this.road]) {
      try { s.stop(); } catch { /* allerede stoppet */ }
    }
    this.ctx.close();
    this.ready = false;
  }
}
