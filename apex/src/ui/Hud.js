/**
 * Instrumentvisning for fase 1. Den er bevisst måleteknisk: den skal gjøre det
 * mulig å se om fysikken oppfører seg riktig — slipp, last, underlag, g-krefter.
 * Det filmatiske racing-grensesnittet kommer i fase 10.
 */

const TICK_COUNT = 9;

export class Hud {
  constructor(cfg, root = document) {
    this.cfg = cfg;
    this.el = {
      speed: root.getElementById('hud-speed'),
      gear: root.getElementById('hud-gear'),
      rpmFill: root.getElementById('hud-rpm-fill'),
      rpmValue: root.getElementById('hud-rpm-value'),
      rpmTicks: root.getElementById('hud-rpm-ticks'),
      surface: root.getElementById('hud-surface'),
      grip: root.getElementById('hud-grip'),
      gforce: root.getElementById('hud-gforce'),
      wheels: root.getElementById('hud-wheels'),
      fps: root.getElementById('hud-fps'),
      gauge: root.getElementById('hud-gauge'),
    };

    this._buildTicks();
    this._lastGear = null;
  }

  _buildTicks() {
    if (!this.el.rpmTicks) return;
    const redline = this.cfg.engine.redline;
    for (let i = 0; i < TICK_COUNT; i++) {
      const rpm = (i / (TICK_COUNT - 1)) * redline;
      const tick = document.createElement('span');
      tick.className = 'tick' + (rpm >= this.cfg.engine.upshiftRpm ? ' red' : '');
      tick.style.left = `${(i / (TICK_COUNT - 1)) * 100}%`;
      this.el.rpmTicks.appendChild(tick);
    }
  }

  update(t, fps) {
    const e = this.el;
    const redline = this.cfg.engine.redline;

    e.speed.textContent = Math.round(Math.abs(t.speedKmh));

    const gear = t.gear === 0 ? 'R' : String(t.gear);
    if (gear !== this._lastGear) {
      e.gear.textContent = gear;
      this._lastGear = gear;
    }
    e.gear.classList.toggle('shifting', t.shifting);

    const rpmT = Math.min(t.rpm / redline, 1);
    e.rpmFill.style.transform = `scaleX(${rpmT.toFixed(4)})`;
    e.rpmFill.classList.toggle('limiter', t.rpm >= this.cfg.engine.upshiftRpm);
    e.rpmValue.textContent = Math.round(t.rpm);

    // Ytre ring viser hvor mye av grepet som er brukt bak — nyttig for å se
    // nøyaktig når bilen begynner å skli.
    e.gauge.style.setProperty('--slip', Math.round(t.rearSlip * 100));

    e.surface.textContent = t.surface;
    e.grip.textContent = `${Math.round(t.frontSlip * 100)}% / ${Math.round(t.rearSlip * 100)}%`;
    e.gforce.textContent = `${t.gLong >= 0 ? '+' : ''}${t.gLong.toFixed(2)} / ${t.gLat >= 0 ? '+' : ''}${t.gLat.toFixed(2)}`;
    e.wheels.textContent = `${t.grounded}/4`;
    e.fps.textContent = Math.round(fps);
  }
}
