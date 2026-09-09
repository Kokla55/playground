/**
 * Setter sammen dist/ til én selvstendig HTML-fil for publisering.
 *
 * Artefakt-tjenesten legger selv på <!doctype>, <html>, <head> og <body>, så
 * her skrives bare innholdet: tittel, stiler, markup og skriptet inlinet.
 * Rapier-WASM ligger allerede som base64 inne i bundlen.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const out = process.argv[2];
if (!out) throw new Error('bruk: node scripts/artifact.mjs <utfil.html>');

let html = readFileSync(join(dist, 'index.html'), 'utf8');

const script = /<script[^>]*src="([^"]+)"[^>]*><\/script>/.exec(html);
if (!script) throw new Error('fant ikke skript-taggen i dist/index.html');
const jsName = script[1].replace(/^\.?\//, '');
const js = readFileSync(join(dist, jsName), 'utf8');
// Erstatning som funksjon: en tekststreng ville fått $-sekvensene i den
// minifiserte bundlen tolket som bakreferanser, og skriptet ble ødelagt.
html = html.replace(script[0], () => `<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>`);

// Skall og meta som tjenesten legger på selv.
const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? '';
const body = /<body>([\s\S]*?)<\/body>/.exec(html)?.[1] ?? '';
const cleanHead = head
  .replace(/<meta\s+charset[^>]*>/gi, '')
  .replace(/<meta\s+name="viewport"[^>]*>/gi, '')
  .trim();

writeFileSync(out, `${cleanHead}\n${body.trim()}\n`);

const kb = (readFileSync(out).length / 1024 / 1024).toFixed(2);
const rest = readdirSync(join(dist, 'assets')).filter((f) => !f.endsWith('.js'));
console.log(`skrev ${out} — ${kb} MB`);
if (rest.length) console.log(`ADVARSEL: filer som ikke ble inlinet: ${rest.join(', ')}`);
