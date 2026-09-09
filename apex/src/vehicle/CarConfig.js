/**
 * Bildata for "Apex GT" — en original midtmotorert coupé.
 * Alle verdier er i SI-enheter: meter, kilo, newton, newtonmeter, radianer.
 */

const WHEEL_RADIUS = 0.345;

// Dekk foran er smalere enn bak. Det gir bilen en stabil, lett understyrt balanse
// som blir til oversteering når du provoserer den med gass.
const FRONT_TIRE = {
  mu: 1.48,
  nominalLoad: 3400,
  loadSensitivity: 0.22,
  Bx: 11.5, Cx: 1.66, Ex: -0.35,
  By: 9.2, Cy: 1.38, Ey: -0.5,
};

const REAR_TIRE = {
  mu: 1.60,
  nominalLoad: 4100,
  loadSensitivity: 0.20,
  Bx: 11.0, Cx: 1.68, Ex: -0.35,
  By: 8.6, Cy: 1.40, Ey: -0.5,
};

const FRONT_SUSPENSION = {
  restLength: 0.34,
  maxBump: 0.13,
  maxDroop: 0.11,
  stiffness: 49000,
  dampBump: 3100,
  dampRebound: 4600,
  antiRoll: 24000,
};

const REAR_SUSPENSION = {
  restLength: 0.34,
  maxBump: 0.13,
  maxDroop: 0.11,
  stiffness: 57000,
  dampBump: 3500,
  dampRebound: 5200,
  antiRoll: 15000,
};

// Akselavstand 2.65 m, tyngdepunkt 42/58 bak — typisk for midtmotor.
const AXLE_FRONT = 1.537;
const AXLE_REAR = -1.113;

export const CAR = {
  name: 'Apex GT',

  mass: 1385,
  // Treghetsmoment om x (nikk), y (giring), z (rulling).
  // Lav rulletreghet gir kjapp respons; giretreghet er lavere enn en boks
  // fordi massen sitter samlet i midten.
  inertia: { x: 1620, y: 2050, z: 520 },

  // Kollisjonsboks, plassert relativt til tyngdepunktet (origo).
  collider: { hx: 0.92, hy: 0.52, hz: 2.16, offsetY: 0.30, offsetZ: 0.00 },

  wheelRadius: WHEEL_RADIUS,
  wheelWidth: 0.30,
  wheelInertia: 1.6,

  // Tyngdepunktshøyde over bakken ved hvile.
  ridePoint: 0.46,

  wheels: [
    {
      name: 'FL', pos: { x: -0.79, y: 0.22, z: AXLE_FRONT },
      steered: true, driven: false, handbrake: false,
      brakeShare: 0.31, tire: FRONT_TIRE, ...FRONT_SUSPENSION,
    },
    {
      name: 'FR', pos: { x: 0.79, y: 0.22, z: AXLE_FRONT },
      steered: true, driven: false, handbrake: false,
      brakeShare: 0.31, tire: FRONT_TIRE, ...FRONT_SUSPENSION,
    },
    {
      name: 'RL', pos: { x: -0.82, y: 0.22, z: AXLE_REAR },
      steered: false, driven: true, handbrake: true,
      brakeShare: 0.19, tire: REAR_TIRE, ...REAR_SUSPENSION,
    },
    {
      name: 'RR', pos: { x: 0.82, y: 0.22, z: AXLE_REAR },
      steered: false, driven: true, handbrake: true,
      brakeShare: 0.19, tire: REAR_TIRE, ...REAR_SUSPENSION,
    },
  ],

  steering: {
    maxAngle: 0.58,        // ~33 grader ved full utslag i lav fart
    speedFactor: 0.040,    // reduserer utslaget med farten
    minRatio: 0.30,        // men aldri under 30 % av fullt utslag
    rate: 3.4,             // rad/s på rattet
    returnRate: 5.0,
    ackermann: 0.65,
  },

  brakes: {
    maxTorque: 7200,       // totalt; sterkt nok til at dekkene, ikke bremsene, setter grensen
    handbrakeTorque: 6000, // bare bakhjul, sterkt nok til å låse dem
  },

  engine: {
    idleRpm: 900,
    redline: 8200,
    limiterRpm: 8100,
    // 3.0 liters twin-turbo V6, ~540 hk.
    torqueCurve: [
      [900, 220], [1500, 360], [2000, 445], [2500, 545], [3000, 585],
      [3500, 615], [4000, 630], [4800, 642], [5600, 630], [6400, 604],
      [7200, 552], [8000, 470], [8400, 380],
    ],
    engineBrakeTorque: 62,
    inertia: 0.21,
    clutchTorque: 1100,
    // 7-trinns dobbeltclutch.
    gearRatios: [3.58, 2.36, 1.74, 1.36, 1.10, 0.92, 0.78],
    reverseRatio: 3.20,
    finalDrive: 3.55,
    efficiency: 0.92,
    upshiftRpm: 7900,
    downshiftRpm: 3100,
    shiftTime: 0.14,
  },

  differential: {
    lsdCoupling: 46,       // Nm per rad/s forskjell mellom bakhjulene
    maxTransfer: 420,
  },

  aero: {
    airDensity: 1.225,
    cdA: 0.70,             // luftmotstand
    clA: 0.62,             // marktrykk
    balance: 0.42,         // andel marktrykk foran
    frontPointZ: 1.7,
    rearPointZ: -1.8,
  },

  rollingResistance: 0.014,
  tireRefSpeed: 2.2,       // demper slip ratio ved svært lav fart
  wheelSubsteps: 2,
};

export const SURFACES = {
  asphalt: { grip: 1.00, rollingScale: 1.0 },
  kerb:    { grip: 0.92, rollingScale: 1.3 },
  grass:   { grip: 0.52, rollingScale: 3.2 },
  gravel:  { grip: 0.62, rollingScale: 2.6 },
};
