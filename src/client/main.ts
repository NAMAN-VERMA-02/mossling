import './style.css';
import { CREATURES } from '../data/creatures';
import { smartBot } from '../engine/bot';
import { Action, BattleEvent, BattleState, Side, newBattle, resolveTurn } from '../engine/engine';
import { createHud } from './hud';
import { STAT_LABEL, ELEMENT_COLOR } from './theme';
import { Actor, World, ease } from './world';

const world = new World(document.getElementById('world') as HTMLCanvasElement);
let state: BattleState; // the real engine state
let view: BattleState; // what the HUD shows while events are still animating
let busy = true;

const hud = createHud(document.getElementById('hud')!, {
  onMove: (index) => void submit({ type: 'move', index }),
  onSwap: (index) => void submit({ type: 'swap', index }),
  onNew: () => void startBattle(),
});

const active = (s: BattleState, side: Side) => s.sides[side].team[s.sides[side].active];
const who = (side: Side) => (side === 0 ? '' : 'Rival ') + active(view, side).name;
const refresh = () => hud.render(view, { busy });
const randomTeam = () => [...CREATURES].sort(() => Math.random() - 0.5).slice(0, 3);

function floatText(side: Side, text: string, color: string, big = false, lift = 2.4) {
  const p = world.project(world.actors[side].anchor(lift));
  hud.float(p.x + (Math.random() - 0.5) * 24, p.y, text, color, big);
}

const sleep = (ms: number) => world.wait(ms);
const hopOf = (a: Actor, ms = 320) => world.tween(ms, (t) => (a.hop = Math.sin(t * Math.PI)));
const pop = (a: Actor) => world.tween(520, (t) => (a.vis = t), ease.back);

async function appear(side: Side) {
  const a = world.actors[side];
  await a.setCreature(active(view, side));
  a.vis = 0;
  await pop(a);
}

async function playEvent(e: BattleEvent) {
  const a = world.actors[e.type === 'battleEnded' ? 0 : e.side];
  switch (e.type) {
    case 'moveUsed': {
      const c = active(view, e.side);
      c.energy -= e.cost;
      hud.log(`${who(e.side)} used ${e.name}!`);
      refresh();
      floatText(e.side, e.name, ELEMENT_COLOR[e.element], false, 3.1);
      if (e.kind === 'damage') {
        await world.tween(230, (t) => (a.lunge = t), ease.out);
        void world.tween(300, (t) => (a.lunge = 1 - t));
      } else await hopOf(a);
      break;
    }
    case 'damage': {
      const c = active(view, e.side);
      c.hp = e.hp;
      const col = { super: '#ff8a3d', weak: '#9fb0d9', neutral: '#ffffff' }[e.effectiveness];
      floatText(e.side, `-${e.amount}${e.effectiveness === 'super' ? '!' : ''}`, col, e.effectiveness === 'super');
      hud.log(
        `${who(e.side)} took ${e.amount} damage.` +
          (e.effectiveness === 'super' ? ' Super effective!' : e.effectiveness === 'weak' ? ' Not very effective.' : '') +
          (e.guarded ? ' (guarded)' : ''),
      );
      refresh();
      await world.tween(420, (t) => {
        a.flash = Math.floor(t * 6) % 2 === 0 ? 1 - t : 0;
        a.shake = 1 - t;
        if (t === 1) a.flash = a.shake = 0;
      });
      break;
    }
    case 'heal':
      active(view, e.side).hp = e.hp;
      floatText(e.side, `+${e.amount}`, '#7ff0a5');
      hud.log(`${who(e.side)} recovered ${e.amount} HP.`);
      refresh();
      await sleep(350);
      break;
    case 'statChange': {
      active(view, e.side).stages[e.stat] = e.stage;
      const label = STAT_LABEL[e.stat];
      if (e.delta === 0) floatText(e.side, `${label} maxed out`, '#c8c0e0');
      else floatText(e.side, `${label} ${e.delta > 0 ? 'up' : 'down'}`, e.delta > 0 ? '#7ff0a5' : '#ff8fa3');
      hud.log(e.delta === 0 ? `${who(e.side)}'s ${label} can't go further.` : `${who(e.side)}'s ${label} ${e.delta > 0 ? 'rose' : 'fell'}.`);
      refresh();
      await hopOf(a, 300);
      break;
    }
    case 'guarded':
      floatText(e.side, 'Guard!', '#9fd0ff');
      hud.log(`${who(e.side)} braced for impact.`);
      void world.tween(250, (t) => (a.guard = t));
      await sleep(300);
      break;
    case 'fainted': {
      hud.log(`${who(e.side)} fainted!`);
      await world.tween(600, (t) => (a.vis = 1 - t), ease.out);
      break;
    }
    case 'swapped': {
      const out = view.sides[e.side].team[e.from];
      if (out.hp > 0) await world.tween(200, (t) => (a.vis = 1 - t));
      out.stages = { atk: 0, def: 0, spd: 0 };
      view.sides[e.side].active = e.to;
      hud.log(e.side === 0 ? `Go, ${active(view, 0).name}!` : `Rival sends out ${active(view, 1).name}!`);
      refresh();
      await appear(e.side);
      break;
    }
    case 'battleEnded':
      hud.log(e.winner === 'draw' ? 'The battle ended in a draw.' : e.winner === 0 ? 'You won the battle!' : 'You lost the battle.');
      break;
  }
}

async function runTurn(a: Action | null, b: Action | null) {
  const r = resolveTurn(state, a, b);
  busy = true;
  refresh();
  for (const e of r.events) await playEvent(e);
  state = r.state;
  view = structuredClone(state);
  for (const a2 of world.actors) a2.guard = 0;
  busy = false;
  refresh();
}

async function submit(player: Action | null) {
  if (busy || state.winner !== null) return;
  const pm = state.sides[0].mustReplace;
  const bm = state.sides[1].mustReplace;
  const bot = !pm || bm ? smartBot(state, 1, Math.random) : null;
  try {
    await runTurn(player, bot);
  } catch (err) {
    busy = false;
    refresh();
    throw err;
  }
  // The rival's forced replacement never waits for the player.
  if (state.winner === null && !state.sides[0].mustReplace && state.sides[1].mustReplace) await submit(null);
  if (state.winner !== null) {
    hud.showEnd(state.winner === 'draw' ? 'Draw' : state.winner === 0 ? 'You win!' : 'You lost', `Battle lasted ${state.turn} turns.`);
  }
}

async function startBattle() {
  busy = true;
  hud.showEnd(null);
  hud.clearLog();
  state = newBattle(Math.floor(Math.random() * 2 ** 32), randomTeam(), randomTeam());
  view = structuredClone(state);
  world.actors.forEach((a) => (a.vis = 0));
  refresh();
  hud.log('A new battle begins!');
  await Promise.all([appear(0), appear(1)]);
  hud.log(`Go, ${active(view, 0).name}! Rival sends out ${active(view, 1).name}.`);
  busy = false;
  refresh();
}

void startBattle();
// Handy for debugging in the console.
Object.assign(window, { mossling: { world, get state() { return state; } } });
