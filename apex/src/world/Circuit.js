import * as THREE from 'three';
import { TrackPath } from './TrackPath.js';
import { buildTrack, startPose, START_FRACTION } from './TrackBuilder.js';
import { Terrain } from './Terrain.js';

/**
 * Hele banemiljøet: asfalt, curbs, rekkverk, terreng, skog og fjell.
 *
 * Senterlinjen i TrackPath er eneste sannhet om hvor banen går. Alt annet —
 * inkludert hvor bilen starter og hvor terrenget legger seg — utledes av den.
 */

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

function skyDome(radius = 4000) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), skyMaterial());
  mesh.frustumCulled = false;
  return mesh;
}

export class Circuit {
  constructor(physics, { shadowMapSize = 2048 } = {}) {
    this.physics = physics;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xc4d2de, 500, 3400);
    this.dynamics = [];

    this.path = new TrackPath(1400);
    this.scene.add(skyDome());
    this._lighting(shadowMapSize);

    const track = buildTrack(this.path, physics);
    this.scene.add(track.group);
    this.trackMaterials = track.materials;

    this.terrain = new Terrain(this.path);
    this.scene.add(this.terrain.group);

    const pose = startPose(this.path);
    this.spawn = {
      x: pose.position.x, y: pose.position.y, z: pose.position.z,
      q: { x: pose.quaternion.x, y: pose.quaternion.y, z: pose.quaternion.z, w: pose.quaternion.w },
    };

    // Et punkt ute på gresset, brukt til å måle at underlaget faktisk biter mindre.
    const shoulder = this.path.frameAt(Math.round(this.path.samples * START_FRACTION));
    const grass = shoulder.position.clone()
      .addScaledVector(shoulder.right, shoulder.halfWidth + 6)
      .addScaledVector(shoulder.normal, 0.8);
    this.grassSpawn = { x: grass.x, y: grass.y, z: grass.z, q: this.spawn.q };
  }

  _lighting(shadowMapSize) {
    const sun = new THREE.DirectionalLight(0xfff3e0, 3.1);
    sun.position.set(160, 220, 120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    sun.shadow.camera.near = 20;
    sun.shadow.camera.far = 700;
    const s = 150;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.04;
    this.scene.add(sun, sun.target);
    this.sun = sun;

    this.scene.add(new THREE.HemisphereLight(0xa8c8ea, 0x4a5238, 1.1));
  }

  /**
   * Miljøkart fra himmelen. Uten det har metaller ingenting å speile, og
   * felger og lakk rendres kullsvarte uansett hvor sterkt sollyset er.
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
    this.sun.position.set(target.x + 160, target.y + 220, target.z + 120);
    this.sun.target.position.copy(target);
    this.sun.target.updateMatrixWorld();
  }
}
