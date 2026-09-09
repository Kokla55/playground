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
  world/     TestScene
  ui/        Hud, TouchControls
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
| Vektforskyvning ved 1,16 g brems | 3125 N framover (teori: 2729 N) |

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

## Status

- [x] **Fase 0** — kartlegging av miljø og teknologivalg
- [x] **Fase 1** — kjørbar bil med realistisk fysikk, testbane, HUD
- [x] **Fase 2** — cockpit med ratt, instrumenter og tre ekte speil; forfølgende
      kamera med dynamisk synsvinkel, skjelv og helning inn i svingen
- [ ] **Fase 3** — ordentlig testbane med curbs, rekkverk og høydeforskjeller
- [ ] **Fase 4** — grafikk: materialer, refleksjoner, etterbehandling.
      Ekte fartsuskarphet hører hjemme her: et forsøk på radiell uskarphet
      gjennom `EffectComposer` konverterte fargerommet to ganger og vasket ut
      hele bildet, så pipelinen bygges skikkelig i denne fasen framfor å
      etterlate en ødelagt effekt
- [ ] **Fase 5** — lyd drevet av turtall, gir og belastning
- [ ] **Fase 6** — kyst- og fjellbane
- [ ] **Fase 7** — vær og døgnsyklus
- [ ] **Fase 8** — AI-motstandere
- [ ] **Fase 9–11** — spillmoduser, racing-UI og cinematic intro
