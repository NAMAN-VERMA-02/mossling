import { describe, expect, it } from 'vitest';
import { CREATURES } from '../data/creatures';
import { randomBot } from './bot';
import { Action, BattleEvent, BattleState, newBattle, resolveTurn } from './engine';
import { nextRandom, makeRng } from './rng';
import { ELEMENTS, Element, Move, damageFor, elementMult, makeCreature, makeStats } from './rules';

const hit = (power: number, cost = 0, element: Element = 'ember'): Move => ({ name: `hit${power}`, element, cost, power, effect: { kind: 'damage' } });
const util = (effect: Move['effect'], cost = 0): Move => ({ name: effect.kind, element: 'ember', cost, power: 0, effect });
const std = (): Move[] => [hit(40), hit(80, 3), util({ kind: 'guard' }, 1), util({ kind: 'heal', pct: 50 }, 2)];
const mk = (id: string, weights = [100, 100, 100, 100], element: Element = 'ember', moves: Move[] = std()) =>
  makeCreature(id, id, element, weights, moves, 'a round blob.');
const team = (w: number[] = [100, 100, 100, 100], el: Element = 'ember', moves?: Move[]) => [mk('a', w, el, moves), mk('b', w, el, moves), mk('c', w, el, moves)];
const battle = (a = team(), b = team(), seed = 7) => newBattle(seed, a, b);
const move = (index: number): Action => ({ type: 'move', index });
const swap = (index: number): Action => ({ type: 'swap', index });
const of = <T extends BattleEvent['type']>(ev: BattleEvent[], t: T) => ev.filter((e) => e.type === t) as Extract<BattleEvent, { type: T }>[];
const edit = (s: BattleState, f: (s: BattleState) => void) => {
  const c = structuredClone(s);
  f(c);
  return c;
};

describe('stat budget', () => {
  it('equal weights give 100 each', () => expect(makeStats([1, 1, 1, 1])).toEqual({ hp: 100, atk: 100, def: 100, spd: 100 }));
  it('clamps extremes and renormalises', () => {
    expect(makeStats([1000, 1, 1, 1])).toEqual({ hp: 160, atk: 80, def: 80, spd: 80 });
    expect(makeStats([1, 1000, 1000, 1])).toEqual({ hp: 50, atk: 150, def: 150, spd: 50 });
  });
  it('always legal for random weights', () => {
    const r = makeRng(1);
    for (let i = 0; i < 2000; i++) {
      const s = makeStats([0.01 + r() * r() * 1000, 0.01 + r() * 50, 0.01 + r() * r() * r() * 900, 0.5 + r() * 400]);
      const v = [s.hp, s.atk, s.def, s.spd];
      expect(v.reduce((a, b) => a + b, 0)).toBe(400);
      for (const x of v) {
        expect(Number.isInteger(x)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(50);
        expect(x).toBeLessThanOrEqual(160);
      }
    }
  });
  it('rejects non-positive weights', () => {
    expect(() => makeStats([0, 1, 1, 1])).toThrow();
    expect(() => makeStats([1, -1, 1, 1])).toThrow();
    expect(() => makeStats([1, 1, 1])).toThrow();
  });
  it('battle max HP is hp x 3', () => expect(battle().sides[0].team[0].maxHp).toBe(300));
  it('makeCreature demands a 0-cost move and 4 moves', () => {
    expect(() => mk('x', undefined, 'ember', [hit(10, 1), hit(10, 1), hit(10, 1), hit(10, 1)])).toThrow();
    expect(() => mk('x', undefined, 'ember', [hit(10)])).toThrow();
  });
});

describe('elements', () => {
  // Hand-written from the wheel: ember frost bloom stone spark tide.
  const strong: Record<Element, Element[]> = {
    ember: ['frost', 'bloom'], frost: ['bloom', 'stone'], bloom: ['stone', 'spark'],
    stone: ['spark', 'tide'], spark: ['tide', 'ember'], tide: ['ember', 'frost'],
  };
  const weak: Record<Element, Element[]> = {
    ember: ['tide', 'spark'], frost: ['ember', 'tide'], bloom: ['frost', 'ember'],
    stone: ['bloom', 'frost'], spark: ['stone', 'bloom'], tide: ['spark', 'stone'],
  };
  it('all 36 pairings', () => {
    for (const a of ELEMENTS) {
      for (const d of ELEMENTS) {
        const want = strong[a].includes(d) ? 1.5 : weak[a].includes(d) ? 0.67 : 1;
        expect(elementMult(a, d), `${a} vs ${d}`).toBe(want);
      }
    }
  });
  it('strong/weak are mirrored', () => {
    for (const a of ELEMENTS) for (const d of ELEMENTS) expect(elementMult(a, d) === 1.5).toBe(elementMult(d, a) === 0.67);
  });
});

describe('damage', () => {
  const rollFor = (seed: number) => 0.9 + 0.1 * nextRandom(seed)[0];
  it('matches the formula incl. element, same-element bonus and roll', () => {
    // A: spd 160-ish so it moves first and takes the first RNG draw.
    const a = [mk('a', [100, 130, 60, 110], 'ember', [hit(50, 0, 'ember'), ...std().slice(1)]), mk('a2'), mk('a3')];
    const b = [mk('b', [100, 100, 80, 80], 'frost'), mk('b2'), mk('b3')];
    const s = battle(a, b, 99);
    const { events } = resolveTurn(s, move(0), move(0));
    const d = of(events, 'damage')[0];
    const want = damageFor(50, a[0].stats.atk, b[0].stats.def, 1.5, 1.25, 1, rollFor(99));
    expect(d.side).toBe(1);
    expect(d.amount).toBe(want);
    expect(d.effectiveness).toBe('super');
    expect(d.hp).toBe(s.sides[1].team[0].maxHp - want);
  });
  it('is at least 1', () => {
    const a = [mk('a', [150, 50, 100, 100], 'stone', [hit(1, 0, 'stone'), ...std().slice(1)]), mk('a2'), mk('a3')];
    const b = [mk('b', [60, 60, 160, 120], 'bloom'), mk('b2'), mk('b3')];
    const { events } = resolveTurn(battle(a, b), move(0), move(2));
    expect(of(events, 'damage')[0].amount).toBe(1);
  });
  it('roll stays within 0.9..1.0 of the unrolled value', () => {
    const base = 40; // equal stats, same element: 40 * 1.25 = 50
    for (let seed = 0; seed < 100; seed++) {
      const d = of(resolveTurn(battle(team(), team(), seed), move(0), move(0)).events, 'damage')[0];
      expect(d.amount).toBeGreaterThanOrEqual(Math.floor(base * 1.25 * 0.9));
      expect(d.amount).toBeLessThanOrEqual(base * 1.25);
    }
  });
  it('uses stages on atk and def', () => {
    const atkMoves = [hit(40), util({ kind: 'raise', stat: 'atk' }), util({ kind: 'lower', stat: 'def' }), util({ kind: 'guard' }, 1)];
    let s = battle(team(undefined, 'ember', atkMoves), team());
    s = resolveTurn(s, move(1), move(0)).state; // A atk +1
    const { events } = resolveTurn(s, move(0), move(2));
    const want = damageFor(40, 100 * 1.25, 100, 1, 1.25, 0.5, rollFor(s.seed)); // B guards
    expect(of(events, 'damage')[0].amount).toBe(want);
  });
});

describe('energy', () => {
  it('starts at 5, spends cost, regens +2 active / +1 bench (cap 10)', () => {
    let s = battle();
    expect(s.sides[0].team.map((c) => c.energy)).toEqual([5, 5, 5]);
    s = resolveTurn(s, move(1), move(0)).state; // cost 3 -> 2, +2 = 4
    expect(s.sides[0].team.map((c) => c.energy)).toEqual([4, 6, 6]);
    expect(s.sides[1].team.map((c) => c.energy)).toEqual([7, 6, 6]);
  });
  it('caps at 10', () => {
    const s = edit(battle(), (x) => {
      x.sides[0].team[0].energy = 9;
      x.sides[0].team[1].energy = 10;
    });
    const r = resolveTurn(s, move(2), move(2)).state; // guard costs 1
    expect(r.sides[0].team.map((c) => c.energy)).toEqual([10, 10, 6]);
  });
  it('rejects unaffordable moves', () => {
    let s = battle();
    s = edit(s, (x) => (x.sides[0].team[0].energy = 2));
    expect(() => resolveTurn(s, move(1), move(0))).toThrow(/costs 3/);
    expect(() => resolveTurn(s, move(2), move(0))).not.toThrow();
  });
});

describe('turn order', () => {
  const spdTeam = (spd: number, atk = 100) => team([100, atk, 100, spd]);
  const fastSlow = () => battle(spdTeam(120), spdTeam(60, 140));
  it('faster creature acts first', () => {
    expect(of(resolveTurn(fastSlow(), move(0), move(0)).events, 'moveUsed').map((e) => e.side)).toEqual([0, 1]);
    expect(of(resolveTurn(battle(spdTeam(60), spdTeam(120)), move(0), move(0)).events, 'moveUsed').map((e) => e.side)).toEqual([1, 0]);
  });
  it('a fainted creature does not act', () => {
    let s = fastSlow();
    s = edit(s, (x) => (x.sides[1].team[0].hp = 1));
    const { events } = resolveTurn(s, move(0), move(0));
    expect(of(events, 'moveUsed')).toHaveLength(1);
    expect(of(events, 'fainted')).toEqual([{ type: 'fainted', side: 1, index: 0 }]);
  });
  it('stage changes alter order', () => {
    const slowMoves = [hit(40), util({ kind: 'raise', stat: 'spd' }), util({ kind: 'guard' }, 1), util({ kind: 'heal', pct: 10 }, 2)];
    const slow = [mk('s', [100, 100, 100, 100], 'ember', slowMoves), mk('s2'), mk('s3')];
    const fast = [mk('f', [90, 100, 100, 110]), mk('f2'), mk('f3')];
    let s = battle(slow, fast);
    expect(of(resolveTurn(s, move(0), move(0)).events, 'moveUsed')[0].side).toBe(1);
    s = resolveTurn(s, move(1), move(0)).state; // +1 spd: 125 > 110
    s = resolveTurn(s, move(0), move(0)).state;
    expect(s.sides[0].team[0].stages.spd).toBe(1);
    expect(of(resolveTurn(s, move(0), move(0)).events, 'moveUsed')[0].side).toBe(0);
  });
  it('ties are decided by the seeded RNG, both outcomes occur, and each seed is stable', () => {
    const first = (seed: number) => of(resolveTurn(battle(team(), team(), seed), move(0), move(0)).events, 'moveUsed')[0].side;
    const seen = new Set<number>();
    for (let seed = 0; seed < 40; seed++) {
      seen.add(first(seed));
      expect(first(seed)).toBe(first(seed));
      expect(first(seed)).toBe(nextRandom(seed)[0] < 0.5 ? 1 : 0);
    }
    expect(seen.size).toBe(2);
  });
});

describe('guard', () => {
  it('halves damage, resolves before attacks even for the slower user, emits guarded first', () => {
    const s = battle(team([100, 140, 100, 60]), team()); // A is slower
    const r = resolveTurn(s, move(2), move(0));
    const types = r.events.map((e) => e.type);
    expect(types.indexOf('guarded')).toBeLessThan(types.indexOf('damage'));
    const d = of(r.events, 'damage')[0];
    expect(d.guarded).toBe(true);
    expect(d.amount).toBe(damageFor(40, 100, 100, 1, 1.25, 0.5, 0.9 + 0.1 * nextRandom(7)[0]));
  });
  it('lasts one turn only', () => {
    let s = battle();
    s = resolveTurn(s, move(2), move(2)).state;
    const d = of(resolveTurn(s, move(0), move(0)).events, 'damage').find((e) => e.side === 1)!;
    expect(d.guarded).toBe(false);
  });
  it('costs energy', () => {
    const s = resolveTurn(battle(), move(2), move(2)).state;
    expect(s.sides[0].team[0].energy).toBe(5 - 1 + 2);
  });
});

describe('heal and stat moves', () => {
  it('heals a percentage of max HP, capped', () => {
    let s = edit(battle(), (x) => (x.sides[0].team[0].hp = 100));
    let r = resolveTurn(s, move(3), move(2));
    expect(of(r.events, 'heal')[0]).toMatchObject({ side: 0, amount: 150, hp: 250 });
    s = edit(s, (x) => (x.sides[0].team[0].hp = 290));
    r = resolveTurn(s, move(3), move(2));
    expect(of(r.events, 'heal')[0]).toMatchObject({ amount: 10, hp: 300 });
  });
  it('stages cap at +2 and -2', () => {
    const mv = [hit(40), util({ kind: 'raise', stat: 'atk' }), util({ kind: 'lower', stat: 'def' }), util({ kind: 'guard' }, 1)];
    let s = battle(team(undefined, 'ember', mv), team(undefined, 'ember', mv));
    const raised: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = resolveTurn(s, move(1), move(2)); // A raises own atk, B lowers A's def
      s = r.state;
      raised.push(...of(r.events, 'statChange').filter((e) => e.stat === 'atk').map((e) => e.delta));
    }
    expect(raised).toEqual([1, 1, 0, 0]);
    expect(s.sides[0].team[0].stages).toEqual({ atk: 2, def: -2, spd: 0 });
  });
  it('lower targets the foe, raise targets self', () => {
    const mv = [hit(40), util({ kind: 'raise', stat: 'spd' }), util({ kind: 'lower', stat: 'spd' }), util({ kind: 'guard' }, 1)];
    const t = () => team(undefined, 'ember', mv);
    expect(of(resolveTurn(battle(t(), t()), move(1), move(3)).events, 'statChange')).toEqual([{ type: 'statChange', side: 0, stat: 'spd', delta: 1, stage: 1 }]);
    expect(of(resolveTurn(battle(t(), t()), move(2), move(3)).events, 'statChange')).toEqual([{ type: 'statChange', side: 1, stat: 'spd', delta: -1, stage: -1 }]);
  });
});

describe('swaps', () => {
  it('resolve before attacks: the attack hits the newcomer', () => {
    const s = battle();
    const { events, state } = resolveTurn(s, move(0), swap(2));
    expect(events[0]).toEqual({ type: 'swapped', side: 1, from: 0, to: 2, forced: false });
    expect(of(events, 'damage')[0].side).toBe(1);
    expect(state.sides[1].team[2].hp).toBeLessThan(300);
    expect(state.sides[1].team[0].hp).toBe(300);
    expect(state.sides[1].active).toBe(2);
  });
  it('reset the departing creature stages and cost no energy', () => {
    const mv = [hit(40), util({ kind: 'raise', stat: 'atk' }), util({ kind: 'guard' }, 1), util({ kind: 'heal', pct: 5 }, 2)];
    let s = battle(team(undefined, 'ember', mv), team());
    s = resolveTurn(s, move(1), move(2)).state;
    expect(s.sides[0].team[0].stages.atk).toBe(1);
    s = resolveTurn(s, swap(1), move(2)).state;
    expect(s.sides[0].team[0].stages.atk).toBe(0);
    expect(s.sides[0].team[1].energy).toBe(5 + 2 + 1); // +1 bench earlier, +2 as new active
  });
  it('both sides can swap in the same turn', () => {
    const r = resolveTurn(battle(), swap(1), swap(2));
    expect(of(r.events, 'swapped')).toHaveLength(2);
    expect(of(r.events, 'damage')).toHaveLength(0);
  });
});

describe('forced replacement', () => {
  const kill = () => {
    const s = edit(battle(), (x) => (x.sides[1].team[0].hp = 1));
    return resolveTurn(s, move(0), move(2)).state;
  };
  it('flags the owner, then a free swap is required', () => {
    const s = kill();
    expect(s.sides[1].mustReplace).toBe(true);
    expect(s.sides[0].mustReplace).toBe(false);
    expect(s.winner).toBeNull();
    expect(() => resolveTurn(s, move(0), move(0))).toThrow();
    expect(() => resolveTurn(s, move(0), swap(1))).toThrow(); // other side must pass null
    expect(() => resolveTurn(s, null, move(0))).toThrow();
    expect(() => resolveTurn(s, null, swap(0))).toThrow(); // fainted
    const r = resolveTurn(s, null, swap(1));
    expect(r.events).toEqual([{ type: 'swapped', side: 1, from: 0, to: 1, forced: true }]);
    expect(r.state.sides[1].active).toBe(1);
    expect(r.state.sides[1].mustReplace).toBe(false);
    expect(r.state.turn).toBe(s.turn);
    expect(r.state.sides[0].team.map((c) => c.energy)).toEqual(s.sides[0].team.map((c) => c.energy));
  });
  it('both sides can need replacements at once', () => {
    const s = edit(battle(), (x) => {
      for (const sd of x.sides) {
        sd.team[0].hp = 0;
        sd.mustReplace = true;
      }
    });
    const r = resolveTurn(s, swap(1), swap(2));
    expect(r.state.sides.map((x) => x.active)).toEqual([1, 2]);
    expect(() => resolveTurn(s, swap(1), null)).toThrow();
  });
});

describe('win and draw', () => {
  const lastStand = () =>
    edit(battle(), (x) => {
      for (const sd of x.sides) {
        sd.team[1].hp = 0;
        sd.team[2].hp = 0;
      }
      x.sides[1].team[0].hp = 1;
    });
  it('all three fainted is a loss', () => {
    const r = resolveTurn(lastStand(), move(0), move(2));
    expect(r.state.winner).toBe(0);
    expect(of(r.events, 'battleEnded')).toEqual([{ type: 'battleEnded', winner: 0 }]);
    expect(r.state.sides[1].mustReplace).toBe(false);
    expect(() => resolveTurn(r.state, move(0), move(0))).toThrow(/over/);
  });
  it('the other side can win too', () => {
    const s = edit(lastStand(), (x) => {
      x.sides[1].team[0].hp = 300;
      x.sides[0].team[0].hp = 1;
    });
    const fastFoe = edit(s, (x) => (x.sides[1].team[0].stats = { hp: 100, atk: 100, def: 100, spd: 160 }));
    expect(resolveTurn(fastFoe, move(0), move(0)).state.winner).toBe(1);
  });
  it('both sides wiped in the same turn is a draw', () => {
    // Unreachable through legal play (the first mover always kills before the other acts), so build the state directly.
    const s = edit(battle(), (x) => {
      for (const sd of x.sides) sd.team.forEach((c) => (c.hp = 0));
    });
    const r = resolveTurn(s, move(0), move(0));
    expect(r.state.winner).toBe('draw');
    expect(of(r.events, 'battleEnded')).toEqual([{ type: 'battleEnded', winner: 'draw' }]);
  });
});

describe('illegal actions throw', () => {
  const s = battle();
  it.each([
    ['negative move index', move(-1)],
    ['move index 4', move(4)],
    ['fractional index', move(1.5)],
    ['swap index 3', swap(3)],
    ['swap to active', swap(0)],
    ['unknown type', { type: 'dance', index: 0 } as unknown as Action],
    ['null', null as unknown as Action],
  ])('%s', (_n, a) => {
    expect(() => resolveTurn(s, a, move(0))).toThrow();
    expect(() => resolveTurn(s, move(0), a)).toThrow();
  });
  it('swap to a fainted creature', () => {
    const f = edit(s, (x) => (x.sides[0].team[1].hp = 0));
    expect(() => resolveTurn(f, swap(1), move(0))).toThrow(/fainted/);
  });
  it('does not mutate its input', () => {
    const before = JSON.stringify(s);
    resolveTurn(s, move(0), move(0));
    try {
      resolveTurn(s, move(9), move(0));
    } catch {
      /* expected */
    }
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('determinism', () => {
  const play = (seed: number) => {
    const rand = makeRng(seed);
    const pool = [...CREATURES];
    const pick = () => [0, 1, 2].map(() => pool.splice(Math.floor(rand() * pool.length), 1)[0]);
    let s = newBattle(seed, pick(), pick());
    const log: BattleEvent[][] = [];
    while (s.winner === null) {
      const p0 = s.sides[0].mustReplace || !s.sides[1].mustReplace;
      const p1 = s.sides[1].mustReplace || !s.sides[0].mustReplace;
      const r = resolveTurn(s, p0 ? randomBot(s, 0, rand) : null, p1 ? randomBot(s, 1, rand) : null);
      log.push(r.events);
      s = r.state;
    }
    return { s, log };
  };
  it('same state + actions -> identical result', () => {
    const s = battle();
    expect(resolveTurn(s, move(0), move(1))).toEqual(resolveTurn(s, move(0), move(1)));
  });
  it('whole battles replay identically and always finish', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const a = play(seed);
      expect(play(seed)).toEqual(a);
      expect(a.s.winner).not.toBeNull();
    }
  });
  it('state is plain JSON', () => {
    const s = resolveTurn(battle(), move(0), move(1)).state;
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
  it('advances the seed', () => {
    const s = battle();
    expect(resolveTurn(s, move(0), move(0)).state.seed).not.toBe(s.seed);
  });
});

describe('creature data', () => {
  it('12 creatures, 2 per element, legal', () => {
    expect(CREATURES).toHaveLength(12);
    for (const el of ELEMENTS) expect(CREATURES.filter((c) => c.element === el)).toHaveLength(2);
    expect(new Set(CREATURES.map((c) => c.id)).size).toBe(12);
    for (const c of CREATURES) {
      expect(c.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      const v = Object.values(c.stats);
      expect(v.reduce((a, b) => a + b, 0)).toBe(400);
      expect(v.every((x) => x >= 50 && x <= 160)).toBe(true);
      expect(c.moves).toHaveLength(4);
      expect(c.moves.some((m) => m.cost === 0)).toBe(true);
      expect(c.moves.every((m) => m.cost >= 0 && m.cost <= 6)).toBe(true);
      expect(c.look.length).toBeGreaterThan(20);
    }
    for (const el of ELEMENTS) {
      const [a, b] = CREATURES.filter((c) => c.element === el);
      expect(JSON.stringify(a.stats)).not.toBe(JSON.stringify(b.stats));
    }
  });
  it('move names are unique', () => {
    const names = CREATURES.flatMap((c) => c.moves.map((m) => m.name));
    expect(new Set(names).size).toBe(names.length);
  });
});
