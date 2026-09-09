import * as THREE from 'three';
import { Tire } from './Tire.js';
import { Drivetrain } from './Drivetrain.js';
import { SURFACES } from './CarConfig.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Gummistoppen dobler stivheten for hver 2 cm den trykkes sammen.
const BUMP_STOP_KNEE = 0.02;

// Gjenbrukte vektorer — fysikken kjører 120 ganger i sekundet og skal ikke
// produsere søppel for garbage collectoren.
const _pos = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _bodyVel = new THREE.Vector3();
const _attach = new THREE.Vector3();
const _down = new THREE.Vector3();
const _pv = new THREE.Vector3();
const _wf = new THREE.Vector3();
const _wr = new THREE.Vector3();
const _force = new THREE.Vector3();
const _point = new THREE.Vector3();
const _steerQ = new THREE.Quaternion();
const _r = new THREE.Vector3();
const _w = new THREE.Vector3();
const _prevVel = new THREE.Vector3();
const _accel = new THREE.Vector3();

/** Hastigheten til et bestemt punkt på en roterende kropp. */
function velocityAt(body, point, out) {
  const lv = body.linvel();
  const av = body.angvel();
  const t = body.translation();
  _r.set(point.x - t.x, point.y - t.y, point.z - t.z);
  _w.set(av.x, av.y, av.z);
  return out.copy(_w).cross(_r).add(_vel.set(lv.x, lv.y, lv.z));
}

/** Bremsemoment som kan låse hjulet, men aldri snu rotasjonsretningen. */
function applyBrake(wheel, torque, inertia, dt) {
  if (torque <= 0) return;
  const step = (torque / inertia) * dt;
  if (Math.abs(wheel.omega) <= step) wheel.omega = 0;
  else wheel.omega -= Math.sign(wheel.omega) * step;
}

export class Vehicle {
  constructor(physics, cfg, spawn = { x: 0, y: 1, z: 0 }) {
    this.physics = physics;
    this.cfg = cfg;
    this.spawn = { ...spawn };

    const RAPIER = physics.RAPIER;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawn.y, spawn.z)
      // Startretningen kommer fra banen, så bilen står riktig vei på rutenettet.
      .setRotation(spawn.q ?? { x: 0, y: 0, z: 0, w: 1 })
      // I 300 km/t flytter bilen seg over en halv meter per fysikksteg. Uten
      // kontinuerlig kollisjonssjekk kan den passere rett gjennom rekkverket.
      .setCcdEnabled(true)
      .setLinearDamping(0)
      .setAngularDamping(0.06)
      .setCanSleep(false);
    this.body = physics.world.createRigidBody(bodyDesc);

    const c = cfg.collider;
    // Masse og treghet settes eksplisitt i stedet for å utledes av kollideren.
    // Tyngdepunktet trekkes ned til kroppens origo, godt under midten av
    // karosseriboksen — det er lav tyngdepunktshøyde som gjør at bilen krenger
    // lite og holder seg på hjulene.
    const colliderDesc = RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz)
      .setTranslation(0, c.offsetY, c.offsetZ)
      .setFriction(0.35)
      .setRestitution(0.05)
      .setMassProperties(
        cfg.mass,
        { x: 0, y: -c.offsetY, z: -c.offsetZ },
        { x: cfg.inertia.x, y: cfg.inertia.y, z: cfg.inertia.z },
        { x: 0, y: 0, z: 0, w: 1 },
      );
    this.collider = physics.world.createCollider(colliderDesc, this.body);

    if (Math.abs(this.body.mass() - cfg.mass) > 1) {
      throw new Error(`Massen ble ikke satt: ${this.body.mass()} kg, forventet ${cfg.mass} kg`);
    }

    this.wheels = cfg.wheels.map((wcfg) => ({
      cfg: wcfg,
      tire: new Tire(wcfg.tire),
      grounded: false,
      normal: new THREE.Vector3(0, 1, 0),
      contactPoint: new THREE.Vector3(),
      wheelCenter: new THREE.Vector3(),
      suspensionLength: wcfg.restLength,
      compression: 0,
      overTravel: 0,
      load: 0,
      omega: 0,
      spin: 0,
      steerAngle: 0,
      slipRatio: 0,
      slipAngle: 0,
      saturation: 0,
      driveTorque: 0,
      fx: 0,
      fy: 0,
      surface: 'asphalt',
    }));

    this._rays = this.wheels.map(() => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }));
    this.drivetrain = new Drivetrain(cfg.engine);

    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this._reverseHold = 0;
    this._prevVelValid = false;

    this.telemetry = {
      speed: 0, speedKmh: 0, forwardSpeed: 0,
      rpm: cfg.engine.idleRpm, gear: 1, shifting: false,
      throttle: 0, brake: 0, steer: 0, handbrake: 0,
      grounded: 4, rearSlip: 0, frontSlip: 0,
      gLat: 0, gLong: 0, surface: 'asphalt',
    };
  }

  get forward() { return _fwd; }

  update(dt, input) {
    const cfg = this.cfg;
    const body = this.body;
    const world = this.physics.world;

    // Rapier lar påførte krefter stå til de nullstilles. Alt vi regner ut
    // nedenfor gjelder bare dette steget, så gammelt oppsamlet må ryddes bort
    // først — ellers legger fjærkreftene seg oppå hverandre.
    body.resetForces(false);
    body.resetTorques(false);

    const t = body.translation();
    const r = body.rotation();
    this.position.set(t.x, t.y, t.z);
    this.quaternion.set(r.x, r.y, r.z, r.w);
    _pos.copy(this.position);
    _q.copy(this.quaternion);

    _fwd.set(0, 0, 1).applyQuaternion(_q);
    _up.set(0, 1, 0).applyQuaternion(_q);
    // Bilen peker mot +Z med +Y opp. I et høyrehåndssystem ligger da førerens
    // høyre side mot −X, ikke +X — står du og ser mot +Z, peker høyre hånd dit.
    _right.set(-1, 0, 0).applyQuaternion(_q);

    const lv = body.linvel();
    const vel = _bodyVel.set(lv.x, lv.y, lv.z);
    const speed = vel.length();
    const forwardSpeed = vel.dot(_fwd);

    const { throttle, brake } = this._resolveGearDirection(dt, input, forwardSpeed);
    this._applySteering(input, forwardSpeed);

    this._castSuspension(world, cfg);
    const grounded = this.wheels.reduce((n, w) => n + (w.grounded ? 1 : 0), 0);

    this._applyAxle(0, 1);
    this._applyAxle(2, 3);

    this._applyTires(dt, cfg, throttle, brake, input.handbrake, speed);
    this._applyAero(cfg, vel, speed);

    // Uten litt demping i lufta roterer bilen ukontrollert etter et hopp.
    if (grounded === 0) {
      const av = body.angvel();
      body.applyTorqueImpulse(
        { x: -av.x * 110 * dt, y: -av.y * 45 * dt, z: -av.z * 170 * dt },
        true,
      );
    }

    this._updateTelemetry(dt, vel, speed, forwardSpeed, throttle, brake, input, grounded);
  }

  /**
   * W og S betyr forskjellige ting avhengig av om bilen står i revers.
   * Holder du bremsen inne når bilen står stille, legges reversgiret inn.
   */
  _resolveGearDirection(dt, input, forwardSpeed) {
    const dtr = this.drivetrain;
    const stopped = Math.abs(forwardSpeed) < 0.8;

    if (dtr.gear > 0 && stopped && input.brakeRaw > 0.5 && input.throttleRaw < 0.1) {
      this._reverseHold += dt;
      if (this._reverseHold > 0.3) { dtr.setGear(0); this._reverseHold = 0; }
    } else if (dtr.gear === 0 && stopped && input.throttleRaw > 0.5) {
      dtr.setGear(1);
      this._reverseHold = 0;
    } else {
      this._reverseHold = 0;
    }

    return dtr.gear === 0
      ? { throttle: input.brakeRaw, brake: input.throttleRaw }
      : { throttle: input.throttleRaw, brake: input.brakeRaw };
  }

  _applySteering(input, forwardSpeed) {
    const s = this.cfg.steering;
    const ratio = Math.max(s.minRatio, 1 / (1 + Math.abs(forwardSpeed) * s.speedFactor));

    // Styrevinkelen dreies om opp-aksen, og en positiv rotasjon der svinger mot
    // venstre — den vanlige konvensjonen i kjøretøydynamikk. Inndata er positiv
    // mot høyre, så tegnet snus her, ett sted, i stedet for spredt utover.
    const angle = -input.steer * s.maxAngle * ratio;

    for (const w of this.wheels) {
      if (!w.cfg.steered) { w.steerAngle = 0; continue; }
      // Ackermann: hjulet på innsiden av svingen følger en trangere radius
      // og må dermed stå litt skarpere enn hjulet på utsiden.
      const inner = Math.sign(w.cfg.pos.x) === Math.sign(angle);
      w.steerAngle = angle * (inner ? 1 + s.ackermann * 0.18 : 1 - s.ackermann * 0.14);
    }
  }

  _castSuspension(world, cfg) {
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i];
      const c = w.cfg;

      _attach.set(c.pos.x, c.pos.y, c.pos.z).applyQuaternion(_q).add(_pos);
      _down.copy(_up).multiplyScalar(-1);

      const ray = this._rays[i];
      ray.origin.x = _attach.x; ray.origin.y = _attach.y; ray.origin.z = _attach.z;
      ray.dir.x = _down.x; ray.dir.y = _down.y; ray.dir.z = _down.z;

      const maxToi = c.restLength + c.maxDroop + cfg.wheelRadius;
      const hit = world.castRayAndGetNormal(
        ray, maxToi, true, undefined, undefined, this.collider, this.body,
      );

      if (!hit) {
        w.grounded = false;
        w.load = 0;
        w.compression = 0;
        w.overTravel = 0;
        w.saturation = 0;
        w.suspensionLength = c.restLength + c.maxDroop;
        w.wheelCenter.copy(_attach).addScaledVector(_down, w.suspensionLength);
        continue;
      }

      const toi = hit.timeOfImpact !== undefined ? hit.timeOfImpact : hit.toi;
      w.grounded = true;
      w.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
      w.surface = this.physics.surfaceOf(hit.collider.handle);

      const raw = toi - cfg.wheelRadius;
      const shortest = c.restLength - c.maxBump;
      const length = clamp(raw, shortest, c.restLength + c.maxDroop);
      w.suspensionLength = length;
      w.compression = c.restLength - length;
      // Hvor langt karosseriet har presset seg forbi fjæringens bunn. Fjæra
      // slutter å vokse her; gummistoppen tar over.
      w.overTravel = Math.max(0, shortest - raw);
      w.wheelCenter.copy(_attach).addScaledVector(_down, length);
      w.contactPoint.copy(w.wheelCenter).addScaledVector(_down, cfg.wheelRadius);
    }
  }

  /**
   * Fjærkraft, demping og krengningsstag for én aksel. Staget kobler de to
   * hjulene sammen: krenger karosseriet, presser det ned på den lette siden og
   * opp på den tunge, og motvirker dermed rullingen.
   */
  _applyAxle(indexLeft, indexRight) {
    const wl = this.wheels[indexLeft];
    const wr = this.wheels[indexRight];
    const arb = wl.cfg.antiRoll * (wl.compression - wr.compression);

    for (const [w, sign] of [[wl, 1], [wr, -1]]) {
      if (!w.grounded) { w.load = 0; continue; }

      velocityAt(this.body, w.contactPoint, _pv);
      const compressionRate = -_pv.dot(_up);
      const damping = compressionRate > 0 ? w.cfg.dampBump : w.cfg.dampRebound;

      let force = Math.max(
        0,
        w.cfg.stiffness * w.compression + damping * compressionRate + arb * sign,
      );

      // Gummistoppen er progressiv: den blir raskt stivere jo dypere den
      // trykkes, akkurat som en ekte bumpstopp. Noen få millimeter holder
      // hele bilens vekt, så karosseriet når aldri asfalten.
      if (w.overTravel > 0) {
        const d = w.overTravel;
        force += w.cfg.bumpStop * d * (1 + d / BUMP_STOP_KNEE);
        if (compressionRate > 0) force += w.cfg.bumpStopDamp * compressionRate;
      }

      w.load = force;

      _force.copy(_up).multiplyScalar(force);
      this.body.addForceAtPoint(_force, w.contactPoint, true);
    }
  }

  _applyTires(dt, cfg, throttle, brake, handbrake, speed) {
    const driven = this.wheels.filter((w) => w.cfg.driven);

    let avgOmega = 0;
    for (const w of driven) avgOmega += w.omega;
    avgOmega /= driven.length;

    const { drive, engineBrake } = this.drivetrain.update(dt, throttle, avgOmega, speed);
    const reflected = this.drivetrain.reflectedInertia(driven.length);

    // Sperredifferensial: kobler bakhjulene slik at det hjulet som spinner
    // gir fra seg moment til det som fortsatt har grep.
    const d = cfg.differential;
    const lsd = clamp(-(driven[0].omega - driven[1].omega) * d.lsdCoupling, -d.maxTransfer, d.maxTransfer);
    driven[0].driveTorque = drive / 2 + lsd;
    driven[1].driveTorque = drive / 2 - lsd;
    for (const w of this.wheels) if (!w.cfg.driven) w.driveTorque = 0;

    const substeps = cfg.wheelSubsteps;
    const hdt = dt / substeps;

    for (const w of this.wheels) {
      const c = w.cfg;
      const inertia = cfg.wheelInertia + (c.driven ? reflected : 0);
      const brakeTorque =
        brake * cfg.brakes.maxTorque * c.brakeShare +
        (c.handbrake ? handbrake * cfg.brakes.handbrakeTorque * 0.5 : 0) +
        (c.driven ? engineBrake / driven.length : 0);

      if (!w.grounded) {
        w.omega += (w.driveTorque / inertia) * dt;
        applyBrake(w, brakeTorque, inertia, dt);
        w.slipRatio = 0; w.slipAngle = 0; w.saturation = 0; w.fx = 0; w.fy = 0;
        w.spin += w.omega * dt;
        continue;
      }

      // Hjulets rulleretning, dreid av rattutslaget og lagt ned i bakkeplanet.
      _steerQ.setFromAxisAngle(_up, w.steerAngle);
      _wf.copy(_fwd).applyQuaternion(_steerQ);
      _wf.addScaledVector(w.normal, -_wf.dot(w.normal));
      if (_wf.lengthSq() < 1e-8) continue;
      _wf.normalize();
      _wr.crossVectors(w.normal, _wf).normalize();

      velocityAt(this.body, w.contactPoint, _pv);
      const vLong = _pv.dot(_wf);
      const vLat = _pv.dot(_wr);

      const surface = SURFACES[w.surface] ?? SURFACES.asphalt;
      const vRef = Math.max(Math.abs(vLong), cfg.tireRefSpeed);
      w.slipAngle = Math.atan2(-vLat, Math.max(Math.abs(vLong), 1.2));

      // Hjulets rotasjon er stiv sammenlignet med bilens masse, så den
      // integreres i flere små steg per fysikksteg.
      let fx = 0, fy = 0, sat = 0;
      for (let s = 0; s < substeps; s++) {
        const kappa = (w.omega * cfg.wheelRadius - vLong) / vRef;
        const res = w.tire.forces(kappa, w.slipAngle, w.load, surface.grip);
        fx += res.fx; fy += res.fy; sat += res.saturation;

        const rolling =
          cfg.rollingResistance * surface.rollingScale * w.load * cfg.wheelRadius;
        const net = w.driveTorque - res.fx * cfg.wheelRadius - Math.sign(w.omega) * rolling;

        w.omega += (net / inertia) * hdt;
        applyBrake(w, brakeTorque, inertia, hdt);
        w.slipRatio = kappa;
      }

      w.fx = fx / substeps;
      w.fy = fy / substeps;
      w.saturation = sat / substeps;
      w.spin += w.omega * dt;

      _force.copy(_wf).multiplyScalar(w.fx).addScaledVector(_wr, w.fy);
      this.body.addForceAtPoint(_force, w.contactPoint, true);
    }
  }

  _applyAero(cfg, vel, speed) {
    const a = cfg.aero;
    const q = 0.5 * a.airDensity * speed * speed;

    if (speed > 0.5) {
      _force.copy(vel).multiplyScalar(-(q * a.cdA) / speed);
      this.body.addForce(_force, true);
    }

    const downforce = q * a.clA;
    if (downforce > 1) {
      _point.set(0, 0, a.frontPointZ).applyQuaternion(_q).add(_pos);
      _force.copy(_up).multiplyScalar(-downforce * a.balance);
      this.body.addForceAtPoint(_force, _point, true);

      _point.set(0, 0, a.rearPointZ).applyQuaternion(_q).add(_pos);
      _force.copy(_up).multiplyScalar(-downforce * (1 - a.balance));
      this.body.addForceAtPoint(_force, _point, true);
    }
  }

  _updateTelemetry(dt, vel, speed, forwardSpeed, throttle, brake, input, grounded) {
    const t = this.telemetry;

    if (this._prevVelValid) {
      _accel.subVectors(vel, _prevVel).divideScalar(dt * 9.81);
      const lat = _accel.dot(_right);
      const lon = _accel.dot(_fwd);
      t.gLat += (lat - t.gLat) * 0.12;
      t.gLong += (lon - t.gLong) * 0.12;
    }
    _prevVel.copy(vel);
    this._prevVelValid = true;

    t.speed = speed;
    t.speedKmh = speed * 3.6;
    t.forwardSpeed = forwardSpeed;
    t.rpm = this.drivetrain.rpm;
    t.gear = this.drivetrain.gear;
    t.shifting = this.drivetrain.shifting;
    t.throttle = throttle;
    t.brake = brake;
    t.steer = input.steer;
    t.handbrake = input.handbrake;
    t.grounded = grounded;
    t.frontSlip = Math.max(this.wheels[0].saturation, this.wheels[1].saturation);
    t.rearSlip = Math.max(this.wheels[2].saturation, this.wheels[3].saturation);
    t.surface = this.wheels[2].surface;
  }

  reset(spawn = this.spawn) {
    this.body.setTranslation({ x: spawn.x, y: spawn.y, z: spawn.z }, true);
    this.body.setRotation(spawn.q ?? { x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (const w of this.wheels) {
      w.omega = 0; w.spin = 0; w.compression = 0; w.load = 0;
      w.slipRatio = 0; w.slipAngle = 0; w.saturation = 0;
    }
    this.drivetrain.reset();
    this._prevVelValid = false;
    this._reverseHold = 0;
  }
}
