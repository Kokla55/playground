/**
 * Tastatur og gamepad. Modulen kjenner ikke til bilen — den leverer bare
 * normaliserte akser, slik at fysikken kan testes uten et tastatur i det hele tatt.
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const KEY_MAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'handbrake',
};

const ACTION_KEYS = {
  KeyR: 'reset',
  KeyC: 'camera',
  Escape: 'pause',
  KeyH: 'help',
};

export class VehicleInput {
  constructor(cfg, target = window) {
    this.cfg = cfg;
    this.keys = { up: 0, down: 0, left: 0, right: 0, handbrake: 0 };
    this.pressed = new Set();
    this.gamepadIndex = null;
    this.touch = null;

    // Utdata som fysikken leser.
    this.throttleRaw = 0;
    this.brakeRaw = 0;
    this.steer = 0;
    this.handbrake = 0;

    this._onKeyDown = (e) => {
      if (KEY_MAP[e.code]) { this.keys[KEY_MAP[e.code]] = 1; e.preventDefault(); }
      if (ACTION_KEYS[e.code] && !e.repeat) { this.pressed.add(ACTION_KEYS[e.code]); e.preventDefault(); }
    };
    this._onKeyUp = (e) => {
      if (KEY_MAP[e.code]) { this.keys[KEY_MAP[e.code]] = 0; e.preventDefault(); }
    };
    this._onBlur = () => {
      for (const k of Object.keys(this.keys)) this.keys[k] = 0;
    };
    this._onGamepad = (e) => { this.gamepadIndex = e.gamepad.index; };

    target.addEventListener('keydown', this._onKeyDown);
    target.addEventListener('keyup', this._onKeyUp);
    target.addEventListener('blur', this._onBlur);
    target.addEventListener('gamepadconnected', this._onGamepad);
  }

  /** Sjekker og fjerner en engangshendelse (R, C, Esc — eller knapp på skjermen). */
  consume(action) {
    if (this.touch && this.touch.consume(action)) return true;
    if (!this.pressed.has(action)) return false;
    this.pressed.delete(action);
    return true;
  }

  get hasGamepad() { return this.gamepadIndex !== null; }

  update(dt) {
    let throttle = this.keys.up;
    let brake = this.keys.down;
    let steerTarget = this.keys.right - this.keys.left;
    let handbrake = this.keys.handbrake;
    let analog = false;

    const pad = this._readGamepad();
    if (pad) {
      throttle = Math.max(throttle, pad.throttle);
      brake = Math.max(brake, pad.brake);
      handbrake = Math.max(handbrake, pad.handbrake);
      if (Math.abs(pad.steer) > 0.02) { steerTarget = pad.steer; analog = true; }
    }

    if (this.touch) {
      throttle = Math.max(throttle, this.touch.throttle);
      brake = Math.max(brake, this.touch.brake);
      handbrake = Math.max(handbrake, this.touch.handbrake);
      const touchSteer = this.touch.steering;
      if (touchSteer !== null) { steerTarget = touchSteer; analog = true; }
    }

    this.throttleRaw = throttle;
    this.brakeRaw = brake;
    this.handbrake = handbrake;

    const s = this.cfg.steering;
    if (analog) {
      // Tommel og stikke er allerede proporsjonale — de trenger bare litt
      // utjevning, ikke en kunstig rattfart som ville føltes treg.
      this.steer += (steerTarget - this.steer) * Math.min(1, dt * 16);
    } else {
      // Tastatur gir bare av/på, så rattet får en fart å bevege seg med. Det
      // senterer raskere enn det legger på utslag, slik ekte styring gjør.
      const goingBack = steerTarget === 0 || Math.sign(steerTarget) !== Math.sign(this.steer);
      const rate = (goingBack ? s.returnRate : s.rate) * dt;
      this.steer += clamp(steerTarget - this.steer, -rate, rate);
    }
    this.steer = clamp(this.steer, -1, 1);
  }

  _readGamepad() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    const pad = this.gamepadIndex !== null ? pads[this.gamepadIndex] : Array.from(pads).find(Boolean);
    if (!pad) return null;

    const deadzone = (v) => (Math.abs(v) < 0.12 ? 0 : v);
    return {
      steer: deadzone(pad.axes[0] ?? 0),
      throttle: pad.buttons[7]?.value ?? 0,
      brake: pad.buttons[6]?.value ?? 0,
      handbrake: pad.buttons[0]?.pressed ? 1 : 0,
    };
  }

  dispose(target = window) {
    target.removeEventListener('keydown', this._onKeyDown);
    target.removeEventListener('keyup', this._onKeyUp);
    target.removeEventListener('blur', this._onBlur);
    target.removeEventListener('gamepadconnected', this._onGamepad);
  }
}
