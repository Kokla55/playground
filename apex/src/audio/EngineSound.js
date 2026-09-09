import { noiseSource, harmonicWave, glide, clamp } from './Synth.js';

/**
 * Motorlyd bygget fra turtallet.
 *
 * En firetakts V6 tenner tre ganger per veivaksomdreining, så grunntonen er
 * turtall/60 × 3 — 45 Hz på tomgang, 405 Hz mot sperren. Klangen er tre lag:
 *
 *   grunntone  overtonene som gir motoren kropp og dybde
 *   halvorden  halve tennfrekvensen, som gir V6-en den ujevne "lumpen"
 *   sug        filtrert støy: innsug og eksos, det som gjør at det puster
 *
 * Belastningen former resten. Med gass åpnes filteret og raspen kommer fram;
 * slipper du, blir lyden dus og faller tilbake — motorbrems, ikke stillhet.
 */

// Overtonene til grunntonen. Tredje og sjette er løftet: det er dem øret
// hører som "motor" framfor "summetone".
const BODY = [1.0, 0.62, 0.78, 0.34, 0.22, 0.40, 0.14, 0.10, 0.07, 0.05];
const RASP = [0.5, 0.9, 0.7, 0.85, 0.6, 0.55, 0.45, 0.4, 0.3, 0.26, 0.2, 0.16];

export class EngineSound {
  constructor(ctx, destination, noise, {
    cylinders = 6, idleRpm = 900, limiterRpm = 8100,
  } = {}) {
    this.ctx = ctx;
    this.idleRpm = idleRpm;
    this.limiterRpm = limiterRpm;
    // Firetakt: hver sylinder tenner annenhver omdreining.
    this.firingPerRev = cylinders / 2;
    this.firingHz = 0;

    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(destination);

    // Filteret er "gassen" i klangen: lukket på tomgang, åpent på full gass.
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 500;
    this.tone.Q.value = 0.9;
    this.tone.connect(this.out);

    // Litt metning gir motoren snerr uten å bli støy.
    this.drive = ctx.createWaveShaper();
    this.drive.curve = saturation(2.4);
    this.drive.oversample = '2x';
    this.drive.connect(this.tone);

    this.body = ctx.createOscillator();
    this.body.setPeriodicWave(harmonicWave(ctx, BODY));
    this.bodyGain = ctx.createGain();
    this.bodyGain.gain.value = 0.55;
    this.body.connect(this.bodyGain).connect(this.drive);

    this.half = ctx.createOscillator();
    this.half.setPeriodicWave(harmonicWave(ctx, [1.0, 0.3, 0.15]));
    this.halfGain = ctx.createGain();
    this.halfGain.gain.value = 0.22;
    this.half.connect(this.halfGain).connect(this.drive);

    this.rasp = ctx.createOscillator();
    this.rasp.setPeriodicWave(harmonicWave(ctx, RASP));
    this.raspGain = ctx.createGain();
    this.raspGain.gain.value = 0;
    this.rasp.connect(this.raspGain).connect(this.drive);

    // Innsug og eksos: støy gjennom et båndpass som følger turtallet.
    this.intake = noiseSource(ctx, noise);
    this.intakeBand = ctx.createBiquadFilter();
    this.intakeBand.type = 'bandpass';
    this.intakeBand.Q.value = 0.7;
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    this.intake.connect(this.intakeBand).connect(this.intakeGain).connect(this.tone);

    // Turboen plystrer når den lader.
    this.turbo = ctx.createOscillator();
    this.turbo.type = 'sine';
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turbo.connect(this.turboGain).connect(this.out);

    this._boost = 0;
    for (const o of [this.body, this.half, this.rasp, this.turbo]) o.start();
    this.intake.start();
  }

  /**
   * @param {object} t telemetri: rpm, throttle, gear, shifting
   * @param {number} volume 0–1, hvor mye motoren skal høres i det hele tatt
   */
  update(dt, t, volume = 1) {
    const ctx = this.ctx;
    const rpm = clamp(t.rpm ?? this.idleRpm, this.idleRpm * 0.6, this.limiterRpm * 1.05);
    const rev = rpm / 60;
    const firing = rev * this.firingPerRev;
    this.firingHz = firing;

    const gass = clamp(t.throttle ?? 0, 0, 1);
    // Turboen bygger og faller langsommere enn gassfoten.
    const målBoost = gass * clamp((rpm - 2200) / 3200, 0, 1);
    this._boost += (målBoost - this._boost) * clamp(dt * (målBoost > this._boost ? 2.2 : 4.5), 0, 1);

    // Hvor hardt motoren jobber: turtall og gass til sammen.
    const turtallsdel = clamp((rpm - this.idleRpm) / (this.limiterRpm - this.idleRpm), 0, 1);
    const last = clamp(gass * 0.72 + turtallsdel * 0.28, 0, 1);

    glide(this.body.frequency, firing, ctx, 0.02);
    glide(this.half.frequency, firing * 0.5, ctx, 0.02);
    glide(this.rasp.frequency, firing, ctx, 0.02);

    // Med gass åpner filteret seg og raspen slipper til.
    glide(this.tone.frequency, 380 + firing * (2.1 + gass * 5.4) + last * 900, ctx, 0.05);
    glide(this.raspGain.gain, 0.05 + gass * 0.42, ctx, 0.06);
    glide(this.bodyGain.gain, 0.62 - gass * 0.10, ctx, 0.06);

    glide(this.intakeBand.frequency, 260 + firing * 3.2, ctx, 0.05);
    glide(this.intakeGain.gain, 0.02 + gass * 0.10 + turtallsdel * 0.05, ctx, 0.06);

    glide(this.turbo.frequency, 2400 + this._boost * 4200, ctx, 0.08);
    glide(this.turboGain.gain, this._boost * this._boost * 0.035, ctx, 0.08);

    // Under girskift kuttes momentet, og lyden faller sammen et øyeblikk.
    const kutt = t.shifting ? 0.42 : 1;
    const nivå = (0.16 + last * 0.5) * kutt * volume;
    glide(this.out.gain, nivå, ctx, t.shifting ? 0.01 : 0.05);
  }

  dispose() {
    for (const o of [this.body, this.half, this.rasp, this.turbo, this.intake]) {
      try { o.stop(); } catch { /* allerede stoppet */ }
    }
    this.out.disconnect();
  }
}

/** Myk metning — gir snerr uten å klippe. */
function saturation(amount) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}
