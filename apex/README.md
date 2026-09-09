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
| `C` | Bytt kamera |
| `R` | Sett bilen tilbake på startlinjen |
| `Esc` | Pause |

Gamepad brukes automatisk hvis det er koblet til: venstre stikke styrer,
avtrekkerne er gass og brems.

## Arkitektur

```
src/
  core/      Loop (fast tidssteg) og Physics (Rapier-innpakning)
  vehicle/   CarConfig, Vehicle, Tire, Drivetrain, VehicleInput, CarModel
  camera/    CameraRig
  world/     TestScene
  ui/        Hud
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

## Status

- [x] **Fase 0** — kartlegging av miljø og teknologivalg
- [x] **Fase 1** — kjørbar bil med realistisk fysikk, testbane, HUD
- [ ] **Fase 2** — cockpit med ratt, instrumenter og speil
- [ ] **Fase 3** — ordentlig testbane med curbs, rekkverk og høydeforskjeller
- [ ] **Fase 4** — grafikk: materialer, refleksjoner, etterbehandling
- [ ] **Fase 5** — lyd drevet av turtall, gir og belastning
- [ ] **Fase 6** — kyst- og fjellbane
- [ ] **Fase 7** — vær og døgnsyklus
- [ ] **Fase 8** — AI-motstandere
- [ ] **Fase 9–11** — spillmoduser, racing-UI og cinematic intro
