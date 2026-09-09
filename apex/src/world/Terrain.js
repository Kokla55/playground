import * as THREE from 'three';

/**
 * Landskapet rundt banen.
 *
 * Terrenget er rent visuelt — rekkverket lukker banen inne, så bilen når aldri
 * hit ut, og da trenger det heller ingen fysikk. Til gjengjeld kan det være
 * stort og detaljert uten å koste noe i simuleringen.
 *
 * Høyden bindes til banen: like utenfor asfalten følger terrenget veibanen
 * nøyaktig, og først lenger ute får det lov til å bølge og reise seg i fjell.
 * Uten den bindingen ville det oppstå kanter og hull langs hele banekanten.
 */

const FLAT_MARGIN = 26;    // følger banen helt ut hit
const RELIEF_START = 60;   // begynner å bølge her
const MOUNTAIN_START = 340;

/** Deterministisk verdistøy — ingen avhengigheter, samme landskap hver gang. */
function hash(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x, y, octaves = 4) {
  let sum = 0, amp = 1, norm = 0, freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.07;
  }
  return sum / norm;
}

const smoothstep = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Rutenett som slår opp nærmeste punkt på banen raskt. */
class TrackIndex {
  constructor(path, cell = 18) {
    this.path = path;
    this.cell = cell;
    this.stride = 4;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const f of path.frames) {
      minX = Math.min(minX, f.position.x); maxX = Math.max(maxX, f.position.x);
      minZ = Math.min(minZ, f.position.z); maxZ = Math.max(maxZ, f.position.z);
    }
    const pad = 120;
    this.minX = minX - pad; this.minZ = minZ - pad;
    this.cols = Math.ceil((maxX - minX + pad * 2) / cell);
    this.rows = Math.ceil((maxZ - minZ + pad * 2) / cell);

    // Hver celle husker den nærmeste prøven; oppslag forfines mot naboene.
    this.nearest = new Int32Array(this.cols * this.rows).fill(-1);
    for (let r = 0; r < this.rows; r++) {
      const z = this.minZ + (r + 0.5) * cell;
      for (let c = 0; c < this.cols; c++) {
        const x = this.minX + (c + 0.5) * cell;
        let best = -1, bestD = Infinity;
        for (let i = 0; i < path.samples; i += this.stride) {
          const p = path.frames[i].position;
          const d = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (d < bestD) { bestD = d; best = i; }
        }
        this.nearest[r * this.cols + c] = best;
      }
    }
  }

  query(x, z) {
    const c = THREE.MathUtils.clamp(Math.floor((x - this.minX) / this.cell), 0, this.cols - 1);
    const r = THREE.MathUtils.clamp(Math.floor((z - this.minZ) / this.cell), 0, this.rows - 1);
    const seed = this.nearest[r * this.cols + c];

    let best = seed, bestD = Infinity;
    const n = this.path.samples;
    for (let k = -this.stride * 3; k <= this.stride * 3; k++) {
      const i = ((seed + k) % n + n) % n;
      const p = this.path.frames[i].position;
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    const f = this.path.frames[best];
    return { distance: Math.sqrt(bestD), roadY: f.position.y, index: best, halfWidth: f.halfWidth };
  }
}

export class Terrain {
  constructor(path, { extent = 1000, resolution = 210 } = {}) {
    this.path = path;
    this.index = new TrackIndex(path);

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const f of path.frames) {
      minX = Math.min(minX, f.position.x); maxX = Math.max(maxX, f.position.x);
      minZ = Math.min(minZ, f.position.z); maxZ = Math.max(maxZ, f.position.z);
    }
    this.bounds = {
      minX: minX - extent, maxX: maxX + extent,
      minZ: minZ - extent, maxZ: maxZ + extent,
    };
    this.resolution = resolution;

    this.group = new THREE.Group();
    this.group.add(this._buildMesh());
    this._scatter();
  }

  heightAt(x, z) {
    const near = this.index.query(x, z);
    const d = near.distance - near.halfWidth;

    // Rett utenfor asfalten er terrenget veibanen, senket noen centimeter.
    const base = near.roadY - 0.30;
    if (d < FLAT_MARGIN) return base;

    const rolling = (fbm(x / 260, z / 260, 4) - 0.5) * 34;
    const detail = (fbm(x / 62, z / 62, 3) - 0.5) * 3.6;
    const relief = smoothstep(FLAT_MARGIN, RELIEF_START, d);

    // Fjellene reiser seg først langt utenfor banen, og vokser med avstanden.
    const alpine = smoothstep(MOUNTAIN_START, MOUNTAIN_START + 640, d);
    const ridge = Math.abs(fbm(x / 700 + 11.3, z / 700 - 4.7, 3) - 0.5) * 2;
    const mountains = alpine * (ridge ** 1.6) * 320;

    return base + relief * (rolling + detail) + mountains;
  }

  _buildMesh() {
    const { minX, maxX, minZ, maxZ } = this.bounds;
    const n = this.resolution;
    const geo = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ, n, n);
    geo.rotateX(-Math.PI / 2);
    geo.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2);

    const pos = geo.attributes.position;
    const colours = new Float32Array(pos.count * 3);

    const lowland = new THREE.Color(0x4c6435);
    const upland = new THREE.Color(0x6a6f4a);
    const rock = new THREE.Color(0x77726c);
    const snow = new THREE.Color(0xe8ecef);
    const c = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = this.heightAt(x, z);
      pos.setY(i, y);

      // Fargen følger høyden: gress, lyng, fjell og til slutt snø på toppene.
      if (y < 12) c.copy(lowland).lerp(upland, smoothstep(0, 12, y));
      else if (y < 90) c.copy(upland).lerp(rock, smoothstep(12, 90, y));
      else c.copy(rock).lerp(snow, smoothstep(95, 190, y));

      const variation = 0.9 + fbm(x / 40, z / 40, 2) * 0.2;
      colours[i * 3] = c.r * variation;
      colours[i * 3 + 1] = c.g * variation;
      colours[i * 3 + 2] = c.b * variation;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1,
      polygonOffset: true, polygonOffsetFactor: 6, polygonOffsetUnits: 6,
    }));
    mesh.receiveShadow = true;
    this.mesh = mesh;
    return mesh;
  }

  /** Trær og steiner, plassert utenfor rekkverket og unna de bratteste sidene. */
  _scatter() {
    const { minX, maxX, minZ, maxZ } = this.bounds;
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3d2f24, roughness: 0.95 });
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x2f4a28, roughness: 0.92 });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6d6a66, roughness: 0.95 });

    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 2.4, 6);
    trunkGeo.translate(0, 1.2, 0);
    const foliageGeo = new THREE.ConeGeometry(2.1, 7.5, 8);
    foliageGeo.translate(0, 5.6, 0);
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);

    const TREES = 2200;
    const ROCKS = 520;
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, TREES);
    const crowns = new THREE.InstancedMesh(foliageGeo, foliageMat, TREES);
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, ROCKS);
    trunks.castShadow = crowns.castShadow = rocks.castShadow = true;
    rocks.receiveShadow = true;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const pos = new THREE.Vector3();

    let placed = 0, rocked = 0, tries = 0;
    while ((placed < TREES || rocked < ROCKS) && tries < 90000) {
      tries++;
      const x = minX + Math.random() * (maxX - minX);
      const z = minZ + Math.random() * (maxZ - minZ);
      const near = this.index.query(x, z);
      const d = near.distance - near.halfWidth;
      if (d < 22) continue;                        // ikke inne på banen eller skulderen

      const y = this.heightAt(x, z);
      if (y > 150) continue;                       // ikke over tregrensa

      // Unngå de bratteste sidene, der trær ville stå og henge i lufta.
      const slope = Math.abs(this.heightAt(x + 3, z) - y) + Math.abs(this.heightAt(x, z + 3) - y);
      if (slope > 2.6) continue;

      if (placed < TREES && (d > 34 || Math.random() < 0.3)) {
        const h = 0.7 + Math.random() * 0.7;
        pos.set(x, y, z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
        scale.set(h, h * (0.85 + Math.random() * 0.4), h);
        m.compose(pos, q, scale);
        trunks.setMatrixAt(placed, m);
        crowns.setMatrixAt(placed, m);
        placed++;
      } else if (rocked < ROCKS) {
        const s = 0.6 + Math.random() * 2.4;
        pos.set(x, y - s * 0.25, z);
        q.setFromEuler(new THREE.Euler(Math.random(), Math.random() * 6.28, Math.random()));
        scale.set(s, s * (0.6 + Math.random() * 0.5), s * (0.8 + Math.random() * 0.5));
        m.compose(pos, q, scale);
        rocks.setMatrixAt(rocked, m);
        rocked++;
      }
    }

    trunks.count = placed;
    crowns.count = placed;
    rocks.count = rocked;
    this.group.add(trunks, crowns, rocks);
    this.counts = { trees: placed, rocks: rocked };
  }
}
