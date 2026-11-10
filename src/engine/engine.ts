import { nextRandom } from './rng';
import {
  ACTIVE_REGEN, BENCH_REGEN, Battler, CreatureDef, Element, GUARD_MULT, MAX_ENERGY, SAME_ELEMENT, StageKey, STAGE_CAP,
  SUPER, TEAM_SIZE, WEAK, damageFor, elementMult, stageMult, toBattler,
} from './rules';

export type Side = 0 | 1;
export type Action = { type: 'move'; index: number } | { type: 'swap'; index: number };

export interface SideState {
  team: Battler[];
  active: number;
  mustReplace: boolean;
}
export interface BattleState {
  seed: number;
  turn: number;
  sides: [SideState, SideState];
  winner: null | Side | 'draw';
}

export type Effectiveness = 'super' | 'weak' | 'neutral';
export type BattleEvent =
  | { type: 'moveUsed'; side: Side; index: number; name: string; element: Element; cost: number; kind: 'damage' | 'heal' | 'raise' | 'lower' | 'guard' }
  | { type: 'damage'; side: Side; amount: number; hp: number; effectiveness: Effectiveness; guarded: boolean }
  | { type: 'heal'; side: Side; amount: number; hp: number }
  | { type: 'statChange'; side: Side; stat: StageKey; delta: number; stage: number }
  | { type: 'guarded'; side: Side }
  | { type: 'fainted'; side: Side; index: number }
  | { type: 'swapped'; side: Side; from: number; to: number; forced: boolean }
  | { type: 'battleEnded'; winner: Side | 'draw' };

export function newBattle(seed: number, teamA: CreatureDef[], teamB: CreatureDef[]): BattleState {
  if (teamA.length !== TEAM_SIZE || teamB.length !== TEAM_SIZE) throw new Error(`teams must have ${TEAM_SIZE} creatures`);
  const mk = (t: CreatureDef[]): SideState => ({ team: t.map(toBattler), active: 0, mustReplace: false });
  return { seed: seed >>> 0, turn: 0, sides: [mk(teamA), mk(teamB)], winner: null };
}

// Fast copy of the mutable parts; stats and moves are never mutated by the engine, so they are shared.
const cloneState = (s: BattleState): BattleState => ({
  ...s,
  sides: s.sides.map((sd) => ({ ...sd, team: sd.team.map((c) => ({ ...c, stages: { ...c.stages } })) })) as [SideState, SideState],
});

const other = (s: Side): Side => (s === 0 ? 1 : 0);
const isIdx = (n: unknown, max: number): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < max;

function validate(state: BattleState, side: Side, a: Action | null | undefined): Action {
  const me = state.sides[side];
  if (!a || (a.type !== 'move' && a.type !== 'swap')) throw new Error(`side ${side}: missing or unknown action`);
  if (a.type === 'move') {
    if (me.mustReplace) throw new Error(`side ${side}: must choose a replacement`);
    const c = me.team[me.active];
    if (!isIdx(a.index, c.moves.length)) throw new Error(`side ${side}: bad move index ${a.index}`);
    const m = c.moves[a.index];
    if (c.energy < m.cost) throw new Error(`side ${side}: ${m.name} costs ${m.cost}, only ${c.energy} energy`);
  } else {
    if (!isIdx(a.index, me.team.length)) throw new Error(`side ${side}: bad swap index ${a.index}`);
    if (a.index === me.active && !me.mustReplace) throw new Error(`side ${side}: already active`);
    if (me.team[a.index].hp <= 0) throw new Error(`side ${side}: creature ${a.index} has fainted`);
  }
  return a;
}

/** All actions side may legally submit right now. */
export function legalActions(state: BattleState, side: Side): Action[] {
  const me = state.sides[side];
  const out: Action[] = [];
  if (state.winner !== null) return out;
  if (!me.mustReplace) {
    const c = me.team[me.active];
    c.moves.forEach((m, index) => c.energy >= m.cost && out.push({ type: 'move', index }));
  }
  me.team.forEach((c, index) => c.hp > 0 && index !== me.active && out.push({ type: 'swap', index }));
  return out;
}

/**
 * Resolve one turn. Pure: same state + actions -> same result. Throws on any illegal action.
 * Replacement phase: if a side has mustReplace, that side submits a swap and the other side null;
 * the replacement is free (no energy regen, turn counter unchanged).
 */
export function resolveTurn(input: BattleState, actionA: Action | null, actionB: Action | null): { state: BattleState; events: BattleEvent[] } {
  if (input.winner !== null) throw new Error('battle is over');
  const s = cloneState(input);
  const events: BattleEvent[] = [];
  const acts = [actionA, actionB];
  let seed = s.seed;
  const rand = () => {
    const [v, n] = nextRandom(seed);
    seed = n;
    return v;
  };
  const act = (i: Side): Battler => s.sides[i].team[s.sides[i].active];
  const swapTo = (i: Side, to: number, forced: boolean) => {
    const me = s.sides[i];
    const from = me.active;
    me.team[from].stages = { atk: 0, def: 0, spd: 0 };
    me.active = to;
    me.mustReplace = false;
    events.push({ type: 'swapped', side: i, from, to, forced });
  };

  // Replacement phase.
  if (s.sides[0].mustReplace || s.sides[1].mustReplace) {
    for (const i of [0, 1] as Side[]) {
      if (s.sides[i].mustReplace) {
        const a = validate(s, i, acts[i]);
        if (a.type !== 'swap') throw new Error(`side ${i}: must choose a replacement`);
      } else if (acts[i] != null) throw new Error(`side ${i}: no action expected during replacement`);
    }
    for (const i of [0, 1] as Side[]) if (s.sides[i].mustReplace) swapTo(i, (acts[i] as Action).index, true);
    s.seed = seed;
    return { state: s, events };
  }

  const chosen: [Action, Action] = [validate(s, 0, actionA), validate(s, 1, actionB)];

  // 1. Swaps.
  for (const i of [0, 1] as Side[]) if (chosen[i].type === 'swap') swapTo(i, chosen[i].index, false);

  const moveOf = (i: Side) => (chosen[i].type === 'move' ? act(i).moves[chosen[i].index] : null);
  const pay = (i: Side, index: number) => {
    const m = act(i).moves[index];
    act(i).energy -= m.cost;
    events.push({ type: 'moveUsed', side: i, index, name: m.name, element: m.element, cost: m.cost, kind: m.effect.kind });
    return m;
  };

  // 2. Guards (resolve before any attack).
  const guarded: [boolean, boolean] = [false, false];
  for (const i of [0, 1] as Side[]) {
    if (moveOf(i)?.effect.kind === 'guard') {
      pay(i, chosen[i].index);
      guarded[i] = true;
      events.push({ type: 'guarded', side: i });
    }
  }

  // 3. Other moves by effective speed; ties by seeded RNG.
  const movers = ([0, 1] as Side[]).filter((i) => {
    const m = moveOf(i);
    return m !== null && m.effect.kind !== 'guard';
  });
  const spd = (i: Side) => act(i).stats.spd * stageMult(act(i).stages.spd);
  if (movers.length === 2) {
    const [x, y] = [spd(0), spd(1)];
    if (x < y || (x === y && rand() < 0.5)) movers.reverse();
  }
  for (const i of movers) {
    const me = act(i);
    if (me.hp <= 0) continue; // fainted before acting
    const m = pay(i, chosen[i].index);
    const foeSide = other(i);
    const foe = act(foeSide);
    const e = m.effect;
    if (e.kind === 'damage') {
      const em = elementMult(m.element, foe.element);
      const roll = 0.9 + 0.1 * rand();
      const same = m.element === me.element ? SAME_ELEMENT : 1;
      const g = guarded[foeSide] ? GUARD_MULT : 1;
      const atk = me.stats.atk * stageMult(me.stages.atk);
      const def = foe.stats.def * stageMult(foe.stages.def);
      const amount = Math.min(foe.hp, damageFor(m.power, atk, def, em, same, g, roll));
      foe.hp -= amount;
      events.push({
        type: 'damage', side: foeSide, amount, hp: foe.hp, guarded: guarded[foeSide],
        effectiveness: em === SUPER ? 'super' : em === WEAK ? 'weak' : 'neutral',
      });
      if (foe.hp <= 0) events.push({ type: 'fainted', side: foeSide, index: s.sides[foeSide].active });
    } else if (e.kind === 'heal') {
      const amount = Math.min(me.maxHp - me.hp, Math.floor((me.maxHp * e.pct) / 100));
      me.hp += amount;
      events.push({ type: 'heal', side: i, amount, hp: me.hp });
    } else if (e.kind === 'raise' || e.kind === 'lower') {
      const target = e.kind === 'raise' ? i : foeSide;
      const t = act(target);
      const before = t.stages[e.stat];
      const stage = Math.max(-STAGE_CAP, Math.min(STAGE_CAP, before + (e.kind === 'raise' ? 1 : -1)));
      t.stages[e.stat] = stage;
      events.push({ type: 'statChange', side: target, stat: e.stat, delta: stage - before, stage });
    }
  }

  // 4. Energy regen, then outcome.
  for (const i of [0, 1] as Side[]) {
    s.sides[i].team.forEach((c, idx) => {
      if (c.hp > 0) c.energy = Math.min(MAX_ENERGY, c.energy + (idx === s.sides[i].active ? ACTIVE_REGEN : BENCH_REGEN));
    });
  }
  const alive = ([0, 1] as Side[]).map((i) => s.sides[i].team.some((c) => c.hp > 0));
  if (!alive[0] || !alive[1]) {
    s.winner = !alive[0] && !alive[1] ? 'draw' : alive[0] ? 0 : 1;
    events.push({ type: 'battleEnded', winner: s.winner });
  } else {
    for (const i of [0, 1] as Side[]) if (act(i).hp <= 0) s.sides[i].mustReplace = true;
  }
  s.turn++;
  s.seed = seed;
  return { state: s, events };
}
