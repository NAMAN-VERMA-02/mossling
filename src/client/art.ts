import * as THREE from 'three';
import { ELEMENT_COLOR } from './theme';
import type { Element } from '../engine/rules';

type Who = { id: string; name: string; element: Element };
export type Art = HTMLImageElement | HTMLCanvasElement;

function shade(hex: string, amt: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt)));
  return '#' + c.getHexString();
}

/** Drawn blob used while a creature's PNG is missing. */
function fallbackArt(c: Who): HTMLCanvasElement {
  const s = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d')!;
  const base = ELEMENT_COLOR[c.element];
  const grad = g.createRadialGradient(100, 90, 20, 128, 140, 120);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.35, base);
  grad.addColorStop(1, shade(base, -0.18));
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(128, 142, 112, 104, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#3b3050';
  for (const x of [92, 164]) {
    g.beginPath();
    g.ellipse(x, 120, 11, 15, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(x - 3, 114, 4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#3b3050';
  }
  g.fillStyle = 'rgba(255,120,140,0.45)';
  for (const x of [66, 190]) {
    g.beginPath();
    g.ellipse(x, 148, 14, 9, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = '#3b3050';
  g.lineWidth = 5;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(128, 144, 14, 0.15 * Math.PI, 0.85 * Math.PI);
  g.stroke();
  g.font = '800 30px "Trebuchet MS", ui-rounded, system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillStyle = '#3b3050';
  g.fillText(c.name, 128, 206, 190);
  return cv;
}

const artCache = new Map<string, Promise<Art>>();

/** public/creatures/<id>.png if it exists, else a drawn blob. Probed with fetch so a missing file never logs a 404. */
export function creatureArt(c: Who): Promise<Art> {
  let p = artCache.get(c.id);
  if (!p) {
    const url = `${import.meta.env.BASE_URL}creatures/${c.id}.png`;
    p = fetch(url)
      .then((r) => (r.ok && (r.headers.get('content-type') ?? '').startsWith('image/') ? r.blob() : Promise.reject(new Error('no art'))))
      .then(async (b) => {
        const img = new Image();
        img.src = URL.createObjectURL(b);
        await img.decode();
        return img as Art;
      })
      .catch(() => fallbackArt(c) as Art);
    artCache.set(c.id, p);
  }
  return p;
}

const texCache = new Map<string, Promise<THREE.Texture>>();
export function creatureTexture(c: Who): Promise<THREE.Texture> {
  let p = texCache.get(c.id);
  if (!p) {
    p = creatureArt(c).then((a) => {
      const t = new THREE.Texture(a);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      t.needsUpdate = true;
      return t;
    });
    texCache.set(c.id, p);
  }
  return p;
}

export function blobShadowTexture(): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(60,50,90,0.42)');
  grad.addColorStop(1, 'rgba(60,50,90,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}

/** Soft round dot for points (fireflies, petals). */
export function dotTexture(): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}
