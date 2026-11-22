# Klaudijaus tiltas į Claude Code

Mažas serveris tavo kompiuteryje. Klaudijus (naršyklėje) perduoda jam darbą, jis paleidžia
Claude Code tavo projekto aplanke ir grąžina eigą bei rezultatą, kurį Klaudijus pasako balsu.

## Ko reikia
- Node.js 18 ar naujesnio (`node --version`)
- Claude Code, prisijungusio prie tavo paskyros (`claude` veikia terminale)

## Paleidimas
1. Įdėk `tiltas.mjs` į atskirą aplanką, pvz. `C:\Klaudijus\tiltas`.
2. Paleisk `node tiltas.mjs`. Pirmą kartą jis sukurs `tiltas-config.json` ir paprašys nurodyti `workdir`.
3. `tiltas-config.json` įrašyk projekto aplanką, pvz. `"workdir": "C:\\Projektai\\StatykProtingai"`.
4. Vėl paleisk `node tiltas.mjs`. Lange bus parodytas raktas.
5. Klaudijaus nustatymuose, skyriuje „Kompiuteris (Claude Code)“, įvesk raktą ir spausk „Patikrinti ryšį“.
   Chrome gali paklausti, ar leisti puslapiui pasiekti šį kompiuterį: leisk.

## Nustatymai (`tiltas-config.json`)
- `workdir`: aplankas, kuriame dirba Claude Code.
- `permissionMode`: `plan` (tik skaito ir planuoja), `acceptEdits` (skaito ir keičia failus, numatytasis),
  `bypassPermissions` (viskas be klausimų, pavojinga).
- `allowedTools`: kokie įrankiai ir komandos leidžiami be klausimo.
- `model`: Claude Code modelis (tuščia = numatytasis).
- `port`: prievadas (numatytasis 8787).

## Saugumas
- Klausosi tik `127.0.0.1`, todėl pasiekiamas tik iš šio kompiuterio.
- Kiekvienai užklausai reikia rakto; priimamos užklausos tik iš `https://liolikaas.github.io`.
- Raktą laikyk paslaptyje. Jei reikia naujo, ištrink `token` reikšmę konfigūracijoje ir paleisk iš naujo.
