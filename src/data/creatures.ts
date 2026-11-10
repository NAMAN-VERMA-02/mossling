import { CreatureDef, Effect, Element, Move, StageKey, makeCreature } from '../engine/rules';

// All balance numbers live here: stat weights [hp, atk, def, spd], move cost and power.
const hit = (name: string, element: Element, cost: number, power: number): Move => ({ name, element, cost, power, effect: { kind: 'damage' } });
const util = (name: string, element: Element, cost: number, effect: Effect): Move => ({ name, element, cost, power: 0, effect });
const guard = (name: string, element: Element, cost = 1) => util(name, element, cost, { kind: 'guard' });
const heal = (name: string, element: Element, cost: number, pct: number) => util(name, element, cost, { kind: 'heal', pct });
const raise = (name: string, element: Element, cost: number, stat: StageKey) => util(name, element, cost, { kind: 'raise', stat });
const lower = (name: string, element: Element, cost: number, stat: StageKey) => util(name, element, cost, { kind: 'lower', stat });

export const CREATURES: CreatureDef[] = [
  makeCreature('toastle', 'Toastle', 'ember', [95, 110, 90, 105], [
    hit('Warm Nuzzle', 'ember', 0, 42), hit('Butter Blaze', 'ember', 2, 67), hit('Crispy Rush', 'ember', 5, 126), heal('Cozy Glow', 'ember', 3, 30),
  ], 'A plump, round, golden-brown cub like a warm bread roll, with tiny stubby paws, big shiny eyes and a soft orange glow on its rosy cheeks.'),
  makeCreature('kindlop', 'Kindlop', 'ember', [75, 140, 75, 110], [
    hit('Cinder Peck', 'ember', 0, 42), hit('Flicker Dash', 'ember', 2, 67), hit('Wick Flare', 'ember', 4, 109), raise('Fan the Flame', 'ember', 2, 'atk'),
  ], 'A small, round, fluffy chick-like creature with a puffy red-orange body, a curly tuft on its head that flickers like a candle flame, and tiny wings.'),
  makeCreature('flurrup', 'Flurrup', 'frost', [130, 80, 115, 75], [
    hit('Snow Bump', 'frost', 0, 42), hit('Hail Hop', 'frost', 2, 67), hit('Drift Slam', 'frost', 5, 126), guard('Frost Cuddle', 'frost'),
  ], 'A big, round, snowball-shaped creature covered in thick white fluff, with sleepy pale-blue eyes, stubby feet and a little scarf of icicle-pink fur.'),
  makeCreature('pipsicle', 'Pipsicle', 'frost', [85, 110, 75, 130], [
    hit('Ice Nibble', 'frost', 0, 42), hit('Sleet Skip', 'frost', 2, 67), hit('Glacier Glide', 'frost', 4, 109), lower('Chill Whisper', 'frost', 2, 'atk'),
  ], 'A tiny, soft, pear-shaped penguin-like creature with a pale mint-blue body, a smooth white belly, huge sparkly eyes and a little frosty crest on its head.'),
  makeCreature('bumblebud', 'Bumblebud', 'bloom', [120, 75, 105, 100], [
    hit('Petal Pat', 'bloom', 0, 42), hit('Pollen Puff', 'bloom', 2, 67), hit('Thorny Hug', 'bloom', 5, 126), heal('Honey Nap', 'bloom', 3, 35),
  ], 'A chubby, round, fuzzy bee-like creature with soft yellow and green stripes, a pink flower bud on top of its head and tiny translucent wings.'),
  makeCreature('fernoodle', 'Fernoodle', 'bloom', [90, 125, 85, 100], [
    hit('Leaf Flick', 'bloom', 0, 42), hit('Tangle Lash', 'bloom', 2, 67), hit('Canopy Crash', 'bloom', 4, 109), raise('Sun Soak', 'bloom', 2, 'atk'),
  ], 'A soft, bouncy, bean-shaped creature in leafy green with curly fern fronds for ears, a curled noodle-like tail and freckles of pale yellow.'),
  makeCreature('cobblop', 'Cobblop', 'stone', [95, 85, 140, 80], [
    hit('Pebble Toss', 'stone', 0, 42), hit('Gravel Roll', 'stone', 2, 67), hit('Boulder Bonk', 'stone', 5, 126), guard('Shell Up', 'stone'),
  ], 'A squat, round, smooth creature like a friendly pebble with a warm tan-grey body, a tiny patch of moss on its back and small sleepy eyes.'),
  makeCreature('dolmo', 'Dolmo', 'stone', [125, 105, 100, 70], [
    hit('Mud Stomp', 'stone', 0, 42), hit('Rubble Rumble', 'stone', 2, 67), hit('Quake Nap', 'stone', 4, 109), heal('Moss Rest', 'stone', 3, 25),
  ], 'A large, round, sturdy creature like a mossy boulder with a gentle face, thick short legs, two rounded stone ears and a sprinkle of tiny mushrooms.'),
  makeCreature('fuzzap', 'Fuzzap', 'spark', [85, 105, 80, 130], [
    hit('Static Nuzzle', 'spark', 0, 42), hit('Zap Hop', 'spark', 2, 67), hit('Thunder Fluff', 'spark', 4, 109), guard('Fuzz Shield', 'spark'),
  ], 'A tiny, round, super-fluffy ball of cream and yellow fur with static-stuck whiskers, big bright eyes and a little zigzag tail that crackles softly.'),
  makeCreature('zipplet', 'Zipplet', 'spark', [80, 150, 70, 100], [
    hit('Tiny Jolt', 'spark', 0, 42), hit('Arc Dash', 'spark', 2, 67), hit('Storm Zip', 'spark', 5, 129), raise('Charge Up', 'spark', 2, 'atk'),
  ], 'A small, bouncy, teardrop-shaped creature with a glossy sunny-yellow body, two pointy lightning-bolt ears, rosy round cheeks and a wide cheerful smile.'),
  makeCreature('bubbloo', 'Bubbloo', 'tide', [110, 100, 100, 90], [
    hit('Bubble Bop', 'tide', 0, 42), hit('Splash Skip', 'tide', 2, 67), hit('Tidal Tumble', 'tide', 5, 126), heal('Rinse Rest', 'tide', 3, 25),
  ], 'A plump, round, jelly-like creature in see-through sky blue with a shiny bubble floating inside its belly, big dewy eyes and two little fin ears.'),
  makeCreature('drizzlet', 'Drizzlet', 'tide', [90, 90, 120, 100], [
    hit('Drip Tap', 'tide', 0, 42), hit('Puddle Jump', 'tide', 2, 67), hit('Rain Rush', 'tide', 4, 109), lower('Mist Veil', 'tide', 2, 'def'),
  ], 'A small, round, droplet-shaped creature in deep teal with a little rain-cloud puff on its head, a pale blue belly and tiny webbed feet.'),
];

export const CREATURE_BY_ID: Record<string, CreatureDef> = Object.fromEntries(CREATURES.map((c) => [c.id, c]));
