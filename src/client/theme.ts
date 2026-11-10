import type { Element, StageKey } from '../engine/rules';

export const ELEMENT_COLOR: Record<Element, string> = {
  ember: '#ff9a76',
  frost: '#8fd6f2',
  bloom: '#98d98a',
  stone: '#cdb48c',
  spark: '#ffe063',
  tide: '#6fb4ff',
};

export const STAT_LABEL: Record<StageKey, string> = { atk: 'ATK', def: 'DEF', spd: 'SPD' };
