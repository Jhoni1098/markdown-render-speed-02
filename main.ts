// The program the harness runs: node /bot/main.ts (Node 22, erasable TS
// only, no network, read-only /bot and /input, writable /output).
// It reads every case from /input/cases.json, renders each one alone with
// parse() from parse.js, and writes /output/html.json: a JSON array of the
// HTML strings, one per case and in the cases' order. Outside a container,
// MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input and /output.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const raw = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8'));
const cases: { id: string; markdown: string }[] = Array.isArray(raw)
  ? raw
  : raw.cases;

const html: string[] = new Array(cases.length);
for (let k = 0; k < cases.length; k++) {
  html[k] = parse(cases[k].markdown);
}

mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(join(OUTPUT_DIR, 'html.json'), JSON.stringify(html));
