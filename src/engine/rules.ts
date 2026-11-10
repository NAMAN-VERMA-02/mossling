// Types, constants and pure helpers shared by the engine, data, bots and client.

export const ELEMENTS = ['ember', 'frost', 'bloom', 'stone', 'spark', 'tide'] as const;
export type Element = (typeof ELEMENTS)[number];
export type StatKey = 'hp' | 'atk' | 'def' | 'spd';
export type StageKey = 'atk' | 'def' | 'spd';
export type Stats = Record<StatKey, number>;

export type Effect =
  | { kind: 'damage' }
  | { kind: 'heal'; pct: number } // % of max HP, self
  | { kind: 'raise'; stat: StageKey } // self, one stage
  | { kind: 'lower'; stat: StageKey } // foe, one stage
  | { kind: 'guard' };

export interface Move {
  name: string;
  element: Element;
  cost: number;
  power: number; // used by damage moves only
  effect: Effect;
}

export interface CreatureDef {
  id: string;
  name: string;
  element: Element;
  stats: Stats;
  moves: Move[]; // exactly 4
  look: string;
}

export interface Battler {
  id: string;
  name: string;
  element: Element;
  stats: Stats;
  moves: Move[];
  maxHp: number;
  hp: number;
  energy: number;
  stages: Record<StageKey, number>;
}

export const STAT_BUDGET = 400;
export const STAT_MIN = 50;
export const STAT_MAX = 160;
export const HP_MULT = 3;
export const MAX_ENERGY = 10;
export const START_ENERGY = 5;
export const ACTIVE_REGEN = 2;
export const BENCH_REGEN = 1;
export const STAGE_CAP = 2;
export const STAGE_BASE = 1.25;
export const SUPER = 1.5;
export const WEAK = 0.67;
export const SAME_ELEMENT = 1.25;
export const GUARD_MULT = 0.5;
export const TEAM_SIZE = 3;

/** Strong (1.5) vs the next two on the wheel, weak (0.67) vs the previous two, else 1. */
export function elementMult(att: Element, def: Element): number {
  const d = (ELEMENTS.indexOf(def) - ELEMENTS.indexOf(att) + 6) % 6;
  if (d === 1 || d === 2) return SUPER;
  if (d === 4 || d === 5) return WEAK;
  return 1;
}

export const stageMult = (stage: number) => Math.pow(STAGE_BASE, stage);

export function damageFor(power: number, atk: number, def: number, elem: number, same: number, guard: number, roll: number): number {
  return Math.max(1, Math.floor(power * (atk / def) * elem * same * guard * roll));
}

/** Expected damage (roll 0.95, no guard) of a move from a to d, using current stages. */
export function expectedDamage(a: Battler, d: Battler, m: Move): number {
  if (m.effect.kind !== 'damage') return 0;
  const same = m.element === a.element ? SAME_ELEMENT : 1;
  const atk = a.stats.atk * stageMult(a.stages.atk);
  const def = d.stats.def * stageMult(d.stages.def);
  return m.power * (atk / def) * elementMult(m.element, d.element) * same * 0.95;
}

/** Four positive weights -> legal spread: sums to 400, each 50..160, integers. Clamp, then renormalise the rest. */
export function makeStats(weights: number[]): Stats {
  if (weights.length !== 4 || weights.some((w) => !(w > 0) || !Number.isFinite(w))) {
    throw new Error('makeStats needs four positive finite weights');
  }
  const v = [...weights];
  const pinned: (number | null)[] = [null, null, null, null];
  for (;;) {
    const rem = STAT_BUDGET - pinned.reduce<number>((s, p) => s + (p ?? 0), 0);
    const free = [0, 1, 2, 3].filter((i) => pinned[i] === null);
    const wsum = free.reduce((s, i) => s + weights[i], 0);
    for (const i of free) v[i] = (weights[i] / wsum) * rem;
    const low = free.reduce((s, i) => s + Math.max(0, STAT_MIN - v[i]), 0);
    const high = free.reduce((s, i) => s + Math.max(0, v[i] - STAT_MAX), 0);
    if (low === 0 && high === 0) break;
    // Pin only the side with the larger violation, so one pin cannot over-correct the other.
    for (const i of free) {
      if (high >= low && v[i] > STAT_MAX) pinned[i] = STAT_MAX;
      else if (high < low && v[i] < STAT_MIN) pinned[i] = STAT_MIN;
    }
  }
  for (let i = 0; i < 4; i++) if (pinned[i] !== null) v[i] = pinned[i]!;
  const out = v.map(Math.floor);
  let left = STAT_BUDGET - out.reduce((s, x) => s + x, 0);
  const byFrac = [0, 1, 2, 3].sort((a, b) => v[b] - out[b] - (v[a] - out[a]));
  for (const i of byFrac) {
    if (left > 0 && out[i] < STAT_MAX) {
      out[i]++;
      left--;
    }
  }
  return { hp: out[0], atk: out[1], def: out[2], spd: out[3] };
}

export function validateDef(def: CreatureDef): void {
  const { stats } = def;
  const vals = [stats.hp, stats.atk, stats.def, stats.spd];
  if (vals.some((x) => !Number.isInteger(x) || x < STAT_MIN || x > STAT_MAX) || vals.reduce((s, x) => s + x, 0) !== STAT_BUDGET) {
    throw new Error(`${def.id}: stats must be integers ${STAT_MIN}..${STAT_MAX} totalling ${STAT_BUDGET}`);
  }
  if (def.moves.length !== 4) throw new Error(`${def.id}: needs exactly 4 moves`);
  if (!def.moves.some((m) => m.cost === 0)) throw new Error(`${def.id}: needs a 0-cost move`);
  for (const m of def.moves) {
    if (!Number.isInteger(m.cost) || m.cost < 0 || m.cost > 6) throw new Error(`${def.id}/${m.name}: cost must be 0..6`);
    if (m.effect.kind === 'damage' && !(m.power > 0)) throw new Error(`${def.id}/${m.name}: damage move needs power`);
  }
}

/** Build a legal creature definition from four weights [hp, atk, def, spd]. */
export function makeCreature(id: string, name: string, element: Element, weights: number[], moves: Move[], look: string): CreatureDef {
  const def: CreatureDef = { id, name, element, stats: makeStats(weights), moves, look };
  validateDef(def);
  return def;
}

export function toBattler(def: CreatureDef): Battler {
  validateDef(def);
  return {
    id: def.id,
    name: def.name,
    element: def.element,
    stats: { ...def.stats },
    moves: def.moves.map((m) => ({ ...m, effect: { ...m.effect } })),
    maxHp: def.stats.hp * HP_MULT,
    hp: def.stats.hp * HP_MULT,
    energy: START_ENERGY,
    stages: { atk: 0, def: 0, spd: 0 },
  };
}
