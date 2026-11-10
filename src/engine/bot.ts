import { Action, BattleState, Side, legalActions } from './engine';
import { Battler, elementMult, expectedDamage } from './rules';

type Rand = () => number;
const pick = <T>(xs: T[], rand: Rand): T => xs[Math.floor(rand() * xs.length)];

/** Uniform over affordable moves, with a 15% chance to swap instead. Used by the simulator. */
export function randomBot(state: BattleState, side: Side, rand: Rand): Action {
  const legal = legalActions(state, side);
  const swaps = legal.filter((a) => a.type === 'swap');
  const moves = legal.filter((a) => a.type === 'move');
  if (!moves.length || (swaps.length && rand() < 0.15)) return pick(swaps, rand);
  return pick(moves, rand);
}

// How good a creature looks against a foe: its best hit, minus a penalty for the foe's elemental edge.
const matchup = (me: Battler, foe: Battler) =>
  Math.max(...me.moves.map((m) => expectedDamage(me, foe, m))) / me.maxHp - elementMult(foe.element, me.element) * 0.1;

/** Picks the highest expected-damage affordable move; sometimes guards, heals or swaps to a better matchup. */
export function smartBot(state: BattleState, side: Side, rand: Rand): Action {
  const me = state.sides[side];
  const foe = state.sides[side === 0 ? 1 : 0];
  const legal = legalActions(state, side);
  const swaps = legal.filter((a) => a.type === 'swap');
  const foeActive = foe.team[foe.active];
  const bestSwap = () => swaps.reduce((b, a) => (matchup(me.team[a.index], foeActive) > matchup(me.team[b.index], foeActive) ? a : b));
  if (me.mustReplace) return bestSwap();

  const c = me.team[me.active];
  const moves = legal.filter((a) => a.type === 'move').map((a) => ({ a, m: c.moves[a.index] }));
  const best = moves.reduce((b, x) => (expectedDamage(c, foeActive, x.m) > expectedDamage(c, foeActive, b.m) ? x : b));
  const kind = (k: string) => moves.find((x) => x.m.effect.kind === k);

  if (c.hp < c.maxHp * 0.4 && kind('heal') && rand() < 0.6) return kind('heal')!.a;
  if (kind('guard') && rand() < 0.12) return kind('guard')!.a;
  const edge = elementMult(best.m.element, foeActive.element);
  if (swaps.length && edge < 1 && rand() < 0.35) return bestSwap();
  if (swaps.length && rand() < 0.04) return pick(swaps, rand);
  return best.a;
}
