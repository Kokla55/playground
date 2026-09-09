/**
 * Motor og girkasse.
 *
 * Turtallet følger drivhjulene gjennom gir og sluttutveksling. Ved svært lav
 * fart kobles det gradvis fra, slik at motoren kan gå på tomgang og bygge
 * turtall før bilen ruller — omtrent som en clutch som slipper.
 */

const RPM_PER_RAD = 60 / (2 * Math.PI);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Drivetrain {
  constructor(cfg) {
    this.cfg = cfg;
    this.gear = 1;              // 0 = revers, 1..n = framover
    this.rpm = cfg.idleRpm;
    this.shiftTimer = 0;
    this.shifting = false;
    this.clutch = 0;            // 0 = frikoblet, 1 = låst til hjulene
  }

  /** Samlet utveksling fra motor til hjul. Negativ i revers. */
  totalRatio(gear = this.gear) {
    const g = gear === 0 ? -this.cfg.reverseRatio : this.cfg.gearRatios[gear - 1];
    return g * this.cfg.finalDrive;
  }

  /** Dreiemomentet motoren yter ved et gitt turtall, rett fra kurven. */
  torqueAt(rpm) {
    if (rpm >= this.cfg.limiterRpm) return 0;

    const curve = this.cfg.torqueCurve;
    const r = clamp(rpm, curve[0][0], curve[curve.length - 1][0]);
    for (let i = 0; i < curve.length - 1; i++) {
      if (r <= curve[i + 1][0]) {
        const t = (r - curve[i][0]) / (curve[i + 1][0] - curve[i][0]);
        return curve[i][1] + (curve[i + 1][1] - curve[i][1]) * t;
      }
    }
    return curve[curve.length - 1][1];
  }

  /**
   * @returns {{drive: number, engineBrake: number}} drivmoment på akselen, og
   * motorbremsen som et eget positivt bremsemoment. Å skille dem er viktig:
   * motorbrems skal bremse hjulene, aldri dytte bilen den andre veien.
   */
  update(dt, throttle, drivenOmega, speed) {
    const ratio = this.totalRatio();

    const wheelRpm = Math.abs(drivenOmega) * RPM_PER_RAD * Math.abs(ratio);
    // Clutchen kobler gradvis inn mellom 0.5 og 3.5 m/s.
    this.clutch = clamp((speed - 0.5) / 3.0, 0, 1);
    const freeRpm = this.cfg.idleRpm + throttle * 2600;
    this.rpm = clamp(
      freeRpm + (wheelRpm - freeRpm) * this.clutch,
      this.cfg.idleRpm,
      this.cfg.redline,
    );

    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
      this.shifting = this.shiftTimer > 0;
      if (this.shifting) return { drive: 0, engineBrake: 0 };   // momentkutt under giring
    }

    this._autoShift(throttle);

    // Clutchen har en øvre grense for hvor mye moment den kan overføre mens den
    // slipper. Uten den ville en start fra stillstand dumpe hele motorens
    // dreiemoment rett i bakhjulene og bare koke dekkene.
    const capacity = this.cfg.clutchTorque * (0.30 + 0.70 * this.clutch);
    const transmitted = Math.min(this.torqueAt(this.rpm) * throttle, capacity);

    const engineBrake =
      this.cfg.engineBrakeTorque *
      (0.3 + 0.7 * (this.rpm / this.cfg.redline)) *
      (1 - throttle) * Math.abs(ratio) * this.clutch;

    return { drive: transmitted * ratio * this.cfg.efficiency, engineBrake };
  }

  _autoShift(throttle) {
    if (this.gear <= 0) return;
    const top = this.cfg.gearRatios.length;

    if (this.rpm >= this.cfg.upshiftRpm && this.gear < top) {
      this.gear++;
      this.shiftTimer = this.cfg.shiftTime;
      this.shifting = true;
    } else if (this.rpm <= this.cfg.downshiftRpm && this.gear > 1 && throttle < 0.85) {
      this.gear--;
      this.shiftTimer = this.cfg.shiftTime * 0.7;
      this.shifting = true;
    }
  }

  /** Treghet fra motor og drivlinje sett fra hjulet, gjennom kvadratet av utvekslingen. */
  reflectedInertia(drivenCount) {
    const ratio = this.totalRatio();
    return (this.cfg.inertia * ratio * ratio) / Math.max(1, drivenCount);
  }

  setGear(gear) {
    if (gear === this.gear) return;
    this.gear = gear;
    this.shiftTimer = this.cfg.shiftTime;
    this.shifting = true;
  }

  reset() {
    this.gear = 1;
    this.rpm = this.cfg.idleRpm;
    this.shiftTimer = 0;
    this.shifting = false;
    this.clutch = 0;
  }
}
