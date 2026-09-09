/**
 * Kart over banen med bilens posisjon.
 *
 * Kartet står i fast retning i stedet for å rotere med bilen. Et roterende kart
 * er lettere å følge i øyeblikket, men da mister man oversikten over hvor på
 * runden man er — og det er nettopp det dette skal vise. Den delen av runden du
 * allerede har kjørt tegnes opp i klar farge, så avstanden er noe du ser og
 * ikke må lese.
 */

const TRACK_COLOUR = 'rgba(232,237,242,.30)';
const DRIVEN_COLOUR = '#6ee7ff';
const CAR_COLOUR = '#ffffff';

export class MiniMap {
  constructor(path, { canvas, lapEl, distanceEl } = {}) {
    this.path = path;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.lapEl = lapEl;
    this.distanceEl = distanceEl;

    this.lap = 1;
    this.distance = 0;
    this._index = 0;
    this._accum = 0;
    this._size = 0;

    // Banen normaliseres én gang til 0–1, og skaleres først når den tegnes.
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const f of path.frames) {
      minX = Math.min(minX, f.position.x); maxX = Math.max(maxX, f.position.x);
      minZ = Math.min(minZ, f.position.z); maxZ = Math.max(maxZ, f.position.z);
    }
    const span = Math.max(maxX - minX, maxZ - minZ);
    this._offsetX = (minX + maxX) / 2;
    this._offsetZ = (minZ + maxZ) / 2;
    this._span = span;

    this.points = path.frames.map((f) => ({
      x: (f.position.x - this._offsetX) / span,
      y: (f.position.z - this._offsetZ) / span,
    }));
  }

  /** Kartkoordinat til pikselkoordinat. */
  _project(p, size) {
    const pad = size * 0.10;
    const inner = size - pad * 2;
    return [pad + (p.x + 0.5) * inner, pad + (p.y + 0.5) * inner];
  }

  /**
   * Nærmeste punkt på banen. Søket starter der bilen var sist, så det koster
   * nesten ingenting — bare når bilen har hoppet (reset) må hele banen gjennomsøkes.
   */
  _nearest(x, z) {
    const n = this.path.samples;
    const frames = this.path.frames;
    let best = this._index, bestD = Infinity;

    for (let k = -70; k <= 70; k++) {
      const i = ((this._index + k) % n + n) % n;
      const p = frames[i].position;
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }

    if (bestD > 120 * 120) {
      for (let i = 0; i < n; i += 5) {
        const p = frames[i].position;
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    return best;
  }

  update(dt, vehicle) {
    const previous = this._index;
    this._index = this._nearest(vehicle.position.x, vehicle.position.z);

    // Rundetelling: hopper avstanden fra slutten av runden til begynnelsen,
    // har bilen passert mållinja.
    const before = this.path.frames[previous].distance / this.path.length;
    const now = this.path.frames[this._index].distance / this.path.length;
    if (before > 0.75 && now < 0.25) this.lap++;
    else if (before < 0.25 && now > 0.75) this.lap = Math.max(1, this.lap - 1);

    this.distance = this.path.frames[this._index].distance;

    this._accum += dt;
    if (this._accum < 1 / 25) return;
    this._accum = 0;
    this._draw(vehicle);
  }

  _draw(vehicle) {
    const canvas = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = canvas.clientWidth;
    if (!size) return;

    if (this._size !== size) {
      canvas.width = canvas.height = Math.round(size * dpr);
      this._size = size;
    }

    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, size, size);

    const points = this.points;
    const n = points.length;

    const stroke = (from, count, colour, width) => {
      if (count <= 0) return;
      c.strokeStyle = colour;
      c.lineWidth = width;
      c.lineJoin = c.lineCap = 'round';
      c.beginPath();
      for (let k = 0; k <= count; k++) {
        const [px, py] = this._project(points[(from + k) % n], size);
        if (k === 0) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.stroke();
    };

    // Hele runden, dempet — og den kjørte delen oppå i klar farge.
    stroke(0, n, TRACK_COLOUR, size * 0.055);
    const start = Math.round(n * 0.06);
    let travelled = this._index - start;
    if (travelled < 0) travelled += n;
    stroke(start, travelled, DRIVEN_COLOUR, size * 0.045);

    // Mållinje.
    const [sx, sy] = this._project(points[start], size);
    c.strokeStyle = 'rgba(232,237,242,.75)';
    c.lineWidth = 1.6;
    c.beginPath();
    c.arc(sx, sy, size * 0.045, 0, Math.PI * 2);
    c.stroke();

    // Bilen, som en pil i kjøreretningen.
    const [cx, cy] = this._project(points[this._index], size);
    const fwd = vehicle.forward;
    const heading = Math.atan2(fwd.x, fwd.z);

    c.save();
    c.translate(cx, cy);
    c.rotate(-heading + Math.PI / 2);
    c.fillStyle = CAR_COLOUR;
    c.beginPath();
    c.moveTo(size * 0.055, 0);
    c.lineTo(-size * 0.032, size * 0.036);
    c.lineTo(-size * 0.032, -size * 0.036);
    c.closePath();
    c.fill();
    c.restore();

    if (this.lapEl) this.lapEl.textContent = String(this.lap);
    if (this.distanceEl) {
      this.distanceEl.textContent =
        `${Math.round(this.distance)} / ${Math.round(this.path.length)} m`;
    }
  }

  reset() {
    this.lap = 1;
    this._index = Math.round(this.path.samples * 0.06);
    this.distance = this.path.frames[this._index].distance;
  }
}
