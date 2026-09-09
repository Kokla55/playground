# Stjernefall

Et arkadespill som kjører rett i nettleseren — en vertikal romskyter med bølger,
power-ups og en boss hver femte bølge.

Alt ligger i én fil, `index.html`. Ingen byggesteg, ingen avhengigheter, ingen
bilde- eller lydfiler: grafikken er tegnet med canvas, og lydeffektene er
syntetisert med Web Audio.

## Spille

Åpne `index.html` i en nettleser, eller publiser repoet med GitHub Pages
(Settings → Pages → Deploy from branch → `main` / root).

## Kontroller

| Handling | Tastatur | Touch / mus |
| --- | --- | --- |
| Flytt | Piltaster eller WASD | Dra på skjermen |
| Bombe | Mellomrom | Bombe-knappen |
| Pause | P eller Esc | — |
| Lyd av/på | M | Note-ikonet |

Kanonen skyter av seg selv — du styrer bare bevegelsen.

## Slik virker det

- **Bølger.** Fire varianter går på rundgang: rekker av grunts, dykkere i
  V-formasjon, tanks med eskorte, og orbitere som roterer i ring. Hver femte
  bølge er en boss.
- **Bossen** har tre angrepsmønstre (sveipende vifte, siktet salve, utkalling av
  grunts) og skifter til raskere tempo under 40 % helse.
- **Power-ups** faller fra fiender: `W` våpennivå, `R` hurtigskyting, `S` skjold,
  `B` bombe, `+` ekstra liv.
- **Multiplikator** bygger seg opp av kjeder med raske drap og nullstilles når du
  blir truffet.

Rekord og lydinnstilling lagres i `localStorage`.
