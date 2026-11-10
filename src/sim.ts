// 10,000 random-bot battles with random teams of 3 (distinct creatures, no mirror within a team).
// Win rate of an element/creature = share of battles won by teams containing it (draws count half).
import { CREATURES } from './data/creatures';
import { randomBot } from './engine/bot';
import { newBattle, resolveTurn } from './engine/engine';
import { ELEMENTS } from './engine/rules';
import { makeRng } from './engine/rng';

const N = Number(process.env.SIM_N ?? 10000);
const rand = makeRng(12345);
const tally = <K extends string>() => new Map<K, { w: number; n: number }>();
const byEl = tally<string>();
const byCr = tally<string>();
const bump = (m: Map<string, { w: number; n: number }>, k: string, score: number) => {
  const e = m.get(k) ?? { w: 0, n: 0 };
  e.w += score;
  e.n++;
  m.set(k, e);
};
const team = () => {
  const pool = [...CREATURES];
  return [0, 1, 2].map(() => pool.splice(Math.floor(rand() * pool.length), 1)[0]);
};

let turns = 0;
for (let b = 0; b < N; b++) {
  const ta = team();
  const tb = team();
  let s = newBattle(Math.floor(rand() * 2 ** 32), ta, tb);
  while (s.winner === null) {
    const pa = s.sides[0].mustReplace || !s.sides[1].mustReplace;
    const pb = s.sides[1].mustReplace || !s.sides[0].mustReplace;
    s = resolveTurn(s, pa ? randomBot(s, 0, rand) : null, pb ? randomBot(s, 1, rand) : null).state;
    if (s.turn > 500) throw new Error('battle did not terminate');
  }
  turns += s.turn;
  const score = (side: 0 | 1) => (s.winner === 'draw' ? 0.5 : s.winner === side ? 1 : 0);
  ([ta, tb] as const).forEach((t, side) => {
    for (const e of new Set(t.map((c) => c.element))) bump(byEl, e, score(side as 0 | 1));
    for (const c of t) bump(byCr, c.id, score(side as 0 | 1));
  });
}

const pct = (e: { w: number; n: number }) => (100 * e.w) / e.n;
console.log(`\nMossling sim: ${N} battles, random bots, random teams`);
console.log('\nElement   win%   (team appearances)');
for (const el of ELEMENTS) console.log(`${el.padEnd(9)} ${pct(byEl.get(el)!).toFixed(1).padStart(5)}  (${byEl.get(el)!.n})`);
console.log('\nCreature    element  win%');
for (const c of CREATURES) console.log(`${c.id.padEnd(11)} ${c.element.padEnd(8)} ${pct(byCr.get(c.id)!).toFixed(1).padStart(5)}`);
const avg = turns / N;
console.log(`\nAverage battle length: ${avg.toFixed(2)} turns`);
const elOk = ELEMENTS.every((el) => pct(byEl.get(el)!) >= 45 && pct(byEl.get(el)!) <= 55);
const lenOk = avg >= 8 && avg <= 25;
console.log(`Targets: elements 45-55% ${elOk ? 'PASS' : 'FAIL'}, length 8-25 ${lenOk ? 'PASS' : 'FAIL'}`);
process.exitCode = elOk && lenOk ? 0 : 1;
