/**
 * Berøringsstyring.
 *
 * Rattet er en relativ dragflate: du legger tommelen hvor som helst i venstre
 * halvdel, og utslaget følger hvor langt du drar fra der du satte den ned. Det
 * er mer treffsikkert enn en fast skyvebryter, fordi du slipper å finne igjen
 * et bestemt punkt på skjermen mens du kjører.
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class TouchControls {
  constructor(root = document) {
    this.el = {
      layer: root.getElementById('touch'),
      steerZone: root.getElementById('touch-steer'),
      knob: root.getElementById('touch-knob'),
      throttle: root.getElementById('touch-gas'),
      brake: root.getElementById('touch-brake'),
      handbrake: root.getElementById('touch-hand'),
    };

    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = 0;
    this.actions = new Set();

    this._steerPointer = null;
    this._steerOrigin = 0;

    this.el.layer.classList.add('on');
    this._bindSteering();
    this._bindPedal(this.el.throttle, 'throttle');
    this._bindPedal(this.el.brake, 'brake');
    this._bindPedal(this.el.handbrake, 'handbrake');

    for (const [id, action] of [['touch-cam', 'camera'], ['touch-reset', 'reset'],
                                  ['touch-mute', 'mute'], ['touch-track', 'track'],
                                  ['touch-pause', 'pause']]) {
      const btn = root.getElementById(id);
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.actions.add(action);
        btn.classList.add('down');
      });
      btn.addEventListener('pointerup', () => btn.classList.remove('down'));
      btn.addEventListener('pointercancel', () => btn.classList.remove('down'));
    }
  }

  get range() {
    return Math.max(70, Math.min(window.innerWidth, window.innerHeight) * 0.22);
  }

  _bindSteering() {
    const zone = this.el.steerZone;

    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._steerPointer = e.pointerId;
      this._steerOrigin = e.clientX;
      zone.setPointerCapture(e.pointerId);
      zone.classList.add('down');
    });

    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._steerPointer) return;
      this.steer = clamp((e.clientX - this._steerOrigin) / this.range, -1, 1);
      this.el.knob.style.transform = `translateX(${(this.steer * 46).toFixed(1)}px)`;
    });

    const release = (e) => {
      if (e.pointerId !== this._steerPointer) return;
      this._steerPointer = null;
      this.steer = 0;
      this.el.knob.style.transform = 'translateX(0px)';
      zone.classList.remove('down');
    };
    zone.addEventListener('pointerup', release);
    zone.addEventListener('pointercancel', release);
  }

  _bindPedal(el, field) {
    const press = (e) => {
      e.preventDefault();
      this[field] = 1;
      el.classList.add('down');
      el.setPointerCapture(e.pointerId);
    };
    const release = () => {
      this[field] = 0;
      el.classList.remove('down');
    };
    el.addEventListener('pointerdown', press);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointerleave', release);
  }

  /** Henter og fjerner en engangshandling (kamera, reset, pause). */
  consume(action) {
    if (!this.actions.has(action)) return false;
    this.actions.delete(action);
    return true;
  }

  get steering() {
    return this._steerPointer === null ? null : this.steer;
  }
}

export function hasTouch() {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}
