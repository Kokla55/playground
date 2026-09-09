/**
 * Fast tidssteg for fysikken, fri oppdateringsrate for grafikken.
 *
 * Bilfysikk med stive fjærer og dekk er følsom for varierende tidssteg — kjører
 * den i takt med skjermen, endrer bilen oppførsel når bildefrekvensen svinger.
 * Derfor kjøres simuleringen alltid på faste steg, uansett hva skjermen gjør.
 */
export class Loop {
  constructor({ fixedStep = 1 / 120, maxSubSteps = 8, update, render }) {
    this.fixedStep = fixedStep;
    this.maxSubSteps = maxSubSteps;
    this.update = update;
    this.render = render;

    this.running = false;
    this.paused = false;
    this.accumulator = 0;
    this.lastTime = 0;
    this.elapsed = 0;
    this.fps = 0;
    this._fpsAccum = 0;
    this._fpsFrames = 0;

    this._frame = this._frame.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this._frame);
  }

  stop() { this.running = false; }

  _frame(now) {
    if (!this.running) return;
    requestAnimationFrame(this._frame);

    // Et tak på frame-tiden hindrer at spillet "spoler" etter en lang pause.
    const frameTime = Math.min((now - this.lastTime) / 1000, 0.25);
    this.lastTime = now;

    this._fpsAccum += frameTime;
    this._fpsFrames++;
    if (this._fpsAccum >= 0.5) {
      this.fps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0;
      this._fpsFrames = 0;
    }

    if (!this.paused) {
      this.accumulator += frameTime;
      let steps = 0;
      while (this.accumulator >= this.fixedStep && steps < this.maxSubSteps) {
        this.update(this.fixedStep);
        this.accumulator -= this.fixedStep;
        this.elapsed += this.fixedStep;
        steps++;
      }
      // Henger vi hopelløst etter, kastes restgjelden heller enn å spiralere.
      if (steps === this.maxSubSteps) this.accumulator = 0;
    }

    this.render(frameTime);
  }
}
