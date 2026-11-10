import type { BattleState, Side } from '../engine/engine';
import { Battler, MAX_ENERGY, Move, StageKey, elementMult } from '../engine/rules';
import { ELEMENT_COLOR, STAT_LABEL } from './theme';

export interface HudHandlers {
  onMove(index: number): void;
  onSwap(index: number): void;
  onNew(): void;
}
export interface HudMode {
  busy: boolean;
}

const chip = (c: Battler) => `<span class="chip" style="--c:${ELEMENT_COLOR[c.element]}">${c.element}</span>`;

function describe(m: Move): string {
  const e = m.effect;
  switch (e.kind) {
    case 'damage': return `power ${m.power}`;
    case 'heal': return `heal ${e.pct}%`;
    case 'guard': return 'guard: half damage';
    case 'raise': return `own ${STAT_LABEL[e.stat]} up`;
    case 'lower': return `foe ${STAT_LABEL[e.stat]} down`;
  }
}

function stageText(c: Battler): string {
  return (Object.keys(c.stages) as StageKey[])
    .filter((k) => c.stages[k] !== 0)
    .map((k) => `<b class="${c.stages[k] > 0 ? 'up' : 'down'}">${STAT_LABEL[k]} ${c.stages[k] > 0 ? '+' : ''}${c.stages[k]}</b>`)
    .join(' ');
}

export function createHud(root: HTMLElement, h: HudHandlers) {
  root.innerHTML = `
    <div class="top">
      <section class="card" id="card0"></section>
      <section class="card foe" id="card1"></section>
    </div>
    <div class="fx" id="fx"></div>
    <div class="dock">
      <div class="log" id="log" aria-live="polite"></div>
      <div class="panel">
        <div class="prompt" id="prompt"></div>
        <div class="moves" id="moves"></div>
        <div class="swaps" id="swaps"></div>
      </div>
    </div>
    <div class="end" id="end" hidden>
      <div class="endcard"><h2 id="endtitle"></h2><p id="endsub"></p><button id="newbtn">New battle</button></div>
    </div>`;
  const $ = (id: string) => root.querySelector<HTMLElement>('#' + id)!;
  const cards = [$('card0'), $('card1')];
  cards.forEach((el, side) => {
    el.innerHTML = `
      <div class="head"><span class="who">${side === 0 ? 'You' : 'Rival'}</span><span class="name"></span><span class="el"></span></div>
      <div class="hp"><i class="ghost"></i><i class="fill"></i><span class="hptxt"></span></div>
      <div class="pips"></div>
      <div class="stages"></div>
      <div class="bench"></div>`;
    el.querySelector('.pips')!.innerHTML = Array.from({ length: MAX_ENERGY }, () => '<u></u>').join('');
  });
  $('moves').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-i]');
    if (b && !b.disabled) h.onMove(+b.dataset.i!);
  });
  $('swaps').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-i]');
    if (b && !b.disabled) h.onSwap(+b.dataset.i!);
  });
  $('newbtn').addEventListener('click', () => h.onNew());

  function render(s: BattleState, mode: HudMode) {
    for (const side of [0, 1] as Side[]) {
      const sd = s.sides[side];
      const c = sd.team[sd.active];
      const el = cards[side];
      el.querySelector('.name')!.textContent = c.name;
      el.querySelector('.el')!.innerHTML = chip(c);
      const pct = Math.max(0, (c.hp / c.maxHp) * 100);
      const fill = el.querySelector<HTMLElement>('.fill')!;
      fill.style.width = pct + '%';
      fill.dataset.low = pct < 25 ? '2' : pct < 50 ? '1' : '0';
      el.querySelector<HTMLElement>('.ghost')!.style.width = pct + '%';
      el.querySelector('.hptxt')!.textContent = `${c.hp} / ${c.maxHp}`;
      el.querySelectorAll('.pips u').forEach((u, i) => u.classList.toggle('on', i < c.energy));
      el.querySelector('.stages')!.innerHTML = stageText(c);
      el.querySelector('.bench')!.innerHTML = sd.team
        .map((b, i) => `<span class="mini ${i === sd.active ? 'act' : ''} ${b.hp <= 0 ? 'ko' : ''}" style="--c:${ELEMENT_COLOR[b.element]}" title="${b.name}">${b.name}<i style="width:${Math.max(0, (b.hp / b.maxHp) * 100)}%"></i></span>`)
        .join('');
    }
    const me = s.sides[0];
    const c = me.team[me.active];
    const foe = s.sides[1].team[s.sides[1].active];
    const over = s.winner !== null;
    const pick = me.mustReplace && !over;
    const locked = mode.busy || over;
    $('prompt').textContent = over ? '' : pick ? `${c.name} fainted. Choose who comes next.` : mode.busy ? '' : `What will ${c.name} do?`;
    $('moves').innerHTML = c.moves
      .map((m, i) => {
        const mult = m.effect.kind === 'damage' ? elementMult(m.element, foe.element) : 1;
        const hint = mult > 1 ? '<em class="good">strong</em>' : mult < 1 ? '<em class="bad">weak</em>' : '';
        const off = locked || pick || c.energy < m.cost;
        return `<button class="move" data-i="${i}" style="--c:${ELEMENT_COLOR[m.element]}" ${off ? 'disabled' : ''}>
          <span class="mn">${m.name}${hint}</span>
          <span class="mm"><span class="chip" style="--c:${ELEMENT_COLOR[m.element]}">${m.element}</span><span class="cost">cost ${m.cost}</span>${describe(m)}</span></button>`;
      })
      .join('');
    $('swaps').innerHTML =
      '<span class="lbl">Swap to</span>' +
      me.team
        .map((b, i) =>
          i === me.active
            ? ''
            : `<button class="swap" data-i="${i}" style="--c:${ELEMENT_COLOR[b.element]}" ${locked || b.hp <= 0 ? 'disabled' : ''}>${b.name}<small>${b.hp <= 0 ? 'fainted' : `${b.hp}/${b.maxHp}`}</small></button>`,
        )
        .join('');
  }

  return {
    render,
    log(text: string) {
      const l = $('log');
      const p = document.createElement('p');
      p.textContent = text;
      l.appendChild(p);
      while (l.children.length > 60) l.firstChild!.remove();
      l.scrollTop = l.scrollHeight;
    },
    float(x: number, y: number, text: string, color: string, big = false) {
      const f = document.createElement('div');
      f.className = 'float' + (big ? ' big' : '');
      f.textContent = text;
      f.style.left = x + 'px';
      f.style.top = y + 'px';
      f.style.color = color;
      $('fx').appendChild(f);
      setTimeout(() => f.remove(), 1500);
    },
    showEnd(title: string | null, sub = '') {
      $('end').hidden = title === null;
      if (title !== null) {
        $('endtitle').textContent = title;
        $('endsub').textContent = sub;
        $('newbtn').focus();
      }
    },
    clearLog() {
      $('log').innerHTML = '';
    },
  };
}
export type Hud = ReturnType<typeof createHud>;
