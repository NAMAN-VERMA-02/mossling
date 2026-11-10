import './style.css';
import { Game } from './game';
import { World } from './world';

const world = new World(document.getElementById('world') as HTMLCanvasElement);
const game = new Game(world, document.getElementById('hud')!);
// Handy for debugging in the console.
Object.assign(window, { mossling: { world, game: game.api() } });
