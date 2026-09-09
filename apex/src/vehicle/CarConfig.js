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

// Fjæringen bærer bilen ved en bestemt sammentrykking, ikke ved null. restLength
// er derfor hvilelengden PLUSS den statiske sammentrykkingen: da står bilen i
// riktig kjørehøyde med 135 mm fjæringsvei igjen. Ytterhjulet i en 1,18 g-sving
// bruker rundt 93 mm av det, så fjæra rekker fram uten å slå i bunn.
//
// Var dette feil, kjørte bilen permanent utbunnet. Da sluttet fjærkraften å
// vokse, tyngdekraften vant, og karosseriet la seg ned på asfalten midt i en
// sving — det føltes som en usynlig vegg. bumpStop er sikkerhetsnettet: en
// progressiv gummistopp som tar imot når fjæringsveien virkelig er oppbrukt.
const FRONT_SUSPENSION = {
  restLength: 0.391,
  maxBump: 0.19,
  maxDroop: 0.11,
  stiffness: 51000,      // 2.1 Hz fjærfrekvens — fast, men ikke rå
  dampBump: 2700,
  dampRebound: 4600,
  bumpStop: 420000,
  bumpStopDamp: 9000,
  antiRoll: 24000,
};

const REAR_SUSPENSION = {
  restLength: 0.391,
  maxBump: 0.19,
  maxDroop: 0.11,
  stiffness: 70000,      // bakakselen bærer 58 % av vekten og må være stivere
  dampBump: 3500,
  dampRebound: 6100,
  bumpStop: 560000,
  bumpStopDamp: 12000,
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

  // Kollisjonsboksen skal fange opp rekkverk og andre biler — aldri bakken.
  // Hjulene og fjæringen tar all kontakt med veien.
  //
  // Boksen følger karosseriet som tegnes — 4.5 m langt, 2.1 m bredt — men
  // gulvet er hevet: den går fra 0.38 til 1.36 m over veibanen i hvile. Selv med
  // fjæringen i bunn og ti graders krengning ligger nederste hjørne 12 cm
  // klar av asfalten, så kollisjonsløseren får aldri avgjøre farten i en sving.
  collider: { hx: 0.95, hy: 0.49, hz: 2.15, offsetY: 0.41, offsetZ: 0.00 },

  wheelRadius: WHEEL_RADIUS,
  wheelWidth: 0.30,
  wheelInertia: 1.6,

  // Tyngdepunktshøyde over bakken ved hvile.
  ridePoint: 0.46,

  wheels: [
    {
      name: 'FR', pos: { x: -0.79, y: 0.22, z: AXLE_FRONT },
      steered: true, driven: false, handbrake: false,
      brakeShare: 0.31, tire: FRONT_TIRE, ...FRONT_SUSPENSION,
    },
    {
      name: 'FL', pos: { x: 0.79, y: 0.22, z: AXLE_FRONT },
      steered: true, driven: false, handbrake: false,
      brakeShare: 0.31, tire: FRONT_TIRE, ...FRONT_SUSPENSION,
    },
    {
      name: 'RR', pos: { x: -0.82, y: 0.22, z: AXLE_REAR },
      steered: false, driven: true, handbrake: true,
      brakeShare: 0.19, tire: REAR_TIRE, ...REAR_SUSPENSION,
    },
    {
      name: 'RL', pos: { x: 0.82, y: 0.22, z: AXLE_REAR },
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
