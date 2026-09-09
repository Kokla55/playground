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
import { PostFx } from './render/PostFx.js';
import { Audio } from './audio/Audio.js';
import { Circuit } from './world/Circuit.js';
import { TRACKS } from './world/tracks.js';
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
  // PCFSoft ble fjernet i three r186; PCF er det som faktisk kjører.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  return renderer;
}

async function boot() {
  const overlay = document.getElementById('overlay');
  const status = document.getElementById('overlay-status');

  const physics = await Physics.create({ timestep: FIXED_STEP });
  status.textContent = 'BYGGER BANE';

  const mobile = hasTouch();

  // Hvilken bane som kjøres står i adressen, slik at et banebytte er en ekte
  // omstart av verden og ikke et halvt bytte der noe gammelt blir liggende
  // igjen. Banen bygger fysikk, terreng og teksturer, og alt må være i takt.
  const valgtBane = TRACKS.some((t) => t.id === location.hash.slice(1))
    ? location.hash.slice(1) : TRACKS[0].id;
  const world = new Circuit(physics, {
    shadowMapSize: mobile ? 1024 : 2048,
    quality: mobile ? 0 : 1,
    trackId: valgtBane,
  });
  const trackEl = document.getElementById('hud-track');
  if (trackEl) trackEl.textContent = world.path.name;
  const nesteBane = () => {
    const i = TRACKS.findIndex((t) => t.id === valgtBane);
    location.hash = TRACKS[(i + 1) % TRACKS.length].id;
    location.reload();
  };
  const renderer = createRenderer(document.getElementById('scene'), mobile);
  world.createEnvironment(renderer);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.15, 5000);
  camera.layers.enable(COCKPIT_LAYER);

  const vehicle = new Vehicle(physics, CAR, world.spawn);
  const model = new CarModel(CAR);
  const cockpit = new CockpitModel(CAR);
  model.group.add(cockpit.group);
  world.scene.add(model.group);

  // Skyggene settes opp når alt som skal ta imot dem finnes i scenen.
  world.enableCascadedShadows(camera, {
    cascades: mobile ? 2 : 3,
    shadowMapSize: mobile ? 1024 : 2048,
  });

  const mirrors = new Mirrors(CAR, model.group, { scale: mobile ? 0.6 : 1, hz: mobile ? 20 : 30 });

  // Fartsuskarphet koster en ekstra full skjermtegning, så den er av på mobil.
  const postFx = new PostFx(renderer, world.scene, camera);
  postFx.enabled = !mobile;

  // Nettlesere gir ikke lyd før brukeren har gjort noe selv, så lydkjeden
  // bygges på første tastetrykk eller berøring — ikke ved oppstart.
  const audio = new Audio(CAR);
  const muteBtn = document.getElementById('touch-mute');
  const lydStatus = document.getElementById('hud-audio');
  const visLyd = () => {
    const tekst = !audio.running ? 'venter på trykk' : audio.muted ? 'av' : 'på';
    if (lydStatus) lydStatus.textContent = tekst;
    muteBtn?.classList.toggle('av', audio.muted || !audio.running);
  };
  visLyd();

  // Nettlesere gir ikke lyd før brukeren har gjort noe selv. Ett forsøk holder
  // ikke: på mobil kan konteksten bli opprettet pauset, og da må neste
  // berøring få prøve igjen. Lytterne står derfor til lyden faktisk går.
  const vekkLyden = async () => {
    await audio.unlock();
    visLyd();
    if (audio.running) {
      for (const type of TRYKK) window.removeEventListener(type, vekkLyden);
    }
  };
  const TRYKK = ['keydown', 'pointerdown', 'touchstart', 'touchend', 'click'];
  for (const type of TRYKK) {
    window.addEventListener(type, vekkLyden, { passive: true });
  }
  // Mobil pauser lyden når man forlater fanen, og den kommer ikke i gang selv.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) vekkLyden();
  });

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
    postFx.setSize(window.innerWidth, window.innerHeight);
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
      if (input.consume('mute')) {
        audio.toggleMute();
        visLyd();
      }
      if (input.consume('track')) nesteBane();
      if (input.consume('pause')) {
        loop.paused = !loop.paused;
        pausePanel.classList.toggle('on', loop.paused);
      }

      model.sync(vehicle);
      cockpit.update(dt, vehicle, input.steer);
      world.sync(dt);

      const rig = cameras[cameraIndex];
      rig.update(dt, vehicle);

      // Skyggene deler synsfeltet etter dybde, så de må vite hvor kameraet
      // står — derfor etter at riggen har flyttet det.
      world.followSun(vehicle.position);

      // Speilene tegnes før hovedbildet, med bilen allerede flyttet på plass.
      mirrors.update(dt, renderer, world.scene, vehicle);

      postFx.render(vehicle.telemetry.speed);
      audio.update(dt, vehicle);
      hud.update(vehicle.telemetry, loop.fps);
      miniMap.update(dt, vehicle);
    },
  });

  // Første bilde tegnes før overlayet forsvinner, slik at man aldri ser en tom skjerm.
  model.sync(vehicle);
  cameras[0].update(FIXED_STEP, vehicle);
  world.followSun(vehicle.position);
  mirrors.update(1, renderer, world.scene, vehicle);
  renderer.render(world.scene, camera);

  loop.start();
  overlay.classList.add('gone');
  document.getElementById('hud').classList.add('ready');

  if (import.meta.env.DEV) {
    window.__apex = {
      physics, world, vehicle, model, cockpit, mirrors, miniMap, renderer, postFx, audio,
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
