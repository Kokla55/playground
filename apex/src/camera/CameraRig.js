import * as THREE from 'three';

const _yawQ = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _desired = new THREE.Vector3();
const _lookAt = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _vel = new THREE.Vector3();

/**
 * Forfølgende kamera.
 *
 * Kameraet følger bilens giring, men ikke rullingen — ellers ville horisonten
 * vippe hver gang bilen krenger, og det gjør folk kvalme. Avstand og
 * synsvinkel åpner seg med farten, slik at fartsfølelsen bygger seg opp.
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
    this._initialised = false;
  }

  update(dt, vehicle) {
    _euler.setFromQuaternion(vehicle.quaternion);
    _yawQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), _euler.y);

    const speed = vehicle.telemetry.speed;
    const speedT = Math.min(speed / 75, 1);

    // Kameraet trekker seg litt lenger bak når farten øker.
    _offset.set(0, this.height + speedT * 0.30, -(this.distance + speedT * 1.5));
    _offset.applyQuaternion(_yawQ);
    _desired.copy(vehicle.position).add(_offset);

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
      this.position.copy(_desired);
      this.target.copy(_lookAt);
      this._initialised = true;
    } else {
      const k = 1 - Math.exp(-this.stiffness * dt);
      this.position.lerp(_desired, k);
      this.target.lerp(_lookAt, Math.min(1, k * 1.6));
    }

    this.camera.position.copy(this.position);
    this.camera.lookAt(this.target);

    const fov = this.baseFov + (this.maxFov - this.baseFov) * speedT * speedT;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 3);
      this.camera.updateProjectionMatrix();
    }
  }

  reset() { this._initialised = false; }
}

/**
 * Enkel panservisning brukt til å kjenne på fysikken fra førerplass.
 * Full cockpit med ratt, instrumenter og speil bygges i fase 2.
 */
export class HoodCamera {
  constructor(camera, cfg) {
    this.camera = camera;
    // Førerplassen ligger på venstre side, altså +X med denne orienteringen.
    this.offset = new THREE.Vector3(0.36, 1.14 - cfg.ridePoint + 0.22, 0.30);
    this.lookOffset = new THREE.Vector3(0.36, 1.10 - cfg.ridePoint + 0.22, 12);
    this._p = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this.fov = 68;
  }

  update(dt, vehicle) {
    this._p.copy(this.offset).applyQuaternion(vehicle.quaternion).add(vehicle.position);
    this._t.copy(this.lookOffset).applyQuaternion(vehicle.quaternion).add(vehicle.position);
    this.camera.position.copy(this._p);
    this.camera.up.set(0, 1, 0).applyQuaternion(vehicle.quaternion);
    this.camera.lookAt(this._t);
    if (this.camera.fov !== this.fov) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  reset() {}
}
