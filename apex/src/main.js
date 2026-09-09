import * as THREE from 'three';
import { Physics } from './core/Physics.js';
import { Loop } from './core/Loop.js';
import { CAR } from './vehicle/CarConfig.js';
import { Vehicle } from './vehicle/Vehicle.js';
import { VehicleInput } from './vehicle/VehicleInput.js';
import { CarModel } from './vehicle/CarModel.js';
import { CockpitModel, COCKPIT_LAYER } from './vehicle/CockpitModel.js';
import { ChaseCamera, CockpitCamera } from './camera/CameraRig.js';
import { Mirrors } from './render/Mirrors.js';
import { Circuit } from './world/Circuit.js';
import { Hud } from './ui/Hud.js';
import { MiniMap } from './ui/MiniMap.js';
import { TouchControls, hasTouch } from './ui/TouchControls.js';

const FIXED_STEP = 1 / 120;

function createRenderer(canvas, mobile) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !mobile,
    powerPreference: 'high-performance',
  });
  // Mobil-GPU-er har god oppløsning, men lite å gå på i fyllrate. Å tegne i
  // full pikseltetthet på en telefon koster mer enn det synes.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  return renderer;
}

async function boot() {
  const overlay = document.getElementById('overlay');
  const status = document.getElementById('overlay-status');

  const physics = await Physics.create({ timestep: FIXED_STEP });
  status.textContent = 'BYGGER BANE';

  const mobile = hasTouch();
  const world = new Circuit(physics, { shadowMapSize: mobile ? 1024 : 2048 });
  const renderer = createRenderer(document.getElementById('scene'), mobile);
  world.createEnvironment(renderer);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.15, 5000);
  camera.layers.enable(COCKPIT_LAYER);

  const vehicle = new Vehicle(physics, CAR, world.spawn);
  const model = new CarModel(CAR);
  const cockpit = new CockpitModel(CAR);
  model.group.add(cockpit.group);
  world.scene.add(model.group);

  const mirrors = new Mirrors(CAR, model.group, { scale: mobile ? 0.6 : 1, hz: mobile ? 20 : 30 });

  const input = new VehicleInput(CAR);
  if (mobile) input.touch = new TouchControls();

  // Cockpit er hovedkameraet, slik oppdraget ber om.
  const cameras = [new CockpitCamera(camera, CAR, cockpit.eye), new ChaseCamera(camera)];
  let cameraIndex = 0;

  const hud = new Hud(CAR);
  const miniMap = new MiniMap(world.path, {
    canvas: document.getElementById('map-canvas'),
    lapEl: document.getElementById('map-lap'),
    distanceEl: document.getElementById('map-distance'),
  });
  miniMap.reset();
  const hudEl = document.getElementById('hud');
  const pausePanel = document.getElementById('pause');

  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  };
  window.addEventListener('resize', onResize);
  hudEl.classList.add('incar');

  const stepSimulation = (dt) => {
    input.update(dt);
    vehicle.update(dt, input);
    physics.step();
  };

  const loop = new Loop({
    fixedStep: FIXED_STEP,
    update: stepSimulation,
    render(dt) {
      if (input.consume('reset')) {
        vehicle.reset();
        for (const c of cameras) c.reset();
        miniMap.reset();
      }
      if (input.consume('camera')) {
        cameraIndex = (cameraIndex + 1) % cameras.length;
        cameras[cameraIndex].reset();
        // I cockpit viser instrumentpanelet fart og turtall, så det store
        // skjermgrensesnittet trekker seg unna.
        hudEl.classList.toggle('incar', cameraIndex === 0);
      }
      if (input.consume('pause')) {
        loop.paused = !loop.paused;
        pausePanel.classList.toggle('on', loop.paused);
      }

      model.sync(vehicle);
      cockpit.update(dt, vehicle, input.steer);
      world.sync();
      world.followSun(vehicle.position);

      const rig = cameras[cameraIndex];
      rig.update(dt, vehicle);

      // Speilene tegnes før hovedbildet, med bilen allerede flyttet på plass.
      mirrors.update(dt, renderer, world.scene, vehicle);

      renderer.render(world.scene, camera);
      hud.update(vehicle.telemetry, loop.fps);
      miniMap.update(dt, vehicle);
    },
  });

  // Første bilde tegnes før overlayet forsvinner, slik at man aldri ser en tom skjerm.
  model.sync(vehicle);
  cameras[0].update(FIXED_STEP, vehicle);
  mirrors.update(1, renderer, world.scene, vehicle);
  renderer.render(world.scene, camera);

  loop.start();
  overlay.classList.add('gone');
  document.getElementById('hud').classList.add('ready');

  if (import.meta.env.DEV) {
    window.__apex = {
      physics, world, vehicle, model, cockpit, mirrors, miniMap,
      input, camera, cameras, loop, CAR,
      step: stepSimulation, fixedStep: FIXED_STEP,
      setCamera: (i) => { cameraIndex = i; cameras[i].reset(); hudEl.classList.toggle('incar', i === 0); },
    };
  }
}

boot().catch((err) => {
  console.error(err);
  const overlay = document.getElementById('overlay');
  overlay.classList.add('failed');
  document.getElementById('overlay-status').textContent = 'KUNNE IKKE STARTE';
  document.getElementById('overlay-error').textContent = String(err && err.message ? err.message : err);
});
