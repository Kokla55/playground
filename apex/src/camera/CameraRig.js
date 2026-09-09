import * as THREE from 'three';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const _yawQ = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _lookAt = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Forfølgende kamera.
 *
 * Kameraet følger bilens giring, men ikke rullingen — ellers ville horisonten
 * vippe hver gang bilen krenger, og det gjør folk kvalme. Det legger på en
 * ørliten helning inn i svingen i stedet, som leser som fart uten å forstyrre.
 * Avstand og synsvinkel åpner seg med farten.
 */
export class ChaseCamera {
  constructor(camera, options = {}) {
    this.camera = camera;
    this.distance = options.distance ?? 6.4;
    this.height = options.height ?? 2.05;
    this.lookHeight = options.lookHeight ?? 0.85;
    this.lookAhead = options.lookAhead ?? 4.0;
    this.baseFov = options.fov ?? 62;
    this.maxFov = options.maxFov ?? 82;
    this.stiffness = options.stiffness ?? 5.5;

    this.position = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this._roll = 0;
    this._bob = 0;
    this._initialised = false;
  }

  update(dt, vehicle) {
    _euler.setFromQuaternion(vehicle.quaternion);

    const t = vehicle.telemetry;
    const speedT = Math.min(t.speed / 75, 1);

    // Kameraet mykes opp i bilens egen ramme, ikke i verden.
    //
    // Å glatte verdensposisjonen ser riktig ut i ro, men en eksponentiell
    // utjevning som følger et mål i fart ligger permanent etter med farten
    // ganget med tidskonstanten — ved 270 km/t blir det tretten meter, og bilen
    // krymper til en prikk. Her følger avstanden bilen nøyaktig, mens det bare
    // er dreiningen som får henge etter. Da svinger kameraet fortsatt mykt rundt
    // i svingene, men slipper aldri taket på bilen.
    if (!this._initialised) this._yaw = _euler.y;
    let dYaw = _euler.y - this._yaw;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    this._yaw += dYaw * (1 - Math.exp(-this.stiffness * dt));
    _yawQ.setFromAxisAngle(_up, this._yaw);

    // Ørlite skjelv ved høy fart. Nok til å kjennes, ikke nok til å irritere.
    this._bob += dt * (8 + speedT * 22);
    const shake = speedT * speedT * 0.035;

    _offset.set(
      Math.sin(this._bob * 1.7) * shake,
      this.height + speedT * 0.30 + Math.sin(this._bob) * shake,
      -(this.distance + speedT * 1.5),
    );
    _offset.applyQuaternion(_yawQ);
    this.position.copy(vehicle.position).add(_offset);

    _lookAt.set(0, this.lookHeight, this.lookAhead);
    _lookAt.applyQuaternion(_yawQ);
    _lookAt.add(vehicle.position);

    // Sikt litt mot der bilen faktisk beveger seg. Under en skrens peker
    // kameraet dermed nedover veien og ikke rett ut i grøfta.
    const lv = vehicle.body.linvel();
    _vel.set(lv.x, 0, lv.z);
    if (_vel.lengthSq() > 4) {
      _lookAt.addScaledVector(_vel.normalize(), speedT * 2.2);
    }

    if (!this._initialised) {
      this.target.copy(_lookAt);
      this._initialised = true;
    } else {
      this.target.lerp(_lookAt, Math.min(1, 1 - Math.exp(-this.stiffness * 1.6 * dt)));
    }

    this.camera.up.set(0, 1, 0);
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.target);

    // Kameraet legger seg svakt inn i svingen.
    const rollGoal = clamp(-t.gLat * 0.022, -0.05, 0.05);
    this._roll += (rollGoal - this._roll) * Math.min(1, dt * 4);
    this.camera.rotateZ(this._roll);

    const fov = this.baseFov + (this.maxFov - this.baseFov) * speedT * speedT;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 3);
      this.camera.updateProjectionMatrix();
    }
  }

  reset() {
    this._initialised = false;
    this._roll = 0;
  }
}

/**
 * Cockpit-kamera.
 *
 * Dette er hovedkameraet. Det sitter fast i karosseriet og følger både nikk og
 * krengning — det er nettopp det som gjør at man kjenner underlaget. Hodet
 * forskyves litt av g-kreftene, og blikket dras svakt inn i svingen, slik en
 * fører faktisk ser mot der bilen skal.
 */
export class CockpitCamera {
  constructor(camera, cfg, eye) {
    this.camera = camera;
    this.eye = eye.clone();
    // Snevrere synsvinkel enn tidligere: 80 grader presset veien sammen til en
    // stripe. 66 gir førersetet en naturlig utsikt, og speilene ligger fortsatt
    // innenfor kanten.
    this.fov = 66;

    this._headX = 0;
    this._headZ = 0;
    this._headY = 0;
    this._yaw = 0;
    this._p = new THREE.Vector3();
    this._t = new THREE.Vector3();
  }

  update(dt, vehicle) {
    const t = vehicle.telemetry;
    const k = Math.min(1, dt * 7);

    // I en høyresving peker akselerasjonen mot høyre, og hodet kastes ut mot
    // venstre — som med denne orienteringen er +X.
    this._headX += (clamp(t.gLat * 0.028, -0.05, 0.05) - this._headX) * k;
    this._headZ += (clamp(-t.gLong * 0.022, -0.05, 0.05) - this._headZ) * k;
    this._headY += (clamp(-Math.abs(t.gLong) * 0.010, -0.02, 0) - this._headY) * k;

    // Blikket inn i svingen. Høyre er −X, så positivt rattutslag gir negativ
    // dreining om opp-aksen.
    const yawGoal = clamp(-t.steer * 0.17, -0.2, 0.2);
    this._yaw += (yawGoal - this._yaw) * Math.min(1, dt * 5);

    this._p.set(
      this.eye.x + this._headX,
      this.eye.y + this._headY,
      this.eye.z + this._headZ,
    );
    this._t.set(
      this._p.x + Math.sin(this._yaw) * 24,
      this._p.y - 1.7,
      this._p.z + Math.cos(this._yaw) * 24,
    );

    this._p.applyQuaternion(vehicle.quaternion).add(vehicle.position);
    this._t.applyQuaternion(vehicle.quaternion).add(vehicle.position);

    this.camera.position.copy(this._p);
    this.camera.up.set(0, 1, 0).applyQuaternion(vehicle.quaternion);
    this.camera.lookAt(this._t);

    if (this.camera.fov !== this.fov) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  reset() {
    this._headX = 0;
    this._headZ = 0;
    this._headY = 0;
    this._yaw = 0;
  }
}
