/**
 * Forenklet Pacejka-dekkmodell.
 *
 * Kreftene kommer fra "magic formula", som gir den karakteristiske kurven der
 * grepet stiger bratt med slipp, topper seg, og deretter faller av — det er
 * nettopp avfallet etter toppen som gjør at bilen kan miste grepet gradvis
 * istedenfor å slå av og på.
 */

export function magicFormula(slip, B, C, D, E) {
  const bs = B * slip;
  return D * Math.sin(C * Math.atan(bs - E * (bs - Math.atan(bs))));
}

export class Tire {
  constructor(cfg) {
    this.mu = cfg.mu;
    this.nominalLoad = cfg.nominalLoad;
    this.loadSensitivity = cfg.loadSensitivity;
    this.Bx = cfg.Bx; this.Cx = cfg.Cx; this.Ex = cfg.Ex;
    this.By = cfg.By; this.Cy = cfg.Cy; this.Ey = cfg.Ey;
  }

  /**
   * Et hardt belastet dekk gir mindre grep per newton enn et lett belastet.
   * Dette er grunnen til at vektforskyvning i det hele tatt endrer balansen:
   * hjulet som får mer last vinner mindre grep enn hjulet som avlastes mister.
   */
  frictionAt(load) {
    const rel = load / this.nominalLoad;
    return Math.max(0.35, this.mu * (1 - this.loadSensitivity * (rel - 1)));
  }

  /**
   * @param {number} slipRatio  langsgående slipp: (ω·r − v) / v
   * @param {number} slipAngle  sidevinkel i radianer
   * @param {number} load       vertikal last i newton
   * @param {number} gripScale  underlagets grep (asfalt = 1, gress ≈ 0.5)
   */
  forces(slipRatio, slipAngle, load, gripScale = 1) {
    if (load <= 0) return { fx: 0, fy: 0, saturation: 0, peak: 0 };

    const mu = this.frictionAt(load) * gripScale;
    const peak = mu * load;

    let fx = magicFormula(slipRatio, this.Bx, this.Cx, peak, this.Ex);
    let fy = magicFormula(slipAngle, this.By, this.Cy, peak, this.Ey);

    // Friksjonssirkel: dekket har ett grepsbudsjett å dele mellom akselerasjon
    // og sving. Bremser du hardt midt i en sving, blir det lite igjen til styring.
    const total = Math.hypot(fx, fy);
    if (total > peak && total > 1e-6) {
      const scale = peak / total;
      fx *= scale;
      fy *= scale;
    }

    return { fx, fy, peak, saturation: peak > 0 ? Math.min(total / peak, 1) : 0 };
  }
}
