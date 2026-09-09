import * as THREE from 'three';
import { COCKPIT_LAYER } from '../vehicle/CockpitModel.js';

/**
 * Speilene er ekte: hvert av dem rendrer scenen på nytt fra sin egen posisjon
 * inn i en liten tekstur. Bilder du ser i bakspeilet er altså det som faktisk
 * ligger bak deg, ikke en effekt.
 *
 * Tre ekstra gjennomtegninger per bilde er dyrt, så de kjøres i lav oppløsning
 * og med lavere frekvens enn resten av spillet — øyet merker ikke forskjellen
 * på et speil som oppdateres 30 ganger i sekundet.
 */

const _pos = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _target = new THREE.Vector3();

/** Speilvender teksturkoordinatene, slik at bildet blir et speilbilde. */
function flipUv(geometry) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  uv.needsUpdate = true;
  return geometry;
}

export class Mirrors {
  /**
   * @param {THREE.Group} parent bilens gruppe — speilene henger på bilen
   * @param {number} scale oppløsningsfaktor (mindre på mobil)
   */
  constructor(cfg, parent, { scale = 1, hz = 30 } = {}) {
    const o = cfg.ridePoint;
    this.interval = 1 / hz;
    this._accum = this.interval;

    const specs = [
      {
        name: 'rear',
        mesh: { pos: [0.02, 1.19 - o, 0.74], rotY: Math.PI, rotX: -0.12, size: [0.28, 0.082] },
        // En midtmotorbil har i praksis ingen sikt rett bakover gjennom
        // motordekselet. Kameraet løftes derfor over dekselet, slik at speilet
        // viser noe som faktisk er til nytte.
        cam: { pos: [0, 1.38 - o, -1.15], dir: [0, -0.10, -1], fov: 38 },
        res: [Math.round(512 * scale), Math.round(150 * scale)],
      },
      {
        // Førersiden ligger mot +X, siden bilen peker mot +Z.
        name: 'left',
        mesh: { pos: [1.05, 0.99 - o, 1.03], rotY: Math.PI - 0.34, rotX: -0.07, size: [0.155, 0.082] },
        cam: { pos: [1.05, 0.99 - o, 1.00], dir: [0.36, -0.08, -1], fov: 52 },
        res: [Math.round(320 * scale), Math.round(165 * scale)],
      },
      {
        name: 'right',
        mesh: { pos: [-1.05, 0.99 - o, 1.03], rotY: Math.PI + 0.34, rotX: -0.07, size: [0.155, 0.082] },
        cam: { pos: [-1.05, 0.99 - o, 1.00], dir: [-0.36, -0.08, -1], fov: 52 },
        res: [Math.round(320 * scale), Math.round(165 * scale)],
      },
    ];

    this.mirrors = specs.map((s) => {
      const target = new THREE.WebGLRenderTarget(s.res[0], s.res[1], {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        colorSpace: THREE.SRGBColorSpace,
        depthBuffer: true,
      });

      const camera = new THREE.PerspectiveCamera(s.cam.fov, s.res[0] / s.res[1], 0.3, 2500);
      // Speilkameraene ser bare lag 0, så interiøret stenger ikke for utsikten.

      const mesh = new THREE.Mesh(
        flipUv(new THREE.PlaneGeometry(s.mesh.size[0], s.mesh.size[1])),
        new THREE.MeshBasicMaterial({ map: target.texture, toneMapped: false }),
      );
      mesh.position.set(...s.mesh.pos);
      mesh.rotation.set(s.mesh.rotX, s.mesh.rotY, 0);
      mesh.layers.set(COCKPIT_LAYER);
      parent.add(mesh);

      // Ramme rundt glasset, så speilet leser som et objekt og ikke et hull.
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(s.mesh.size[0] + 0.022, s.mesh.size[1] + 0.022, 0.012),
        new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.6, metalness: 0.3 }),
      );
      frame.position.copy(mesh.position);
      frame.rotation.copy(mesh.rotation);
      frame.translateZ(-0.009);
      frame.layers.set(COCKPIT_LAYER);
      parent.add(frame);

      return {
        name: s.name,
        target,
        camera,
        mesh,
        camLocal: new THREE.Vector3(...s.cam.pos),
        dirLocal: new THREE.Vector3(...s.cam.dir).normalize(),
      };
    });
  }

  update(dt, renderer, scene, vehicle) {
    this._accum += dt;
    if (this._accum < this.interval) return;
    this._accum = 0;

    // Skyggekartet er allerede tegnet for hovedbildet; å regne det på nytt for
    // hvert speil ville tredoble kostnaden uten synlig gevinst.
    const autoUpdate = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;

    for (const m of this.mirrors) {
      _pos.copy(m.camLocal).applyQuaternion(vehicle.quaternion).add(vehicle.position);
      _dir.copy(m.dirLocal).applyQuaternion(vehicle.quaternion);
      _target.copy(_pos).add(_dir);

      m.camera.position.copy(_pos);
      m.camera.up.set(0, 1, 0).applyQuaternion(vehicle.quaternion);
      m.camera.lookAt(_target);

      renderer.setRenderTarget(m.target);
      renderer.render(scene, m.camera);
    }

    renderer.setRenderTarget(null);
    renderer.shadowMap.autoUpdate = autoUpdate;
  }

  dispose() {
    for (const m of this.mirrors) m.target.dispose();
  }
}
