import * as THREE from 'three';

/**
 * Materialkart som genereres i koden.
 *
 * Spillet skal være én selvstendig fil, så det finnes ingen bildefiler å laste.
 * Alt her tegnes med støy på et lerret ved oppstart. Det gir asfalt som har
 * korn, gress som ikke er en flat grønn flate, og betong med slitasje.
 *
 * To ting avgjør at det går fort nok til å ligge i oppstarten: støyen regnes ut
 * én gang til et felt som gjenbrukes av farge-, ruhets- og normalkartet, og
 * gitteret wrapper rundt tekstursiden slik at flisene møtes uten skjøt.
 */

/** Liten, rask og deterministisk tilfeldighetsgenerator. */
function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const mix = (a, b, t) => a + (b - a) * t;

/** Verdistøy på et gitter som gjentar seg etter `cells` celler. */
function lattice(cells, seed) {
  const rand = rng(seed);
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  return (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = fade(x - x0), fy = fade(y - y0);
    const xa = ((x0 % cells) + cells) % cells;
    const ya = ((y0 % cells) + cells) % cells;
    const xb = (xa + 1) % cells;
    const yb = (ya + 1) % cells;
    return mix(
      mix(g[ya * cells + xa], g[ya * cells + xb], fx),
      mix(g[yb * cells + xa], g[yb * cells + xb], fx),
      fy,
    );
  };
}

/**
 * Flere lag støy lagt oppå hverandre, samplet én gang til et felt på size×size.
 * Feltet er det alle kartene leser fra etterpå.
 */
function field(size, octaves, baseCells, seed, gain = 0.5) {
  const layers = [];
  let cells = baseCells;
  let amp = 1;
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    layers.push({ noise: lattice(cells, seed + i * 977), cells, amp });
    total += amp;
    amp *= gain;
    cells *= 2;
  }

  const data = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      let sum = 0;
      for (const l of layers) sum += l.noise(u * l.cells, v * l.cells) * l.amp;
      data[y * size + x] = sum / total;
    }
  }
  data.size = size;
  return data;
}

/** Oppslag i et felt med wrapping, slik at kantene møter hverandre. */
const at = (f, x, y) => {
  const s = f.size;
  return f[(((y % s) + s) % s) * s + (((x % s) + s) % s)];
};

/** Fyller et lerret pikselvis. `fn` returnerer [r, g, b] i 0–255. */
function paint(size, fn) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const rgb = fn(x, y);
      const i = (y * size + x) * 4;
      d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Normalkart fra et høydefelt. Hellingen regnes ut av forskjellen mellom
 * nabopiksler, og siden feltet wrapper blir også normalkartet sømløst.
 */
function normalFrom(height, strength) {
  return paint(height.size, (x, y) => {
    const dx = (at(height, x + 1, y) - at(height, x - 1, y)) * strength;
    const dy = (at(height, x, y + 1) - at(height, x, y - 1)) * strength;
    const len = Math.hypot(dx, dy, 1);
    return [
      ((-dx / len) * 0.5 + 0.5) * 255,
      ((-dy / len) * 0.5 + 0.5) * 255,
      ((1 / len) * 0.5 + 0.5) * 255,
    ];
  });
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const grey = (v) => { const b = clamp255(v * 255); return [b, b, b]; };

function texture(source, { srgb = false, repeat = [1, 1], anisotropy = 8 } = {}) {
  const t = new THREE.CanvasTexture(source);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = anisotropy;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

/** Samme gjentakelse på alle kartene i et sett — ellers glir de fra hverandre. */
function set(maps, repeat) {
  for (const t of Object.values(maps)) t.repeat.set(repeat[0], repeat[1]);
  return maps;
}

/**
 * Asfalt: fint tilslag som korn, større flater med ulik slitasje, og en
 * ruhetsvariasjon som gjør at sollyset ikke treffer hele veien likt.
 *
 * Grunntonen ligger rundt 58 av 255. Lavere enn det ser riktig ut på en
 * dataskjerm i et mørkt rom, men veien er den største flaten i bildet — blir
 * den for mørk, ser hele spillet dunkelt ut på en telefon i dagslys.
 */
export function asphaltMaps({ size = 512, anisotropy = 8, repeat = [5, 3.2] } = {}) {
  const grain = field(size, 4, 48, 12071, 0.62);
  const wear = field(size, 3, 5, 7717, 0.55);
  const speck = rng(4242);

  const map = paint(size, (x, y) => {
    const i = y * size + x;
    let l = 58 + (grain[i] - 0.5) * 34 + (wear[i] - 0.5) * 16;
    if (speck() > 0.988) l += 21;                 // enkeltsteiner som fanger lyset
    l = Math.max(28, Math.min(108, l));
    return [l * 0.98, l, l * 1.05];
  });

  // 0.78–0.99: sliten asfalt er glattere enn ny.
  const rough = paint(size, (x, y) => {
    const i = y * size + x;
    return grey(0.99 - wear[i] * 0.10 - (grain[i] - 0.5) * 0.05);
  });

  return set({
    map: texture(map, { srgb: true, anisotropy }),
    roughnessMap: texture(rough, { anisotropy }),
    normalMap: texture(normalFrom(grain, 2.6), { anisotropy }),
  }, repeat);
}

/** Gress: fargevariasjon og en grov, retningsløs struktur. */
export function grassMaps({ size = 256, anisotropy = 4, repeat = [4, 3] } = {}) {
  const clump = field(size, 4, 20, 3391, 0.58);
  const patch = field(size, 2, 4, 8123, 0.5);

  const map = paint(size, (x, y) => {
    const i = y * size + x;
    const l = 0.84 + (clump[i] - 0.5) * 0.5 + (patch[i] - 0.5) * 0.34;
    return [clamp255(74 * l), clamp255(104 * l), clamp255(52 * l)];
  });

  return set({
    map: texture(map, { srgb: true, anisotropy }),
    normalMap: texture(normalFrom(clump, 1.5), { anisotropy }),
  }, repeat);
}

/** Betong: jevn grunntone med utvasking, søl og en svak porestruktur. */
export function concreteMaps({ size = 256, anisotropy = 4, repeat = [2, 4] } = {}) {
  const pore = field(size, 4, 32, 5519, 0.6);
  const stain = field(size, 3, 6, 9091, 0.5);

  const map = paint(size, (x, y) => {
    const i = y * size + x;
    const l = Math.max(74, Math.min(158, 142 + (pore[i] - 0.5) * 24 - stain[i] * 46));
    return [l, l * 1.005, l * 1.02];
  });

  const rough = paint(size, (x, y) => {
    const i = y * size + x;
    return grey(0.62 + stain[i] * 0.3 + (pore[i] - 0.5) * 0.08);
  });

  return set({
    map: texture(map, { srgb: true, anisotropy }),
    roughnessMap: texture(rough, { anisotropy }),
    normalMap: texture(normalFrom(pore, 1.1), { anisotropy }),
  }, repeat);
}

/** Curbstein: malingen er slitt, og betongen under er grov. */
export function kerbMaps({ size = 128, anisotropy = 4, repeat = [2, 1] } = {}) {
  const grit = field(size, 3, 24, 6607, 0.6);
  const rough = paint(size, (x, y) => grey(0.42 + grit[y * size + x] * 0.38));
  return set({
    roughnessMap: texture(rough, { anisotropy }),
    normalMap: texture(normalFrom(grit, 1.4), { anisotropy }),
  }, repeat);
}

/** Sjø: to lag krusninger som skal skyves i hver sin retning. */
export function waterMaps({ size = 256, anisotropy = 4, repeat = [26, 26] } = {}) {
  const ripple = field(size, 4, 14, 2251, 0.55);
  return set({ normalMap: texture(normalFrom(ripple, 0.9), { anisotropy }) }, repeat);
}
