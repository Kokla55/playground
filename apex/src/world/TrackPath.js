import * as THREE from 'three';
import { TRACKS } from './tracks.js';

/**
 * Banens senterlinje.
 *
 * Banen er definert av en håndplassert kontrollkurve som lukker seg til en
 * rundbane. Alt annet — asfalt, curbs, rekkverk og terreng — utledes av denne,
 * slik at det finnes én sannhet om hvor banen går.
 *
 * Selve punktene ligger i tracks.js. Denne klassen vet ingenting om hvilken
 * bane den bygger, bare hvordan en bane blir til av kontrollpunkter.
 */
const SMOOTH_METRES = 32;   // doseringen og bredden glattes over denne lengden

const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _next = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class TrackPath {
  /** @param {object} def banedefinisjon fra tracks.js */
  constructor(def = TRACKS[0]) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.widthMin = def.widthMin ?? 10.5;
    this.widthMax = def.widthMax ?? 15.0;
    this.seaLevel = def.seaLevel ?? null;

    this.curve = new THREE.CatmullRomCurve3(
      def.control.map(([x, z, y]) => new THREE.Vector3(x, y, z)),
      true,
      'centripetal',
      0.5,
    );

    this.samples = def.samples ?? 1400;
    this.frames = [];
    this._build();
    this._markSections();
  }

  /**
   * Merker hvilke prøvepunkter som ligger i tunnel eller på bro.
   *
   * Strekningene er oppgitt som andel av runden, ikke som meter, slik at de
   * følger med hvis banen endres. Overgangene tones inn og ut over noen meter
   * så tunnelmunningen ikke slår på som en bryter.
   */
  _markSections() {
    const seksjon = (liste, navn) => {
      for (const f of this.frames) f[navn] = 0;
      for (const { from, to } of liste ?? []) {
        const a = from * this.length;
        const b = to * this.length;
        const toning = Math.min(18, (b - a) * 0.22);
        for (const f of this.frames) {
          if (f.distance < a || f.distance > b) continue;
          const inn = Math.min(1, (f.distance - a) / toning);
          const ut = Math.min(1, (b - f.distance) / toning);
          f[navn] = Math.max(f[navn], Math.min(inn, ut));
        }
      }
    };
    seksjon(this.def.tunnels, 'tunnel');
    seksjon(this.def.bridges, 'bridge');
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

    // Krumning ut fra retningsendringen over ett steg. Rå er den full av støy:
    // Catmull-Rom-kurven er glatt i posisjon, men ikke i andrederivert.
    const raw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      _prev.copy(pts[(i - 1 + n) % n]);
      _next.copy(pts[(i + 1) % n]);
      const a = Math.atan2(_next.x - p.x, _next.z - p.z);
      const b = Math.atan2(p.x - _prev.x, p.z - _prev.z);
      let dTheta = a - b;
      while (dTheta > Math.PI) dTheta -= Math.PI * 2;
      while (dTheta < -Math.PI) dTheta += Math.PI * 2;
      const ds = _next.distanceTo(_prev) * 0.5;
      raw[i] = ds > 1e-6 ? dTheta / ds : 0;
    }

    // Glattet over rundt tretti meter. Både doseringen og banebredden utledes
    // av krumningen, så støyen der ble til ekte humper i asfalten: på det
    // verste løftet banekanten seg 15 cm på to meter, nok til å slå fjæringen
    // i bunn i full fart. Doseringen skal bygge seg opp gjennom innkjøringen,
    // slik den gjør på en ekte bane.
    const half = Math.max(1, Math.round(SMOOTH_METRES / (length / n) / 2));
    const curvatures = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0, weight = 0;
      for (let k = -half; k <= half; k++) {
        // Kosinusvekt: naboene teller mindre jo lenger unna de er, så
        // hårnålen beholder formen sin i stedet for å bli smurt ut.
        const w = 0.5 + 0.5 * Math.cos((Math.PI * k) / (half + 1));
        sum += raw[((i + k) % n + n) % n] * w;
        weight += w;
      }
      curvatures[i] = sum / weight;
    }

    for (let i = 0; i < n; i++) {
      const p = pts[i];
      _prev.copy(pts[(i - 1 + n) % n]);
      _next.copy(pts[(i + 1) % n]);

      // Tangent fra nabopunktene — jevnere enn kurvens egen derivert.
      _t.subVectors(_next, _prev).normalize();

      const curvature = curvatures[i];

      // Høyre-vektor i planet. Doseringen vipper tverrsnittet inn mot svingen.
      const right = new THREE.Vector3(_t.z, 0, -_t.x).normalize();
      const bank = THREE.MathUtils.clamp(curvature * 3.4, -0.14, 0.14);
      const normal = new THREE.Vector3().copy(UP).applyAxisAngle(_t, -bank).normalize();
      const banked = new THREE.Vector3().crossVectors(normal, _t).normalize();

      // Trangere sving gir smalere bane; det gjør hårnålen tydelig.
      const tight = Math.min(Math.abs(curvature) * 55, 1);
      const width = THREE.MathUtils.lerp(this.widthMax, this.widthMin, tight);

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
