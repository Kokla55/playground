import * as THREE from 'three';

/**
 * Karosseriet bygges som en loft: en rekke tverrsnitt langs bilens lengde som
 * stitches sammen til én sammenhengende flate. Det gir myke overganger og
 * ekte hjulbuer — noe du ikke får av å stable bokser.
 *
 * Alle høyder er oppgitt over bakken og flyttes ned til tyngdepunktet når
 * geometrien bygges, slik at tallene er lette å lese.
 */

// z, halvbredde nede / ved skulder / oppe, høyde nede / ved skulder / oppe
const SECTIONS = [
  { z:  2.24, hwB: 0.52, hwS: 0.78, hwT: 0.62, yB: 0.32, yS: 0.56, yT: 0.52 },
  { z:  2.05, hwB: 0.68, hwS: 0.92, hwT: 0.76, yB: 0.24, yS: 0.62, yT: 0.60 },
  { z:  1.97, hwB: 0.80, hwS: 0.98, hwT: 0.84, yB: 0.20, yS: 0.68, yT: 0.64 },
  { z:  1.75, hwB: 0.98, hwS: 1.03, hwT: 0.88, yB: 0.60, yS: 0.78, yT: 0.72 },
  { z:  1.54, hwB: 1.00, hwS: 1.04, hwT: 0.90, yB: 0.73, yS: 0.80, yT: 0.76 },
  { z:  1.30, hwB: 0.98, hwS: 1.03, hwT: 0.90, yB: 0.60, yS: 0.80, yT: 0.80 },
  { z:  1.10, hwB: 0.82, hwS: 0.99, hwT: 0.92, yB: 0.20, yS: 0.82, yT: 0.86 },
  { z:  0.75, hwB: 0.80, hwS: 0.97, hwT: 0.86, yB: 0.14, yS: 0.86, yT: 1.26 },
  { z:  0.30, hwB: 0.80, hwS: 0.97, hwT: 0.70, yB: 0.13, yS: 0.88, yT: 1.35 },
  { z: -0.15, hwB: 0.80, hwS: 0.98, hwT: 0.68, yB: 0.13, yS: 0.88, yT: 1.36 },
  { z: -0.67, hwB: 0.82, hwS: 1.00, hwT: 0.80, yB: 0.20, yS: 0.88, yT: 1.25 },
  { z: -0.90, hwB: 0.99, hwS: 1.05, hwT: 0.88, yB: 0.60, yS: 0.86, yT: 1.13 },
  { z: -1.11, hwB: 1.01, hwS: 1.06, hwT: 0.92, yB: 0.73, yS: 0.85, yT: 1.07 },
  { z: -1.35, hwB: 0.99, hwS: 1.05, hwT: 0.94, yB: 0.60, yS: 0.84, yT: 1.03 },
  { z: -1.55, hwB: 0.84, hwS: 1.02, hwT: 0.94, yB: 0.22, yS: 0.82, yT: 0.99 },
  { z: -2.05, hwB: 0.74, hwS: 0.96, hwT: 0.90, yB: 0.24, yS: 0.76, yT: 0.93 },
  { z: -2.26, hwB: 0.60, hwS: 0.84, hwT: 0.78, yB: 0.34, yS: 0.68, yT: 0.87 },
];

const RING_LEN = 11;

// Ringen går fra bunnen opp høyre side, over taket og ned venstre side. Segment
// 2–3 og 6–7 er sideflatene over skulderlinjen; 4–5 er selve taket. Vinduer
// legges bare der de hører hjemme — sideruter langs kupeen, frontrute og
// bakrute der taket møter panseret og bakskjermen.
const SIDE_EDGES = new Set([2, 3, 6, 7]);
const ROOF_EDGES = new Set([4, 5]);
const CABIN_Z = [-0.70, 1.12];
const WINDSCREEN_Z = [0.78, 1.05];
const REAR_WINDOW_Z = [-0.62, -0.20];

function isGlass(edge, zMid) {
  const inCabin = zMid > CABIN_Z[0] && zMid < CABIN_Z[1];
  if (SIDE_EDGES.has(edge)) return inCabin;
  if (!ROOF_EDGES.has(edge)) return false;
  return (zMid > WINDSCREEN_Z[0] && zMid < WINDSCREEN_Z[1])
      || (zMid > REAR_WINDOW_Z[0] && zMid < REAR_WINDOW_Z[1]);
}

/** Ett tverrsnitt som en lukket ring av 11 punkter. */
function ring(s, yOffset) {
  const yB = s.yB - yOffset;
  const yS = s.yS - yOffset;
  const yT = s.yT - yOffset;

  const right = [
    [s.hwB * 0.55, yB],
    [s.hwB, yB + (yS - yB) * 0.35],
    [s.hwS, yS],
    [s.hwS * 0.88 + s.hwT * 0.12, yS + (yT - yS) * 0.5],
    [s.hwT, yT - (yT - yS) * 0.12],
    [s.hwT * 0.48, yT],
  ];

  const pts = right.slice();
  for (let i = right.length - 2; i >= 0; i--) pts.push([-right[i][0], right[i][1]]);
  return pts;
}

function buildBodyGeometry(rideHeight) {
  const positions = [];
  for (const s of SECTIONS) {
    for (const [x, y] of ring(s, rideHeight)) positions.push(x, y, s.z);
  }

  const paint = [];
  const glass = [];

  for (let i = 0; i < SECTIONS.length - 1; i++) {
    const a0 = i * RING_LEN;
    const b0 = (i + 1) * RING_LEN;
    const zMid = (SECTIONS[i].z + SECTIONS[i + 1].z) * 0.5;

    for (let k = 0; k < RING_LEN; k++) {
      const k2 = (k + 1) % RING_LEN;
      const a = a0 + k, b = a0 + k2, c = b0 + k2, d = b0 + k;
      const target = isGlass(k, zMid) ? glass : paint;
      target.push(a, d, c, a, c, b);
    }
  }

  // Lokk foran og bak.
  const capFront = positions.length / 3;
  positions.push(0, avgY(SECTIONS[0], rideHeight), SECTIONS[0].z);
  for (let k = 0; k < RING_LEN; k++) {
    paint.push(capFront, k, (k + 1) % RING_LEN);
  }

  const last = SECTIONS.length - 1;
  const capRear = positions.length / 3;
  positions.push(0, avgY(SECTIONS[last], rideHeight), SECTIONS[last].z);
  const base = last * RING_LEN;
  for (let k = 0; k < RING_LEN; k++) {
    paint.push(capRear, base + ((k + 1) % RING_LEN), base + k);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex([...paint, ...glass]);
  geo.addGroup(0, paint.length, 0);
  geo.addGroup(paint.length, glass.length, 1);
  geo.computeVertexNormals();
  return geo;
}

function avgY(s, yOffset) {
  return (s.yB + s.yT) * 0.5 - yOffset;
}

function buildWheel(cfg, materials) {
  const g = new THREE.Group();
  const r = cfg.wheelRadius;
  const w = cfg.wheelWidth;

  const tire = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, w, 32, 1),
    materials.tire,
  );
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  g.add(tire);

  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.68, r * 0.68, w * 1.02, 24, 1),
    materials.rim,
  );
  rim.rotation.z = Math.PI / 2;
  g.add(rim);

  // Eiker, slik at hjulet leser som roterende når det snurrer.
  const spokeGeo = new THREE.BoxGeometry(w * 0.55, r * 1.22, 0.035);
  for (let i = 0; i < 5; i++) {
    const spoke = new THREE.Mesh(spokeGeo, materials.rim);
    spoke.rotation.x = (i / 5) * Math.PI;
    g.add(spoke);
  }

  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.60, r * 0.60, w * 0.22, 20),
    materials.disc,
  );
  disc.rotation.z = Math.PI / 2;
  g.add(disc);

  const caliper = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.30, r * 0.42, 0.09),
    materials.caliper,
  );
  caliper.position.set(0, r * 0.42, -0.02);
  g.add(caliper);

  return g;
}

export class CarModel {
  constructor(cfg) {
    this.cfg = cfg;
    this.group = new THREE.Group();

    this.materials = {
      paint: new THREE.MeshPhysicalMaterial({
        color: 0x1d3557, metalness: 0.55, roughness: 0.26,
        clearcoat: 1, clearcoatRoughness: 0.06,
      }),
      // Ruta var nesten ugjennomsiktig da bilen var tom innvendig. Nå som det
      // finnes et interiør bak den, skal den oppføre seg som glass: lett tonet,
      // men til å se veien gjennom.
      glass: new THREE.MeshPhysicalMaterial({
        color: 0x24313d, metalness: 0.0, roughness: 0.04,
        transparent: true, opacity: 0.17, side: THREE.DoubleSide,
      }),
      tire: new THREE.MeshStandardMaterial({ color: 0x0e1013, roughness: 0.94, metalness: 0.02 }),
      rim: new THREE.MeshStandardMaterial({ color: 0xb6bec8, metalness: 0.90, roughness: 0.30 }),
      disc: new THREE.MeshStandardMaterial({ color: 0x4a4d52, metalness: 0.8, roughness: 0.45 }),
      caliper: new THREE.MeshStandardMaterial({ color: 0xb4341f, metalness: 0.4, roughness: 0.45 }),
      lightFront: new THREE.MeshStandardMaterial({
        color: 0xdfefff, emissive: 0xbcd8ff, emissiveIntensity: 1.6, roughness: 0.2,
      }),
      lightRear: new THREE.MeshStandardMaterial({
        color: 0x4a0c10, emissive: 0xff2233, emissiveIntensity: 1.1, roughness: 0.3,
      }),
      trim: new THREE.MeshStandardMaterial({ color: 0x14161a, metalness: 0.5, roughness: 0.55 }),
    };

    const body = new THREE.Mesh(
      buildBodyGeometry(cfg.ridePoint),
      [this.materials.paint, this.materials.glass],
    );
    body.castShadow = true;
    body.receiveShadow = true;
    this.group.add(body);
    this.bodyMesh = body;

    this._addLights(cfg);
    this._addDetails(cfg);

    this.wheelMeshes = cfg.wheels.map(() => {
      const wheel = buildWheel(cfg, this.materials);
      this.group.add(wheel);
      return wheel;
    });

    this._axisY = new THREE.Vector3(0, 1, 0);
    this._axisX = new THREE.Vector3(1, 0, 0);
    this._spinQ = new THREE.Quaternion();
  }

  _addLights(cfg) {
    const y = 0.50 - cfg.ridePoint;
    for (const x of [-0.60, 0.60]) {
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, 0.12), this.materials.lightFront);
      head.position.set(x, y, 2.00);
      this.group.add(head);
    }
    const tail = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.09, 0.06), this.materials.lightRear);
    tail.position.set(0, 0.86 - cfg.ridePoint, -2.24);
    this.group.add(tail);
  }

  _addDetails(cfg) {
    const o = cfg.ridePoint;

    // Sidespeil.
    for (const x of [-0.96, 0.96]) {
      const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.05), this.materials.trim);
      stalk.position.set(x, 0.92 - o, 1.02);
      this.group.add(stalk);
      const pod = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.11, 0.08), this.materials.trim);
      pod.position.set(x * 1.09, 0.95 - o, 1.03);
      this.group.add(pod);
    }

    // Bakvinge.
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.045, 0.30), this.materials.trim);
    wing.position.set(0, 1.06 - o, -1.94);
    wing.rotation.x = -0.10;
    this.group.add(wing);
    for (const x of [-0.60, 0.60]) {
      const mount = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.20, 0.10), this.materials.trim);
      mount.position.set(x, 0.97 - o, -1.94);
      this.group.add(mount);
    }

    // Diffusor og eksos.
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.16, 0.34), this.materials.trim);
    diffuser.position.set(0, 0.30 - o, -2.12);
    this.group.add(diffuser);
    for (const x of [-0.26, 0.26]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.18, 14), this.materials.rim);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(x, 0.44 - o, -2.26);
      this.group.add(pipe);
    }
  }

  /** Kopierer fysikkens tilstand over i scenegrafen. */
  sync(vehicle) {
    this.group.position.copy(vehicle.position);
    this.group.quaternion.copy(vehicle.quaternion);

    for (let i = 0; i < this.wheelMeshes.length; i++) {
      const w = vehicle.wheels[i];
      const mesh = this.wheelMeshes[i];
      mesh.position.set(w.cfg.pos.x, w.cfg.pos.y - w.suspensionLength, w.cfg.pos.z);
      mesh.quaternion.setFromAxisAngle(this._axisY, w.steerAngle);
      mesh.quaternion.multiply(this._spinQ.setFromAxisAngle(this._axisX, w.spin));
    }
  }
}
