import * as THREE from 'three';

/**
 * Testområdet for fase 1: en lang asfaltstripe å måle akselerasjon og
 * bremselengde på, en sirkel å kjenne på grenseområdet i, ramper for å teste
 * fjæring og landing, kjegler for å bekrefte at kollisjoner virker, og gress
 * utenfor asfalten som faktisk har mindre grep.
 */

const STRIP_HALF_X = 80;
const STRIP_HALF_Z = 900;   // lang nok til å nå toppfart og bremse ned igjen

function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x2f6fb5) },
      horizonColor: { value: new THREE.Color(0xd8e3ec) },
      groundColor: { value: new THREE.Color(0x6d7482) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 groundColor;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 col = h > 0.0
          ? mix(horizonColor, topColor, pow(h, 0.55))
          : mix(horizonColor, groundColor, pow(-h, 0.4));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

function skyDome(radius = 3000) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), skyMaterial());
  mesh.frustumCulled = false;
  return mesh;
}

export class TestScene {
  constructor(physics) {
    this.physics = physics;
    this.RAPIER = physics.RAPIER;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xc4d2de, 320, 2200);
    this.dynamics = [];

    this.scene.add(skyDome());
    this._lighting();
    this._ground();
    this._markings();
    this._barriers();
    this._ramps();
    this._cones();

    this.spawn = { x: 0, y: 0.7, z: -800 };
  }

  _lighting() {
    const sun = new THREE.DirectionalLight(0xfff3e0, 3.1);
    sun.position.set(120, 190, 90);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 20;
    sun.shadow.camera.far = 620;
    const s = 130;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;

    this.scene.add(new THREE.HemisphereLight(0xa8c8ea, 0x4a4634, 1.15));
  }

  _ground() {
    // Gresset ligger i bunnen; asfalten er lagt en centimeter over, slik at
    // hjulenes stråler treffer riktig underlag der asfalten finnes.
    // Gresset skyves bakover i dybdebufferet. Uten det slåss de to nesten
    // sammenfallende flatene om hvem som er nærmest, og på lav kameravinkel
    // vinner gresset over asfalten hele veien bortover.
    const grassMat = new THREE.MeshStandardMaterial({
      color: 0x3f5730, roughness: 1,
      polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 4,
    });
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(3600, 3600), grassMat);
    grass.rotation.x = -Math.PI / 2;
    grass.receiveShadow = true;
    this.scene.add(grass);

    this.physics.addStatic(
      this.RAPIER.ColliderDesc.cuboid(1800, 1, 1800).setTranslation(0, -1, 0).setFriction(1),
      { surface: 'grass' },
    );

    const asphaltMat = new THREE.MeshStandardMaterial({ color: 0x2c2e33, roughness: 0.93 });
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(STRIP_HALF_X * 2, STRIP_HALF_Z * 2),
      asphaltMat,
    );
    strip.rotation.x = -Math.PI / 2;
    strip.position.y = 0.012;
    strip.receiveShadow = true;
    this.scene.add(strip);

    this.physics.addStatic(
      this.RAPIER.ColliderDesc.cuboid(STRIP_HALF_X, 1, STRIP_HALF_Z)
        .setTranslation(0, -0.988, 0)
        .setFriction(1),
      { surface: 'asphalt' },
    );

    // Sirkelbane for å kjenne på understyring og oversteering ved konstant radius.
    const pad = new THREE.Mesh(
      new THREE.RingGeometry(38, 40, 96),
      new THREE.MeshStandardMaterial({
        color: 0xdfe3e6, roughness: 0.7,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(0, 0.02, 90);
    this.scene.add(pad);
  }

  _markings() {
    const white = new THREE.MeshStandardMaterial({
      color: 0xe8eaec, roughness: 0.65,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });

    // Midtstripe med jevne mellomrom — gir fartsreferanse.
    const dash = new THREE.PlaneGeometry(0.22, 6);
    for (let z = -STRIP_HALF_Z + 8; z < STRIP_HALF_Z - 8; z += 14) {
      const m = new THREE.Mesh(dash, white);
      m.rotation.x = -Math.PI / 2;
      m.position.set(0, 0.02, z);
      this.scene.add(m);
    }

    // Avstandsmerker hver 50. meter fra startlinjen.
    const marker = new THREE.PlaneGeometry(9, 0.5);
    for (let d = 0; d <= 1200; d += 100) {
      const m = new THREE.Mesh(marker, white);
      m.rotation.x = -Math.PI / 2;
      m.position.set(-9, 0.02, -800 + d);
      this.scene.add(m);
      const m2 = m.clone();
      m2.position.x = 9;
      this.scene.add(m2);
    }

    const startLine = new THREE.Mesh(new THREE.PlaneGeometry(26, 0.9), white);
    startLine.rotation.x = -Math.PI / 2;
    startLine.position.set(0, 0.021, -800);
    this.scene.add(startLine);
  }

  _barriers() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xb9bfc6, metalness: 0.35, roughness: 0.55 });
    const h = 0.6;
    const walls = [
      { x: 0, z: STRIP_HALF_Z, hx: STRIP_HALF_X, hz: 0.5 },
      { x: 0, z: -STRIP_HALF_Z, hx: STRIP_HALF_X, hz: 0.5 },
      { x: STRIP_HALF_X, z: 0, hx: 0.5, hz: STRIP_HALF_Z },
      { x: -STRIP_HALF_X, z: 0, hx: 0.5, hz: STRIP_HALF_Z },
    ];

    for (const w of walls) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.hx * 2, h * 2, w.hz * 2), mat);
      mesh.position.set(w.x, h, w.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);

      this.physics.addStatic(
        this.RAPIER.ColliderDesc.cuboid(w.hx, h, w.hz)
          .setTranslation(w.x, h, w.z)
          .setFriction(0.4)
          .setRestitution(0.15),
        { surface: 'asphalt' },
      );
    }
  }

  _ramps() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x51555c, roughness: 0.85 });
    const ramps = [
      { x: -40, z: 20, angle: 0.14, length: 22 },
      { x: -40, z: 70, angle: 0.20, length: 18 },
    ];

    for (const r of ramps) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -r.angle);
      const halfY = 0.4;
      // Kjøreflaten er rampens overside, og den må starte i bakkenivå — ellers
      // blir rampen et trinn bilen smeller inn i.
      const y = Math.sin(r.angle) * (r.length / 2) - Math.cos(r.angle) * halfY;

      const mesh = new THREE.Mesh(new THREE.BoxGeometry(9, halfY * 2, r.length), mat);
      mesh.position.set(r.x, y, r.z);
      mesh.quaternion.copy(q);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);

      this.physics.addStatic(
        this.RAPIER.ColliderDesc.cuboid(4.5, halfY, r.length / 2).setFriction(1),
        { surface: 'asphalt', position: { x: r.x, y, z: r.z }, rotation: q },
      );
    }
  }

  _cones() {
    const geo = new THREE.ConeGeometry(0.22, 0.55, 14);
    const mat = new THREE.MeshStandardMaterial({ color: 0xe2571f, roughness: 0.6 });

    for (let i = 0; i < 14; i++) {
      const z = -700 + i * 13;
      const x = (i % 2 === 0 ? 1 : -1) * 6;

      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      this.scene.add(mesh);

      const body = this.physics.world.createRigidBody(
        this.RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0.28, z).setLinearDamping(0.4),
      );
      this.physics.world.createCollider(
        this.RAPIER.ColliderDesc.cylinder(0.275, 0.22).setDensity(70).setFriction(0.7),
        body,
      );

      this.dynamics.push({ mesh, body });
    }
  }

  /**
   * Bygger et miljøkart fra himmelen.
   *
   * Uten dette har metalliske materialer ingenting å speile, og felger, lakk og
   * rekkverk rendres kullsvarte uansett hvor sterkt sollyset er. Kartet lages av
   * en liten kopi av himmelkuppelen med bakken under.
   */
  createEnvironment(renderer) {
    const envScene = new THREE.Scene();
    envScene.add(skyDome(10));
    envScene.add(new THREE.Mesh(
      new THREE.SphereGeometry(9.6, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x55643f, side: THREE.BackSide }),
    ));

    const pmrem = new THREE.PMREMGenerator(renderer);
    const target = pmrem.fromScene(envScene, 0.03);
    pmrem.dispose();

    this.scene.environment = target.texture;
    this.scene.environmentIntensity = 0.85;
    return target.texture;
  }

  /** Flytter de dynamiske objektene i scenegrafen etter fysikken. */
  sync() {
    for (const d of this.dynamics) {
      const t = d.body.translation();
      const r = d.body.rotation();
      d.mesh.position.set(t.x, t.y, t.z);
      d.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  /** Skyggekameraet følger bilen så skyggene holder seg skarpe. */
  followSun(target) {
    this.sun.position.set(target.x + 120, target.y + 190, target.z + 90);
    this.sun.target.position.copy(target);
    this.sun.target.updateMatrixWorld();
  }
}
