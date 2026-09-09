import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { TrackPath } from './TrackPath.js';
import { buildTrack, startPose, START_FRACTION } from './TrackBuilder.js';
import { Terrain } from './Terrain.js';

/**
 * Hele banemiljøet: asfalt, curbs, rekkverk, terreng, skog og fjell.
 *
 * Senterlinjen i TrackPath er eneste sannhet om hvor banen går. Alt annet —
 * inkludert hvor bilen starter og hvor terrenget legger seg — utledes av den.
 */

// Sola står 30 grader over horisonten, ikke rett opp. Midt på dagen faller
// skyggen under bilen og landskapet blir flatt; på ettermiddagen får alt
// lengde og form, og bilens egen skygge blir noe du faktisk ser.
const SUN_OFFSET = new THREE.Vector3(150, 133, 175);
const SUN_COLOUR = 0xfff3e0;
const SUN_INTENSITY = 3.1;

// Hvor dypt hvert skyggekart rekker, i meter fra kameraet.
// Det MÅ være nøyaktig like mange grenser som kaskader. Er det flere, bygger
// CSM et frustum uten lys og krasjer på oppstart — slik mobil gjorde da denne
// listen alltid hadde tre verdier mens telefonen kjørte to kaskader.
const SHADOW_SPLITS = {
  1: [260],
  2: [22, 260],
  3: [14, 55, 260],
  4: [10, 30, 90, 260],
};

/**
 * Himmelen er én kuppel med en gradient — og nå med sola i den.
 *
 * Lyset kommer fra en bestemt retning, og da må himmelen vise det: en skive
 * der sola står, en varm glød rundt den som blør ut over halve himmelen, og en
 * horisont som er lysere nærmest sola. Uten det ser en senket sol ut som en
 * feil i lyssettingen framfor som ettermiddag.
 */
function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x2c66ab) },
      horizonColor: { value: new THREE.Color(0xd6dfe8) },
      groundColor: { value: new THREE.Color(0x6d7482) },
      sunColor: { value: new THREE.Color(0xffeccd) },
      sunDirection: { value: SUN_OFFSET.clone().normalize() },
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
      uniform vec3 sunColor;
      uniform vec3 sunDirection;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 col = h > 0.0
          ? mix(horizonColor, topColor, pow(h, 0.55))
          : mix(horizonColor, groundColor, pow(-h, 0.4));

        // Glød rundt sola, og selve skiva med en myk kant.
        float d = max(dot(normalize(vDir), normalize(sunDirection)), 0.0);
        col = mix(col, sunColor, pow(d, 5.0) * 0.34);
        col += sunColor * pow(d, 220.0) * 1.4;
        col += sunColor * smoothstep(0.9995, 0.9998, d) * 2.2;

        gl_FragColor = vec4(col, 1.0);

        // Himmelen må gjennom nøyaktig de samme leddene som alle andre
        // materialer. Uten disse skrev den rå verdier rett i bufferet: det så
        // nesten riktig ut på skjermen, men gikk bildet gjennom
        // etterbehandlingen ble himmelen tolket som lineær og lyste opp hele
        // bildet med 12 %. Chunkene gjør ingenting når three tegner til et
        // mellommål, og alt til slutt — som det skal.
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

function skyDome(radius = 4000) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), skyMaterial());
  mesh.frustumCulled = false;
  return mesh;
}

export class Circuit {
  constructor(physics, { shadowMapSize = 2048, quality = 1 } = {}) {
    this.physics = physics;
    this.scene = new THREE.Scene();
    // Samme farge som horisonten: da smelter fjellene inn i himmelen
    // i stedet for å ende i en grå kant.
    this.scene.fog = new THREE.Fog(0xd6dfe8, 420, 3200);
    this.dynamics = [];

    this.path = new TrackPath(1400);
    this.scene.add(skyDome());
    this._lighting(shadowMapSize);

    const track = buildTrack(this.path, physics, { quality });
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
    // Sola står høyt og litt bak til venstre. Retningen brukes både av det
    // enkle skyggekameraet og av kaskadene.
    const sun = new THREE.DirectionalLight(SUN_COLOUR, SUN_INTENSITY);
    sun.position.copy(SUN_OFFSET);
    sun.castShadow = true;
    sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    sun.shadow.camera.near = 120;
    sun.shadow.camera.far = 460;
    const s = 65;
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
   * Kaskadeskygger.
   *
   * Ett skyggekart måtte dekke alt du ser på én gang. Strakk det seg langt nok
   * til at trærne framme i veien fikk skygge, ble hver teksel 7 cm og bilens
   * egen skygge en grøt på 66 piksler. Strammet man det rundt bilen, kom
   * skyggegrensa inn i synsfeltet og raste foran deg i 200 km/t.
   *
   * Kaskadene løser nettopp dette: tre skyggekart som deler synsfeltet etter
   * dybde, tettest der bilen er. Nærmeste kaskade dekker under 20 meter og gir
   * en skarp skygge under bilen; den fjerneste rekker 260 meter fram.
   *
   * Shaderen lar bare én kaskade lyse hver piksel, så sollyset blir ikke
   * sterkere av at det er flere lamper — styrken er den samme som før.
   */
  enableCascadedShadows(camera, { cascades = 3, shadowMapSize = 2048 } = {}) {
    this.sun.visible = false;
    this.sun.castShadow = false;

    this.csm = new CSM({
      camera,
      parent: this.scene,
      cascades,
      maxFar: 260,
      // Standardoppdelingen ga nærmeste kaskade 44 meters dybde, og bilens egen
      // skygge ble like grov som før. Grensene settes derfor i meter: det
      // første kartet dekker bare bilen og asfalten rundt den.
      mode: 'custom',
      customSplitsCallback: (antall, near, far, breaks) => {
        // Faller tilbake på jevn fordeling om noen ber om et antall vi ikke
        // har grenser for, slik at det aldri blir feil antall.
        const meter = SHADOW_SPLITS[antall]
          ?? Array.from({ length: antall }, (_, i) => (far * (i + 1)) / antall);
        for (let i = 0; i < antall; i++) breaks.push(Math.min(meter[i], far) / far);
        breaks[antall - 1] = 1;
      },
      shadowMapSize,
      shadowBias: -0.0006,
      lightIntensity: SUN_INTENSITY,
      lightDirection: SUN_OFFSET.clone().negate().normalize(),
      lightMargin: 260,
    });
    this.csm.fade = true;
    for (const light of this.csm.lights) {
      light.color.set(SUN_COLOUR);
      light.shadow.normalBias = 0.03;
    }

    // Hvert materiale som skal ta imot skygge må få shaderen sin utvidet.
    // Bare de fysisk baserte materialene belyses; himmelen og HUD-en ikke.
    const seen = new Set();
    this.scene.traverse((obj) => {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (!m || seen.has(m) || !m.isMeshStandardMaterial) continue;
        seen.add(m);
        this.csm.setupMaterial(m);
      }
    });
    this.shadowMaterials = seen.size;
    return this.csm;
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

  /**
   * Skyggene følger det du ser. Med kaskader gjør de det av seg selv ut fra
   * kameraet; uten dem flyttes det ene skyggekameraet etter bilen.
   */
  followSun(target) {
    if (this.csm) {
      this.csm.camera.updateMatrixWorld();
      this.csm.update();
      return;
    }
    this.sun.position.copy(SUN_OFFSET).add(target);
    this.sun.target.position.copy(target);
    this.sun.target.updateMatrixWorld();
  }
}
