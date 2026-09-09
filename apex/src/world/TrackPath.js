import * as THREE from 'three';

/**
 * Banens senterlinje.
 *
 * Banen er definert av en håndplassert kontrollkurve som lukker seg til en
 * rundbane. Alt annet — asfalt, curbs, rekkverk og terreng — utledes av denne,
 * slik at det finnes én sannhet om hvor banen går.
 *
 * Punktene er [x, z, høyde]. x og z er planet, høyden er over havet.
 */
const CONTROL = [
  [-430, -452,  0.0],   // start/mål — nesten 500 m rett fram
  [-300, -452,  0.0],
  [-160, -452,  0.0],
  [ -20, -450,  0.0],
  [ 120, -446,  0.8],
  [ 235, -430,  2.6],   // sving 1: rask høyre, stigende
  [ 322, -366,  5.2],
  [ 362, -262,  7.6],
  [ 352, -156,  8.4],   // toppen av stigningen
  [ 316,  -68,  6.6],   // ned igjen
  [ 268,   30,  4.2],   // esser
  [ 292,  140,  2.6],
  [ 244,  238,  1.8],
  [ 176,  296,  3.2],   // opp mot kneika
  [  60,  334,  6.4],
  [ -70,  340,  9.4],
  [-186,  296, 11.0],   // kneik, banens høyeste punkt
  [-262,  212,  9.2],
  [-306,  116,  6.4],   // lang nedoverbakke
  [-292,   16,  4.0],
  [-238,  -70,  2.6],   // inn i den langsomme
  [-286, -132,  1.8],
  [-342, -250,  1.0],
  [-408, -336,  0.6],
  [-452, -420,  0.2],   // siste sving inn på rettstrekket
];

/** Banebredde varierer: bredest på hovedrettstrekket, smalere i hårnålen. */
const WIDTH_MIN = 10.5;
const WIDTH_MAX = 15.0;

const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _next = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class TrackPath {
  /** @param {number} samples antall punkter senterlinjen deles opp i */
  constructor(samples = 1400) {
    this.curve = new THREE.CatmullRomCurve3(
      CONTROL.map(([x, z, y]) => new THREE.Vector3(x, y, z)),
      true,
      'centripetal',
      0.5,
    );

    this.samples = samples;
    this.frames = [];
    this._build();
  }

  _build() {
    const n = this.samples;
    const pts = [];
    for (let i = 0; i < n; i++) pts.push(this.curve.getPointAt(i / n));

    // Lengde og kumulativ avstand langs banen.
    let length = 0;
    const distances = [0];
    for (let i = 1; i <= n; i++) {
      length += pts[i % n].distanceTo(pts[i - 1]);
      distances.push(length);
    }
    this.length = length;

    for (let i = 0; i < n; i++) {
      const p = pts[i];
      _prev.copy(pts[(i - 1 + n) % n]);
      _next.copy(pts[(i + 1) % n]);

      // Tangent fra nabopunktene — jevnere enn kurvens egen derivert.
      _t.subVectors(_next, _prev).normalize();

      // Krumning ut fra retningsendringen over ett steg.
      const a = Math.atan2(_next.x - p.x, _next.z - p.z);
      const b = Math.atan2(p.x - _prev.x, p.z - _prev.z);
      let dTheta = a - b;
      while (dTheta > Math.PI) dTheta -= Math.PI * 2;
      while (dTheta < -Math.PI) dTheta += Math.PI * 2;
      const ds = _next.distanceTo(_prev) * 0.5;
      const curvature = ds > 1e-6 ? dTheta / ds : 0;

      // Høyre-vektor i planet. Doseringen vipper tverrsnittet inn mot svingen.
      const right = new THREE.Vector3(_t.z, 0, -_t.x).normalize();
      const bank = THREE.MathUtils.clamp(curvature * 3.4, -0.14, 0.14);
      const normal = new THREE.Vector3().copy(UP).applyAxisAngle(_t, -bank).normalize();
      const banked = new THREE.Vector3().crossVectors(normal, _t).normalize();

      // Trangere sving gir smalere bane; det gjør hårnålen tydelig.
      const tight = Math.min(Math.abs(curvature) * 55, 1);
      const width = THREE.MathUtils.lerp(WIDTH_MAX, WIDTH_MIN, tight);

      this.frames.push({
        position: p.clone(),
        tangent: _t.clone(),
        right: banked.clone().negate(),
        normal,
        curvature,
        radius: Math.abs(curvature) > 1e-5 ? 1 / Math.abs(curvature) : Infinity,
        width,
        halfWidth: width * 0.5,
        distance: distances[i],
        flatRight: right,
      });
    }
  }

  frameAt(index) {
    return this.frames[((index % this.samples) + this.samples) % this.samples];
  }

  /** Punkt på banens tverrsnitt: t = -1 venstre kant, 0 senter, +1 høyre kant. */
  edgePoint(index, t, lift = 0, out = new THREE.Vector3()) {
    const f = this.frameAt(index);
    out.copy(f.position)
      .addScaledVector(f.right, t * f.halfWidth)
      .addScaledVector(f.normal, lift);
    return out;
  }

  /** Nøkkeltall til å vurdere om banen faktisk er kjørbar. */
  describe() {
    let minRadius = Infinity, maxGrade = 0, maxBank = 0, minY = Infinity, maxY = -Infinity;
    let tightIndex = 0;

    for (let i = 0; i < this.samples; i++) {
      const f = this.frames[i];
      if (f.radius < minRadius) { minRadius = f.radius; tightIndex = i; }
      const next = this.frameAt(i + 1);
      const ds = next.position.distanceTo(f.position);
      if (ds > 1e-6) maxGrade = Math.max(maxGrade, Math.abs(next.position.y - f.position.y) / ds);
      maxBank = Math.max(maxBank, Math.abs(Math.asin(THREE.MathUtils.clamp(f.right.y, -1, 1))));
      minY = Math.min(minY, f.position.y);
      maxY = Math.max(maxY, f.position.y);
    }

    // Selvskjæring: to punkter langt fra hverandre langs banen, men nær i planet.
    let minGap = Infinity, gapAt = null;
    const step = 4;
    for (let i = 0; i < this.samples; i += step) {
      const a = this.frames[i];
      for (let j = i + step; j < this.samples; j += step) {
        const along = Math.min(
          this.frames[j].distance - a.distance,
          this.length - (this.frames[j].distance - a.distance),
        );
        if (along < 120) continue;
        const dx = this.frames[j].position.x - a.position.x;
        const dz = this.frames[j].position.z - a.position.z;
        const gap = Math.hypot(dx, dz) - (a.halfWidth + this.frames[j].halfWidth);
        if (gap < minGap) { minGap = gap; gapAt = [i, j]; }
      }
    }

    return {
      length: this.length,
      minRadius,
      tightestAt: tightIndex / this.samples,
      maxGradePercent: maxGrade * 100,
      maxBankDegrees: (maxBank * 180) / Math.PI,
      elevationRange: maxY - minY,
      closestApproach: minGap,
      closestAt: gapAt,
    };
  }
}
