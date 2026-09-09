/**
 * Byggeklosser for lyden.
 *
 * Spillet er én selvstendig fil, så det finnes ingen lydfiler å spille av.
 * Alt lages av oscillatorer og støy i Web Audio. Det er faktisk en fordel for
 * en motor: en innspilling er låst til de turtallene den ble tatt opp ved, mens
 * en syntetisert motor følger turtallet nøyaktig — også gjennom et girskift.
 */

/** Hvitt støy i en sløyfe. Ett buffer deles av alle som trenger støy. */
export function noiseBuffer(ctx, seconds = 2) {
  const frames = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // Enkel, deterministisk generator, så lyden blir lik hver gang.
  let s = 0x9e3779b9;
  for (let i = 0; i < frames; i++) {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    data[i] = (((x ^ (x >>> 14)) >>> 0) / 2147483648) - 1;
  }
  return buffer;
}

/** Støykilde som går i sløyfe for alltid. */
export function noiseSource(ctx, buffer, { playbackRate = 1 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.playbackRate.value = playbackRate;
  return src;
}

/**
 * Periodisk bølgeform fra en liste med harmoniske styrker.
 *
 * En motor er ikke en sinus og ikke en ren sagtann — den er en bestemt miks av
 * overtoner. Å legge dem i én bølgeform i stedet for én oscillator per overtone
 * gir samme klang for en brøkdel av arbeidet.
 */
export function harmonicWave(ctx, amplitudes) {
  const n = amplitudes.length + 1;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let i = 0; i < amplitudes.length; i++) imag[i + 1] = amplitudes[i];
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

/** Kort, brå lyd — et slag, et klikk, en smell. */
export function burst(ctx, destination, buffer, {
  gain = 0.5, attack = 0.002, decay = 0.12, frequency = 900, q = 1.2, type = 'bandpass',
} = {}) {
  const now = ctx.currentTime;
  const src = noiseSource(ctx, buffer, { playbackRate: 0.8 + Math.random() * 0.5 });
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, now);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);

  src.connect(filter).connect(amp).connect(destination);
  src.start(now);
  src.stop(now + attack + decay + 0.02);
  src.onended = () => { try { amp.disconnect(); filter.disconnect(); } catch { /* alt er alt koblet fra */ } };
}

/** Glidende parameterendring uten klikk. */
export const glide = (param, value, ctx, time = 0.03) => {
  param.setTargetAtTime(value, ctx.currentTime, time);
};

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
