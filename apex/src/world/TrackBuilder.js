import * as THREE from 'three';
import { asphaltMaps, grassMaps, concreteMaps, kerbMaps } from '../render/Textures.js';

/**
 * Bygger asfalt, curbs, skulder og rekkverk ut fra senterlinjen.
 *
 * Alt genereres som sammenhengende bånd langs banen. Kollisjonsgeometrien er de
 * samme trekantene som tegnes, slik at det du ser og det bilen kjenner aldri
 * kan komme i utakt.
 *
 * Rekkverket lukker banen inne, og derfor trenger ikke terrenget utenfor noen
 * fysikk i det hele tatt.
 */

const SHOULDER = 13.0;      // gress fra asfaltkant til rekkverk
const BEHIND_BARRIER = 2.0; // og videre bak muren, så bakken aldri tar slutt
const MIN_SHOULDER = 1.4;   // men aldri mindre enn dette

/**
 * Hvor bred skulderen er akkurat her.
 *
 * Den krymper i trange svinger, og det må den. Et bånd som forskyves lenger ut
 * enn svingens radius bretter seg over seg selv på innsiden — med tretten
 * meter skulder ble forholdet 1.46 i hårnålen på Kystveien, og geometrien falt
 * fra hverandre. Det er dessuten slik ekte fjellveier er: en hårnål har ingen
 * grusavkjørsel, den har en mur rett i veikanten.
 */
function shoulderAt(f) {
  // 0.72 av radien er der båndet så vidt holder seg utbrettet. Lavere enn
  // det krympet frisonen på Apex Ring også, der ingenting bretter seg.
  const plass = 0.72 * f.radius - f.halfWidth - BEHIND_BARRIER;
  const bredde = THREE.MathUtils.clamp(plass, MIN_SHOULDER, SHOULDER);
  // På ei bru finnes det ingen skulder — der er det rekkverk og så luft.
  // Uten dette la gressbåndet seg som et lokk over kløfta, og brua ble
  // usynlig fra bilen.
  return THREE.MathUtils.lerp(bredde, 0.15, f.bridge ?? 0);
}
const KERB_WIDTH = 1.7;
const KERB_HEIGHT = 0.055;
const KERB_RADIUS = 250;   // curbs legges der svingen er trangere enn dette
// 28 cm gravd ned, 1.82 m over veien. Var muren lavere enn karosseriets
// kollisjonsboks (overkant 1.34 m), traff bilen toppkanten i stedet for veggen:
// kontaktnormalen pekte oppover, og bilen ble vippet 3,6 m til værs og over.
// En vegg som stopper en bil må rekke godt over taket på den.
const BARRIER_HEIGHT = 2.10;
const BARRIER_THICKNESS = 0.22;

/** Hvor på runden start- og målstreken ligger: et stykke ut på rettstrekket. */
export const START_FRACTION = 0.06;

/**
 * Et bånd langs banen mellom to sideforskyvninger.
 * @param {(f, i) => number} inner meter fra senterlinjen, venstre side negativ
 */
function ribbon(path, inner, outer, liftInner, liftOuter, { uvRepeat = 6, colour } = {}) {
  const n = path.samples;
  const positions = [];
  const uvs = [];
  const colours = colour ? [] : null;
  const indices = [];
  const p = new THREE.Vector3();

  for (let i = 0; i <= n; i++) {
    const f = path.frameAt(i);
    const distance = i < n ? f.distance : path.length;

    for (const [side, lift] of [[inner(f, i), liftInner(f, i)], [outer(f, i), liftOuter(f, i)]]) {
      p.copy(f.position).addScaledVector(f.right, side).addScaledVector(f.normal, lift);
      positions.push(p.x, p.y, p.z);
    }
    uvs.push(0, distance / uvRepeat, 1, distance / uvRepeat);

    if (colour) {
      const c = colour(f, i);
      colours.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }

    if (i > 0) {
      const a = (i - 1) * 2;
      indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (colours) geo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Trekantnett til fysikken, hentet rett fra den tegnede geometrien. */
function colliderFrom(geometry, RAPIER) {
  const vertices = new Float32Array(geometry.attributes.position.array);
  const indices = new Uint32Array(geometry.index.array);
  return RAPIER.ColliderDesc.trimesh(vertices, indices);
}

/** Curbs legges bare i svinger, og de tones inn og ut så de ikke starter brått. */
function kerbStrength(path, index) {
  const f = path.frameAt(index);
  if (f.radius > KERB_RADIUS) return 0;
  // Glatt overgang: full høyde i trange svinger, ingenting på rettstrekk.
  return THREE.MathUtils.clamp((KERB_RADIUS - f.radius) / (KERB_RADIUS * 0.45), 0, 1);
}

export { shoulderAt };

export function buildTrack(path, physics, { quality = 1 } = {}) {
  const RAPIER = physics.RAPIER;
  const group = new THREE.Group();

  // Teksturene tegnes i koden ved oppstart. På mobil halveres oppløsningen og
  // anisotropien; kornet er der fortsatt, det koster bare mindre minne.
  const detail = (full, low) => (quality >= 1 ? full : low);
  const aniso = detail(8, 4);

  // Fargen ligger i kartet, så materialet må ikke tone det ned: hvit basefarge.
  const asphalt = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, metalness: 0,
    ...asphaltMaps({ size: detail(512, 256), anisotropy: aniso }),
  });
  const grass = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1,
    ...grassMaps({ size: detail(256, 128), anisotropy: detail(4, 2) }),
    polygonOffset: true, polygonOffsetFactor: 3, polygonOffsetUnits: 3,
  });
  const kerbMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.7,
    ...kerbMaps({ size: detail(128, 64), anisotropy: detail(4, 2) }),
  });
  const barrierMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, metalness: 0.05, roughness: 0.7,
    ...concreteMaps({ size: detail(256, 128), anisotropy: detail(4, 2) }),
  });
  const paint = new THREE.MeshStandardMaterial({
    color: 0xe9ecef, roughness: 0.7,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });

  // --- asfalt ---
  const roadGeo = ribbon(path,
    (f) => -f.halfWidth, (f) => f.halfWidth,
    () => 0, () => 0, { uvRepeat: 8 });
  const road = new THREE.Mesh(roadGeo, asphalt);
  road.receiveShadow = true;
  group.add(road);
  physics.addStatic(colliderFrom(roadGeo, RAPIER).setFriction(1), { surface: 'asphalt' });

  // --- skulder: gresset mellom asfalt og rekkverk ---
  // Gresset fortsetter et stykke FORBI rekkverket. Sluttet det ved muren, hang
  // et hjul som berørte veggen halvt ut over ingenting, og bilen falt ned i
  // tomrommet i stedet for å skrape langs rekkverket.
  for (const sign of [-1, 1]) {
    const geo = ribbon(path,
      (f) => sign * f.halfWidth,
      (f) => sign * (f.halfWidth + shoulderAt(f) + BEHIND_BARRIER),
      () => -0.02, () => -0.34,
      { uvRepeat: 12 });
    const mesh = new THREE.Mesh(geo, grass);
    mesh.receiveShadow = true;
    group.add(mesh);
    physics.addStatic(colliderFrom(geo, RAPIER).setFriction(1), { surface: 'grass' });
  }

  // --- curbs ---
  const red = new THREE.Color(0xc4342a);
  const white = new THREE.Color(0xe8e8e6);
  for (const sign of [-1, 1]) {
    const geo = ribbon(path,
      (f, i) => sign * f.halfWidth,
      (f, i) => sign * (f.halfWidth + KERB_WIDTH * kerbStrength(path, i)),
      (f, i) => KERB_HEIGHT * 0.35 * kerbStrength(path, i),
      (f, i) => KERB_HEIGHT * kerbStrength(path, i),
      { colour: (f) => (Math.floor(f.distance / 2.2) % 2 ? red : white) });
    const mesh = new THREE.Mesh(geo, kerbMat);
    mesh.receiveShadow = true;
    group.add(mesh);
    physics.addStatic(colliderFrom(geo, RAPIER).setFriction(1), { surface: 'kerb' });
  }

  // --- rekkverk ---
  buildBarriers(path, physics, group, barrierMat);
  buildBridges(path, group, barrierMat, asphalt);
  buildTunnels(path, group, barrierMat);

  // --- oppmerking ---
  buildMarkings(path, group, paint);

  return { group, materials: { asphalt, grass, kerbMat, barrierMat, paint } };
}

function buildBarriers(path, physics, group, material) {
  const RAPIER = physics.RAPIER;
  const n = path.samples;

  for (const sign of [-1, 1]) {
    const offset = (f) => sign * (f.halfWidth + shoulderAt(f));
    const geo = ribbon(path,
      offset, offset,
      () => -0.28, () => -0.28 + BARRIER_HEIGHT,
      { uvRepeat: 4 });
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.material.side = THREE.DoubleSide;
    mesh.castShadow = true;
    group.add(mesh);

    // Fysikken bruker kasser i stedet for båndet: en tynn vegg av trekanter er
    // lett å skyte gjennom i 300 km/t, mens kasser har volum å stoppe mot.
    const step = 6;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (let i = 0; i < n; i += step) {
      const f0 = path.frameAt(i);
      const f1 = path.frameAt(i + step);
      a.copy(f0.position).addScaledVector(f0.right, offset(f0)).addScaledVector(f0.normal, -0.28);
      b.copy(f1.position).addScaledVector(f1.right, offset(f1)).addScaledVector(f1.normal, -0.28);

      const mid = a.clone().lerp(b, 0.5);
      mid.y += BARRIER_HEIGHT * 0.5;
      const dir = b.clone().sub(a);
      const half = dir.length() * 0.5;
      if (half < 0.1) continue;

      const q = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1), dir.normalize(),
      );
      physics.addStatic(
        RAPIER.ColliderDesc.cuboid(BARRIER_THICKNESS, BARRIER_HEIGHT * 0.5, half + 0.15)
          .setFriction(0.35).setRestitution(0.12),
        { surface: 'asphalt', position: mid, rotation: q },
      );
    }
  }
}

function buildMarkings(path, group, material) {
  const n = path.samples;
  const lift = 0.012;

  // Kantlinjer langs hele banen.
  for (const sign of [-1, 1]) {
    const geo = ribbon(path,
      (f) => sign * (f.halfWidth - 0.42),
      (f) => sign * (f.halfWidth - 0.12),
      () => lift, () => lift, { uvRepeat: 4 });
    group.add(new THREE.Mesh(geo, material));
  }

  // Start- og målstrek, og et rutemønster over hele bredden.
  const startIndex = Math.round(n * START_FRACTION);
  const f = path.frameAt(startIndex);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(f.width, 1.0), material);
  line.position.copy(f.position).addScaledVector(f.normal, lift);
  line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), f.normal);
  line.rotateZ(Math.atan2(f.right.x, f.right.z));
  group.add(line);

  return group;
}

/** Startoppstillingen: på hovedrettstrekket, rettet langs banen. */
export function startPose(path, offsetMetres = 0) {
  const index = Math.round(path.samples * START_FRACTION)
    - Math.round(offsetMetres / (path.length / path.samples));
  const f = path.frameAt(index);
  const position = f.position.clone().addScaledVector(f.normal, 0.8);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1), f.tangent.clone().normalize(),
  );
  return { position, quaternion, frame: f };
}

/**
 * Brua.
 *
 * Terrenget stuper ned i et innløp der brua står, så veibanen må bære seg
 * selv: en dekkeunderside, rekkverk i stedet for grus langs kantene, og pilarer
 * ned i vannet. Alt følger de samme prøvepunktene som asfalten, så dekket kan
 * ikke havne et annet sted enn veien.
 */
function buildBridges(path, group, betong, asfalt) {
  const n = path.samples;
  const på = (f) => f.bridge > 0.02;
  if (!path.frames.some(på)) return;

  // Underside: samme bånd som veien, men senket og med egen tykkelse.
  const dekke = ribbon(path,
    (f) => -(f.halfWidth + 1.1) * f.bridge - f.halfWidth * (1 - f.bridge),
    (f) => (f.halfWidth + 1.1) * f.bridge + f.halfWidth * (1 - f.bridge),
    (f) => -0.05 - f.bridge * 1.5, (f) => -0.05 - f.bridge * 1.5,
    { uvRepeat: 10 });
  dekke.computeVertexNormals();
  const underside = new THREE.Mesh(dekke, betong);
  underside.receiveShadow = true;
  underside.castShadow = true;
  group.add(underside);

  // Sidekanter fra dekket opp til rekkverkshøyde.
  for (const sign of [-1, 1]) {
    const kant = (f) => sign * (f.halfWidth + 1.1);
    const geo = ribbon(path,
      kant, kant,
      (f) => -0.05 - f.bridge * 1.5, (f) => (f.bridge > 0.02 ? 1.05 : -0.05),
      { uvRepeat: 6 });
    geo.computeVertexNormals();
    const vegg = new THREE.Mesh(geo, betong);
    vegg.material.side = THREE.DoubleSide;
    vegg.castShadow = true;
    group.add(vegg);
  }

  // Pilarer med jevne mellomrom, ned i innløpet.
  const pilarMat = betong;
  for (let i = 0; i < n; i += 26) {
    const f = path.frameAt(i);
    if (f.bridge < 0.55) continue;
    for (const sign of [-1, 1]) {
      const topp = f.position.clone().addScaledVector(f.right, sign * (f.halfWidth * 0.55));
      const høyde = 30;
      const pilar = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, høyde, 2.4), pilarMat,
      );
      pilar.position.copy(topp).setY(topp.y - 1.6 - høyde / 2);
      pilar.castShadow = true;
      group.add(pilar);
    }
  }
  void asfalt;
}

/**
 * Tunnelen.
 *
 * Vegger og tak i betong. Taket kaster skygge som alt annet, så det blir mørkt
 * inne uten at noe måtte skrus av — og lyst igjen ved utløpet. Lysarmaturene i
 * taket er selvlysende flater, ikke lyskilder: en lampe per ti meter ville kostet
 * langt mer enn den synes.
 */
function buildTunnels(path, group, betong) {
  const n = path.samples;
  if (!path.frames.some((f) => f.tunnel > 0.02)) return;

  const HØYDE = 6.4;
  const bredde = (f) => f.halfWidth + 1.6;

  for (const sign of [-1, 1]) {
    const geo = ribbon(path,
      (f) => sign * bredde(f), (f) => sign * bredde(f),
      () => -0.4, (f) => (f.tunnel > 0.02 ? HØYDE * f.tunnel - 0.4 : -0.4),
      { uvRepeat: 5 });
    geo.computeVertexNormals();
    const vegg = new THREE.Mesh(geo, betong);
    vegg.material.side = THREE.DoubleSide;
    vegg.castShadow = true;
    vegg.receiveShadow = true;
    group.add(vegg);
  }

  const tak = ribbon(path,
    (f) => -bredde(f), (f) => bredde(f),
    (f) => HØYDE * f.tunnel - 0.4, (f) => HØYDE * f.tunnel - 0.4,
    { uvRepeat: 5 });
  tak.computeVertexNormals();
  const takMesh = new THREE.Mesh(tak, betong);
  takMesh.material.side = THREE.DoubleSide;
  takMesh.castShadow = true;
  takMesh.receiveShadow = true;
  group.add(takMesh);

  // Lysarmaturer langs taket.
  const lampeMat = new THREE.MeshStandardMaterial({
    color: 0xfff2d0, emissive: 0xffe9b8, emissiveIntensity: 3.4, toneMapped: true,
  });
  const lampe = new THREE.BoxGeometry(0.9, 0.12, 0.34);
  for (let i = 0; i < n; i += 9) {
    const f = path.frameAt(i);
    if (f.tunnel < 0.75) continue;
    const m = new THREE.Mesh(lampe, lampeMat);
    m.position.copy(f.position).addScaledVector(f.normal, HØYDE - 0.75);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), f.tangent);
    group.add(m);
  }
}
