/**
 * Banene i spillet.
 *
 * En bane er bare data: en håndplassert kontrollkurve som lukker seg, pluss
 * bredder og hvilke strekninger som er tunnel eller bro. Alt annet — asfalt,
 * curbs, rekkverk, terreng, hvor bilen starter — utledes av senterlinjen, så
 * dette er den eneste sannheten om hvor banen går.
 *
 * Kontrollpunktene er [x, z, høyde over havet].
 */

/**
 * Apex Ring: en flat, rask testbane. Bygget for å prøve ut bilen, ikke for å
 * være dramatisk — brede svinger, god sikt og god plass til å ta feil.
 */
const APEX_RING = {
  id: 'ring',
  name: 'APEX RING',
  samples: 1400,
  widthMin: 10.5,
  widthMax: 15.0,
  control: [
    [-430, -452,  0.0],   // start/mål — nesten 500 m rett fram
    [-300, -452,  0.0],
    [-160, -452,  0.0],
    [ -20, -450,  0.0],
    [ 120, -446,  0.8],
    [ 235, -430,  2.6],   // sving 1: rask høyre, stigende
    [ 322, -366,  5.2],
    [ 362, -262,  7.6],
    [ 352, -156,  8.4],   // toppen av stigningen
    [ 316,  -68,  6.6],   // ned igjen
    [ 268,   30,  4.2],   // esser
    [ 292,  140,  2.6],
    [ 244,  238,  1.8],
    [ 176,  296,  3.2],   // opp mot kneika
    [  60,  334,  6.4],
    [ -70,  340,  9.4],
    [-186,  296, 11.0],   // kneik, banens høyeste punkt
    [-262,  212,  9.2],
    [-306,  116,  6.4],   // lang nedoverbakke
    [-292,   16,  4.0],
    [-238,  -70,  2.6],   // inn i den langsomme
    [-286, -132,  1.8],
    [-342, -250,  1.0],
    [-408, -336,  0.6],
    [-452, -420,  0.2],   // siste sving inn på rettstrekket
  ],
};

/**
 * Kystveien: fra havnivå opp over et fjell og ned igjen.
 *
 * Banen er smalere enn Apex Ring og har ikke asfalt å ta feil på. Den starter
 * langs sjøen, krysser en bro over et innløp, klatrer innover i landet gjennom
 * to hårnåler, går gjennom en tunnel i fjellryggen på det høyeste, og faller
 * tilbake til havet i en lang, rask nedoverbakke.
 */
const COAST_ROAD = {
  id: 'kyst',
  name: 'KYSTVEIEN',
  samples: 1700,
  widthMin: 8.2,
  widthMax: 12.4,
  // Havet ligger vest for banen; alt under denne høyden er vann.
  seaLevel: 0,
  control: [
    [-520, -430, 17.0],   // start/mål — rettstrekk på skrenten over sjøen
    [-524, -316, 17.5],
    [-518, -196, 18.5],
    [-498,  -80, 20.0],
    [-460,   30, 21.5],   // kystsving mot høyre
    [-476,  140, 22.0],   // inn på brua
    [-470,  248, 22.5],   // ut av brua
    [-418,  336, 25.0],   // svinger innover i landet, klatringen begynner
    [-320,  394, 31.0],
    [-204,  420, 39.0],
    [ -86,  406, 48.0],
    [  18,  356, 57.0],   // inn mot første hårnål
    [  84,  296, 63.0],
    [ 116,  228, 67.0],
    [  96,  182, 70.0],   // hårnål 1: krapp høyre
    [  36,  186, 72.0],
    [ -14,  222, 74.0],
    [ -46,  164, 78.0],   // over til andre hårnål
    [ -30,   96, 82.0],
    [  26,   54, 86.0],
    [  92,   58, 90.0],   // hårnål 2: krapp venstre
    [ 132,  100, 93.0],
    [ 168,   52, 96.0],
    [ 178,  -34, 98.0],   // fjellryggen — tunnelen går gjennom her
    [ 152, -124, 96.0],
    [  96, -198, 88.0],   // lang nedoverbakke mot sørvest
    [  10, -256, 76.0],
    [ -92, -300, 63.0],
    [-202, -334, 50.0],
    [-310, -364, 38.0],
    [-408, -400, 27.0],
    [-482, -444, 20.0],   // siste sving inn på rettstrekket
  ],
  // Strekninger langs runden, som andel av rundelengden.
  tunnels: [{ from: 0.695, to: 0.760 }],   // gjennom fjellryggen på det høyeste
  bridges: [{ from: 0.148, to: 0.212 }],
};

export const TRACKS = [APEX_RING, COAST_ROAD];

export const trackById = (id) => TRACKS.find((t) => t.id === id) ?? TRACKS[0];
