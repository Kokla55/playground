import * as THREE from 'three';

/**
 * Kupeen sett fra førerplass.
 *
 * Alt her ligger på tegnelag 1. Speilkameraene rendrer bare lag 0, slik at
 * interiøret ikke stenger for utsikten bakover når speilene tegnes.
 *
 * Bilen er venstrestyrt. Siden bilen peker mot +Z med +Y opp, ligger førerens
 * venstre side mot +X — og førerplassen dermed også.
 *
 * Høydene er oppgitt over bakken og trekkes ned til tyngdepunktet der de brukes,
 * slik at tallene er lette å kjenne igjen fra en ekte bil.
 */

export const COCKPIT_LAYER = 1;

const DRIVER_X = 0.32;

/** Instrumentpanelet tegnes på et lerret og legges som tekstur på en flate. */
class InstrumentCluster {
  constructor(cfg) {
    this.cfg = cfg;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 256;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this._accum = 0;
    this.draw({ speedKmh: 0, rpm: cfg.engine.idleRpm, gear: 1, gLat: 0 });
  }

  update(dt, telemetry) {
    // 20 oppdateringer i sekundet holder; lerretet er dyrt å laste opp hver frame.
    this._accum += dt;
    if (this._accum < 0.05) return;
    this._accum = 0;
    this.draw(telemetry);
    this.texture.needsUpdate = true;
  }

  /**
   * Rattkransen skjærer over den nedre halvdelen av displayet sett fra
   * førersetet. Derfor ligger fart, gir og turtellerstolpe i øvre del, og bare
   * de sekundære tallene nederst der de kan bli dekket.
   */
  draw(t) {
    const c = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const redline = this.cfg.engine.redline;
    const limiter = t.rpm >= this.cfg.engine.upshiftRpm;

    c.fillStyle = '#05070b';
    c.fillRect(0, 0, W, H);

    // Turtellerstolpe langs toppen.
    const bx = 26, by = 16, bw = W - 52, bh = 16;
    c.fillStyle = 'rgba(160,180,205,.16)';
    c.fillRect(bx, by, bw, bh);
    c.fillStyle = limiter ? '#ff5470' : '#6ee7ff';
    c.fillRect(bx, by, bw * Math.min(t.rpm / redline, 1), bh);

    c.fillStyle = 'rgba(255,84,112,.55)';
    c.fillRect(bx + bw * (this.cfg.engine.upshiftRpm / redline), by - 3, 2, bh + 6);

    c.fillStyle = 'rgba(200,215,235,.35)';
    for (let i = 1; i < 8; i++) c.fillRect(bx + (bw * i) / 8, by + bh + 3, 1, 5);

    // Fart, stort og høyt oppe.
    c.textAlign = 'right';
    c.fillStyle = '#eaf1f8';
    c.font = '600 100px "Barlow Condensed", system-ui, sans-serif';
    c.fillText(String(Math.round(Math.abs(t.speedKmh))), 268, 132);

    c.textAlign = 'left';
    c.font = '500 17px "IBM Plex Mono", monospace';
    c.fillStyle = '#7e8b9b';
    c.fillText('KM/T', 280, 132);

    // Gir, like høyt.
    c.textAlign = 'center';
    c.fillStyle = limiter ? '#ff5470' : '#6ee7ff';
    c.font = '600 108px "Barlow Condensed", system-ui, sans-serif';
    c.fillText(t.gear === 0 ? 'R' : String(t.gear), W - 74, 136);

    // Sekundære tall nederst — her kan rattet gjerne dekke.
    c.fillStyle = '#7e8b9b';
    c.font = '500 16px "IBM Plex Mono", monospace';
    c.textAlign = 'left';
    c.fillText(`${Math.round(t.rpm)} RPM`, 26, 214);
    c.textAlign = 'right';
    c.fillText(`${t.gLat >= 0 ? '+' : ''}${t.gLat.toFixed(2)} G`, W - 26, 214);
  }
}

function box(w, h, d, material) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
}

export class CockpitModel {
  constructor(cfg) {
    this.cfg = cfg;
    this.group = new THREE.Group();

    const o = cfg.ridePoint;
    const y = (aboveGround) => aboveGround - o;

    // Øyehøyde 1.18 m over bakken.
    //
    // Målt: hvor mye av skjermen kupeen dekker avhenger nesten bare av denne
    // høyden. Å flytte øyet framover mot frontruta gjorde det verre — da fyller
    // instrumentbrettet og panseret mer — mens hver centimeter oppover gir
    // synlig mer vei. På 1.10 dekket kupeen 74 % av en bred telefonskjerm; på
    // 1.18 er det 63 %, og utsikten rett fram gikk fra 29 til 38 %.
    //
    // Høyere enn dette går hodet gjennom taket: innsiden av taket ligger rundt
    // 1.30, og en fører sitter en drøy håndsbredd under det.
    this.eye = new THREE.Vector3(DRIVER_X, y(1.18), -0.05);

    const m = {
      dash: new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.88, metalness: 0.05 }),
      trim: new THREE.MeshStandardMaterial({ color: 0x1b1f26, roughness: 0.55, metalness: 0.35 }),
      leather: new THREE.MeshStandardMaterial({ color: 0x23272f, roughness: 0.94 }),
      accent: new THREE.MeshStandardMaterial({ color: 0x8a2f22, roughness: 0.7 }),
      rim: new THREE.MeshStandardMaterial({ color: 0x101318, roughness: 0.8 }),
    };
    this.materials = m;
    this.cluster = new InstrumentCluster(cfg);

    this._addDashboard(m, y);
    this._addSteeringWheel(m, y);
    this._addConsole(m, y);
    this._addSeats(m, y);
    this._addPillarsAndDoors(m, y);

    this.group.traverse((obj) => obj.layers.set(COCKPIT_LAYER));
  }

  _addDashboard(m, y) {
    const top = box(1.78, 0.09, 0.60, m.dash);
    top.position.set(0, y(0.70), 1.02);
    top.rotation.x = -0.10;
    this.group.add(top);

    const face = box(1.78, 0.34, 0.10, m.dash);
    face.position.set(0, y(0.56), 0.78);
    this.group.add(face);

    const lower = box(1.70, 0.32, 0.34, m.leather);
    lower.position.set(0, y(0.40), 0.86);
    this.group.add(lower);

    // Instrumenthuset er vippet mot føreren, og skjermen henger i det, slik at
    // de aldri kan komme i utakt med hverandre.
    const binnacle = box(0.50, 0.27, 0.20, m.trim);
    binnacle.position.set(DRIVER_X, y(0.91), 0.74);
    binnacle.rotation.x = -0.17;
    this.group.add(binnacle);

    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 0.21),
      new THREE.MeshBasicMaterial({
        map: this.cluster.texture, toneMapped: false, side: THREE.DoubleSide,
      }),
    );
    screen.position.set(0, 0, -0.104);
    screen.rotation.y = Math.PI;
    binnacle.add(screen);
    this.screen = screen;
  }

  _addSteeringWheel(m, y) {
    // Rattet sitter i en gruppe som er vippet som en rattstamme. Selve rattet
    // snurrer om sin egen akse inni den.
    const column = new THREE.Group();
    column.position.set(DRIVER_X, y(0.66), 0.50);
    column.rotation.x = 0.40;
    this.group.add(column);

    const wheel = new THREE.Group();
    column.add(wheel);
    this.wheel = wheel;

    wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.021, 12, 40), m.rim));

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.05, 16), m.trim);
    hub.rotation.x = Math.PI / 2;
    wheel.add(hub);

    for (const angle of [Math.PI * 0.5, Math.PI * 1.17, Math.PI * 1.83]) {
      const spoke = box(0.135, 0.030, 0.022, m.trim);
      spoke.position.set(Math.cos(angle) * 0.09, Math.sin(angle) * 0.09, 0);
      spoke.rotation.z = angle;
      wheel.add(spoke);
    }

    // Markør øverst på rattet, så det er tydelig hvor mye det er dreid.
    const marker = box(0.05, 0.022, 0.026, m.accent);
    marker.position.set(0, 0.168, -0.012);
    wheel.add(marker);

    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.30, 12), m.trim);
    stalk.rotation.x = Math.PI / 2;
    stalk.position.set(0, 0, 0.17);
    column.add(stalk);
  }

  _addConsole(m, y) {
    const tunnel = box(0.34, 0.28, 1.15, m.trim);
    tunnel.position.set(0, y(0.50), 0.14);
    this.group.add(tunnel);

    const centreScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.30, 0.20),
      new THREE.MeshBasicMaterial({ color: 0x0b1a24, toneMapped: false, side: THREE.DoubleSide }),
    );
    centreScreen.position.set(0, y(0.70), 0.735);
    centreScreen.rotation.set(0.20, Math.PI, 0);
    this.group.add(centreScreen);

    const shifter = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.030, 0.16, 10), m.rim);
    shifter.position.set(0, y(0.64), 0.30);
    this.group.add(shifter);
  }

  _addSeats(m, y) {
    for (const x of [DRIVER_X, -DRIVER_X]) {
      const base = box(0.50, 0.12, 0.54, m.leather);
      base.position.set(x, y(0.56), -0.28);
      this.group.add(base);

      const back = box(0.50, 0.74, 0.13, m.leather);
      back.position.set(x, y(0.94), -0.58);
      back.rotation.x = -0.16;
      this.group.add(back);

      for (const side of [1, -1]) {
        const bolster = box(0.07, 0.64, 0.15, m.accent);
        bolster.position.set(x + side * 0.215, y(0.92), -0.56);
        bolster.rotation.x = -0.16;
        this.group.add(bolster);
      }

      const headrest = box(0.24, 0.20, 0.11, m.leather);
      headrest.position.set(x, y(1.36), -0.66);
      this.group.add(headrest);
    }
  }

  _addPillarsAndDoors(m, y) {
    for (const x of [0.84, -0.84]) {
      // A-stolpen lener seg bakover med frontruta og innover mot taket.
      const pillar = box(0.065, 0.70, 0.085, m.dash);
      pillar.position.set(x, y(1.16), 0.90);
      pillar.rotation.set(-0.55, 0, Math.sign(x) * 0.16);
      this.group.add(pillar);

      const door = box(0.06, 0.44, 1.15, m.leather);
      door.position.set(x + Math.sign(x) * 0.05, y(0.74), 0.05);
      this.group.add(door);

      const armrest = box(0.11, 0.08, 0.48, m.trim);
      armrest.position.set(x - Math.sign(x) * 0.02, y(0.92), 0.02);
      this.group.add(armrest);
    }

    const floor = box(1.60, 0.04, 1.70, m.dash);
    floor.position.set(0, y(0.38), 0.05);
    this.group.add(floor);

    const bulkhead = box(1.62, 0.72, 0.06, m.dash);
    bulkhead.position.set(0, y(0.92), -0.88);
    this.group.add(bulkhead);
  }

  update(dt, vehicle, steerInput) {
    // Rundt halvannen omdreining fra låsing til låsing. Positivt utslag er
    // høyre, og sett fra førerplass blir det med klokka.
    this.wheel.rotation.z = steerInput * Math.PI * 1.5;
    this.cluster.update(dt, vehicle.telemetry);
  }
}
