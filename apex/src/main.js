import * as THREE from 'three';
import { Physics } from './core/Physics.js';
import { Loop } from './core/Loop.js';
import { CAR } from './vehicle/CarConfig.js';
import { Vehicle } from './vehicle/Vehicle.js';
import { VehicleInput } from './vehicle/VehicleInput.js';
import { CarModel } from './vehicle/CarModel.js';
import { ChaseCamera, HoodCamera } from './camera/CameraRig.js';
import { TestScene } from './world/TestScene.js';
import { Hud } from './ui/Hud.js';
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
  const world = new TestScene(physics, { shadowMapSize: mobile ? 1024 : 2048 });
  const renderer = createRenderer(document.getElementById('scene'), mobile);
  world.createEnvironment(renderer);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.15, 5000);

  const vehicle = new Vehicle(physics, CAR, world.spawn);
  const model = new CarModel(CAR);
  world.scene.add(model.group);

  const input = new VehicleInput(CAR);
  if (mobile) input.touch = new TouchControls();

  const cameras = [new ChaseCamera(camera), new HoodCamera(camera, CAR)];
  let cameraIndex = 0;

  const hud = new Hud(CAR);
  const pausePanel = document.getElementById('pause');

  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  };
  window.addEventListener('resize', onResize);

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
      }
      if (input.consume('camera')) {
        cameraIndex = (cameraIndex + 1) % cameras.length;
        cameras[cameraIndex].reset();
      }
      if (input.consume('pause')) {
        loop.paused = !loop.paused;
        pausePanel.classList.toggle('on', loop.paused);
      }

      model.sync(vehicle);
      world.sync();
      world.followSun(vehicle.position);
      cameras[cameraIndex].update(dt, vehicle);

      renderer.render(world.scene, camera);
      hud.update(vehicle.telemetry, loop.fps);
    },
  });

  // Første bilde tegnes før overlayet forsvinner, slik at man aldri ser en tom skjerm.
  cameras[0].update(FIXED_STEP, vehicle);
  renderer.render(world.scene, camera);

  loop.start();
  overlay.classList.add('gone');
  document.getElementById('hud').classList.add('ready');

  if (import.meta.env.DEV) {
    window.__apex = {
      physics, world, vehicle, model, input, camera, cameras, loop, CAR,
      step: stepSimulation, fixedStep: FIXED_STEP,
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
