# Apex GT

Et 3D-bilspill som kjører i nettleseren, bygget stegvis med kjørbar fysikk som
fundament. Bilen, banen og alt innhold er originalt.

## Teknologivalg

Miljøet har verken Unreal, Unity eller Godot installert, og ingen GPU-node
(`/dev/dri` finnes ikke) — en desktop-engine ville uansett ikke kunne rendre her.
Valget falt derfor på det eneste stacket som faktisk gir sanntids 3D med
fysikk i dette miljøet:

| Del | Verktøy | Hvorfor |
| --- | --- | --- |
| Rendering | **Three.js** (WebGL2) | PBR, skygger, tone mapping; kjører overalt uten installasjon |
| Fysikk | **Rapier3D** (Rust, kompilert til WASM) | Rask stiv-kropp-simulering med raycasts, som bilmodellen bygger på |
| Bygg | **Vite** | Ingen konfigurasjon, umiddelbar oppstart |

## Kjøre spillet

```bash
npm install
npm run dev      # åpne adressen som skrives ut
```

`npm run build` lager en statisk versjon i `dist/`.

## Kontroller

| Tast | Handling |
| --- | --- |
| `W` | Gass |
| `S` | Brems, og revers når bilen står stille |
| `A` / `D` | Styring |
| `Mellomrom` | Håndbrekk |
| `C` | Bytt kamera (cockpit ↔ forfølgende) |
| `R` | Sett bilen tilbake på startlinjen |
| `Esc` | Pause |

Gamepad brukes automatisk hvis det er koblet til: venstre stikke styrer,
avtrekkerne er gass og brems.

## Arkitektur

```
src/
  core/      Loop (fast tidssteg) og Physics (Rapier-innpakning)
  vehicle/   CarConfig, Vehicle, Tire, Drivetrain, VehicleInput,
             CarModel (karosseri), CockpitModel (interiør)
  camera/    CameraRig (cockpit og forfølgende)
  render/    Mirrors
  world/     TrackPath (senterlinje), TrackBuilder (asfalt, curbs, rekkverk),
             Terrain (landskap og vegetasjon), Circuit (setter alt sammen)
  ui/        Hud, MiniMap, TouchControls
```

Hver del kjenner så lite som mulig til de andre: dekkmodellen vet ingenting om
Rapier, inndata vet ingenting om bilen, og HUD-en leser bare telemetri.

## Slik virker bilfysikken

Bilen er én stiv kropp med masse, tyngdepunkt og treghetsmoment satt eksplisitt.
Hvert hjul er en stråle som skytes nedover fra sitt festepunkt:

1. **Fjæring** — strålen finner bakken, og fjærkraft pluss demping regnes ut av
   hvor mye fjæringen er trykket sammen. Krengningsstag kobler hjulene på hver
   aksel.
2. **Dekk** — en forenklet Pacejka-modell gir langsgående og sideveis kraft ut
   fra slipp. Grepet faller av etter toppen, så bilen slipper gradvis. En
   friksjonssirkel gjør at kreftene deler på det samme grepsbudsjettet.
3. **Lastfølsomhet** — et hardt belastet dekk gir mindre grep per newton. Det er
   dette som gjør at vektforskyvning faktisk endrer balansen underveis.
4. **Hjulrotasjon** — hvert hjul har sin egen vinkelhastighet, drevet av
   motormoment og bremset av veigrepet. Drivhjulene får i tillegg motorens
   treghet gjennom kvadratet av utvekslingen, som er grunnen til at bilen ikke
   spinner løs momentant i høye gir.
5. **Drivlinje** — momentkurve, sjutrinns girkasse med momentkutt under skift,
   clutch med begrenset overføringsevne, sperredifferensial bak.

Understyring og oversteering er ikke skrudd på som effekter — de oppstår av seg
selv når vekt flytter seg mellom dekk med ulikt grep.

## Målt oppførsel

Verifisert automatisk i Chromium med fast tidssteg:

| Måling | Resultat |
| --- | --- |
| 0–100 km/t | 3,39 s |
| 0–200 km/t | 9,33 s |
| Toppfart | 305 km/t |
| Bremselengde 100–0 | 39,3 m |
| Maks sideakselerasjon | 1,27 g |
| Vektfordeling i ro | 42/58 foran/bak |
| Vektforskyvning ved 1,16 g brems | 3079 N framover (teori: 2729 N) |
| Luftmotstand ved 80 m/s | 2,08 m/s² retardasjon |

## Kameraer og speil

**Cockpit** er hovedkameraet. Det sitter fast i karosseriet og følger både nikk
og krengning — det er det som gjør at underlaget kjennes. Hodet forskyves litt
av g-kreftene, og blikket dras svakt inn i svingen. Instrumentpanelet tegnes på
et lerret og viser fart, turtall, gir og sideakselerasjon; rattet dreier halvannen
omdreining fra låsing til låsing.

**Alle tre speilene er ekte.** Hvert av dem rendrer scenen på nytt fra sin egen
posisjon inn i en liten tekstur, i lav oppløsning og 30 ganger i sekundet. Det du
ser bak deg er det som faktisk ligger bak deg. Bakspeilets kamera er løftet over
motordekselet — en midtmotorbil har i praksis ingen sikt rett bakover, og et
speil som bare viser panser er til ingen nytte.

**Det forfølgende kameraet** mykes opp i bilens egen ramme, ikke i verden. En
utjevning som følger et mål i fart ligger permanent etter med farten ganget med
tidskonstanten — ved 270 km/t ble det tretten meter, og bilen krympet til en
prikk. Nå følger avstanden bilen nøyaktig, mens bare dreiningen henger etter.

## Banen

En lukket rundbane på **2775 meter** med en senterlinje som all annen geometri
utledes av — asfalt, curbs, skulder, rekkverk og terrenghøyde. Da kan de aldri
komme i utakt med hverandre.

| | |
| --- | --- |
| Lengde | 2775 m |
| Minste radius | 24 m (den langsomme venstresvingen) |
| Største radius | over 2000 m (hovedrettstrekket, 400 m) |
| Høydeforskjell | 11 m |
| Bratteste stigning | 2,8 % |
| Dosering | opptil 8° inn mot svingen |

Layouten går fra et langt rettstrekk inn i en rask stigende høyre, over toppen
og ned gjennom to esser, opp mot banens høyeste punkt, og til slutt ned en lang
bakke inn i den langsomme svingen som leder tilbake på rettstrekket. Banen er
bredest på rettstrekket og smalner inn der svingene er trangest.

**Curbene** legges automatisk der radien er under 250 m, og tones inn og ut med
hvor trang svingen er. De er et eget underlag med litt mindre grep, så du kjenner
når du legger hjulet på dem.

**Rekkverket** står 13 meter utenfor asfaltkanten hele veien rundt og lukker
banen inne. Det er derfor terrenget utenfor ikke trenger fysikk i det hele tatt,
og kan være stort og detaljert gratis.

**Landskapet** binder seg til banen: like utenfor asfalten følger terrenget
veibanen nøyaktig, og først lenger ute får det lov til å bølge og reise seg i
fjell med snø på toppene. 2200 trær og 520 steiner er strødd ut der bakken ikke
er for bratt.

## Kartet i hjørnet

Banekartet står i fast retning i stedet for å rotere med bilen. Et roterende kart
er lettere å følge i øyeblikket, men da mister man oversikten over hvor på runden
man er. Den delen av runden du har kjørt tegnes opp i klar farge, så avstanden er
noe du ser framfor å måtte lese. Under kartet står runde og meter av rundelengden.

## Grafikken

**Materialene lages i koden.** Spillet skal være én fil, så det finnes ingen
bildefiler å laste. `render/Textures.js` tegner asfalt, gress, betong og curbs
med lagvis støy på et lerret ved oppstart — farge, ruhet og normalkart fra det
samme støyfeltet, med et gitter som wrapper slik at flisene møtes uten skjøt.
Det koster rundt 126 ms én gang, og er forskjellen på asfalt som har korn og
asfalt som er en flat grå flate.

**Skyggene er kaskader.** Ett skyggekart måtte dekke alt på én gang: strakk det
seg langt nok til at trærne framme i veien fikk skygge, ble hver teksel 15 cm —
og bilen kastet i praksis ingen skygge i det hele tatt. Målt: å slå av bilens
skyggekasting endret null piksler. Tre skyggekart deler nå synsfeltet etter
dybde, med grensene satt i meter (14, 55, 260). Det nærmeste gir 1,5 cm per
teksel, ti ganger skarpere enn før, og bilskyggen er målbart der.

**Sola står 30 grader oppe, ikke rett opp.** Midt på dagen falt skyggen under
bilen og landskapet ble flatt. Nå har alt lengde og form, og himmelen viser
hvor lyset kommer fra: en skive med glød rundt.

**Etterbehandlingen** var utsatt fra fase 3 fordi et tidligere forsøk vasket ut
bildet. Årsaken var himmelen: den er en egen ShaderMaterial som skrev rå
verdier uten tonemapping eller fargeromskonvertering. Direkte til skjermen så
det nesten riktig ut, men gjennom kjeden ble de samme verdiene tolket som
lineære og løftet hele bildet 12 %. Himmelen går nå gjennom de samme leddene
som alle andre materialer, og en test måler at etterbehandlet og direkte
rendret bilde er like på 1,5 av 255. Kjeden er `RenderPass` til et lineært
flyttallsmål, uskarpheten regnet på lineære verdier, og `OutputPass` som gjør
tonemapping og sRGB én gang til slutt.

Fartsuskarpheten er radiell og bygger seg opp fra 90 km/t; midt i bildet, der
du sikter, er den skarp. Under terskelen kobles hele kjeden ut og bildet tegnes
rett til skjermen, så effekten koster ingenting når du står stille. På mobil er
den av, og skyggene bruker to kaskader i stedet for tre.

## Lyden

Ingenting er spilt inn. Spillet er én fil, så det finnes ingen lydfiler — alt
lages av oscillatorer og støy i Web Audio. Det er faktisk en fordel for en
motor: en innspilling er låst til turtallene den ble tatt opp ved, mens en
syntetisert motor følger turtallet nøyaktig, også midt i et girskift.

**Motoren** er en firetakts V6, så den tenner tre ganger per veivaksomdreining
og grunntonen er turtall/60 × 3 — 45 Hz på tomgang, 405 Hz mot sperren. Klangen
er tre lag: overtonene som gir kropp, halve tennfrekvensen som gir V6-en dens
ujevne lump, og filtrert støy som er innsug og eksos. Gassen styrer et filter
oppå det hele. Målt: overtonene 6–9 ligger på 0,13 av grunntonene med gassen
sluppet og 0,34 med full gass — motoren lysner altså under belastning i stedet
for bare å bli høyere.

**Resten følger telemetrien.** Dekkene skriker når metningen passerer et punkt
og hjulene faktisk ruller. Vinden vokser med kvadratet av farten, som
luftmotstanden selv. Underlaget rumler ulikt på asfalt, curbs, gress og grus.
Gummistoppen gir et dumpt slag, girskift et tørt klikk, og et brått fartstap
som ikke kommer av bremsene blir et sammenstøt.

Én ting falt ut av modellen uten å være kodet inn: når bilen er i lufta blir
det stille under den, fordi rumlingen skaleres med hjul på bakken.

Nettlesere gir ikke lyd før brukeren har gjort noe, så kjeden bygges på første
tastetrykk eller berøring — ikke ved oppstart. **M** slår lyden av og på, eller
LYD-knappen på mobil.

## Status

- [x] **Fase 0** — kartlegging av miljø og teknologivalg
- [x] **Fase 1** — kjørbar bil med realistisk fysikk, testbane, HUD
- [x] **Fase 2** — cockpit med ratt, instrumenter og tre ekte speil; forfølgende
      kamera med dynamisk synsvinkel, skjelv og helning inn i svingen
- [x] **Fase 3** — 2775 m rundbane med curbs, rekkverk, høydeforskjeller,
      dosering, skog, fjell og terreng som binder seg til banen
- [x] **Fase 4** — materialkart generert i koden, kaskadeskygger, sol på
      himmelen og en etterbehandlingskjede med fartsuskarphet og vignett
- [x] **Fase 5** — lyd syntetisert fra telemetrien: motor, dekk, vind og underlag
- [ ] **Fase 6** — kyst- og fjellbane
- [ ] **Fase 7** — vær og døgnsyklus
- [ ] **Fase 8** — AI-motstandere
- [ ] **Fase 9–11** — spillmoduser, racing-UI og cinematic intro
