import * as THREE from 'three';
import { makeRng } from '../engine/rng';
import type { Battler } from '../engine/rules';
import { ELEMENT_COLOR } from './theme';

export const ISLAND_R = 9;

/** Island height field: a soft dome with gentle bumps, sinking below the water (y = 0) at the rim. */
export function height(x: number, z: number): number {
  const r = Math.hypot(x, z) / ISLAND_R;
  if (r >= 1) return -0.45 - (r - 1) * 7;
  const bump = 0.1 * Math.sin(x * 0.8) * Math.cos(z * 0.7) + 0.06 * Math.sin(x * 1.9 + z * 1.3);
  return 1.25 * Math.pow(1 - r * r, 0.6) - 0.45 + bump * (1 - r);
}

const easeOutBack = (x: number) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);
export const ease = { linear: (x: number) => x, out: (x: number) => 1 - (1 - x) * (1 - x), back: easeOutBack };

// ---- creature textures -------------------------------------------------------------------------

const texCache = new Map<string, Promise<THREE.Texture>>();

function fallbackTexture(c: { name: string; element: keyof typeof ELEMENT_COLOR }): THREE.Texture {
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
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function shade(hex: string, amt: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt)));
  return '#' + c.getHexString();
}

/** public/creatures/<id>.png if it exists, else a drawn blob. Probed with fetch so a missing file never logs a 404. */
export function creatureTexture(c: Battler): Promise<THREE.Texture> {
  let p = texCache.get(c.id);
  if (!p) {
    const url = `${import.meta.env.BASE_URL}creatures/${c.id}.png`;
    p = fetch(url)
      .then((r) => (r.ok && (r.headers.get('content-type') ?? '').startsWith('image/') ? r.blob() : Promise.reject(new Error('no art'))))
      .then((b) => createImageBitmap(b))
      .then((bmp) => {
        const t = new THREE.Texture(bmp);
        t.colorSpace = THREE.SRGBColorSpace;
        t.needsUpdate = true;
        return t;
      })
      .catch(() => fallbackTexture(c));
    texCache.set(c.id, p);
  }
  return p;
}

// ---- actors ------------------------------------------------------------------------------------

function blobShadowTexture(): THREE.Texture {
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

export class Actor {
  readonly sprite: THREE.Sprite;
  readonly shadow: THREE.Mesh;
  vis = 0; // 0 hidden .. 1 full size
  lunge = 0;
  hop = 0;
  flash = 0;
  shake = 0;
  guard = 0;
  private readonly home: THREE.Vector3;
  private readonly toward: number;
  private readonly size = 3;
  private phase: number;

  constructor(scene: THREE.Scene, x: number, z: number, toward: number, shadowTex: THREE.Texture) {
    this.home = new THREE.Vector3(x, height(x, z), z);
    this.toward = toward;
    this.phase = x;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
    this.sprite.center.set(0.5, 0.04);
    this.sprite.visible = false;
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
    );
    this.shadow.position.set(x, this.home.y + 0.03, z);
    this.shadow.visible = false;
    // Draw after the (transparent) water so it cannot wash over the sprite where the view passes beyond the island rim.
    this.shadow.renderOrder = 5;
    this.sprite.renderOrder = 10;
    scene.add(this.sprite, this.shadow);
  }

  /** Screen anchor (world space) for floating text. */
  anchor(lift = 2.2): THREE.Vector3 {
    return new THREE.Vector3(this.home.x, this.home.y + lift, this.home.z);
  }

  async setCreature(c: Battler) {
    const tex = await creatureTexture(c);
    this.sprite.material.map = tex;
    this.sprite.material.needsUpdate = true;
  }

  update(t: number) {
    const v = Math.max(0, this.vis);
    const bob = Math.sin(t * 2.2 + this.phase) * 0.5 + 0.5;
    const sx = this.size * v * (1 + (1 - bob) * 0.03);
    const sy = this.size * v * (1 + bob * 0.04);
    this.sprite.visible = this.shadow.visible = v > 0.001;
    this.sprite.scale.set(sx, sy, 1);
    const shakeX = Math.sin(t * 70) * 0.18 * this.shake;
    this.sprite.position.set(
      this.home.x + this.toward * this.lunge * 1.8 + shakeX,
      this.home.y + this.hop * 0.9 + bob * 0.06 + this.lunge * 0.15,
      this.home.z + this.lunge * (this.home.z > 0 ? -0.9 : 0.9),
    );
    const f = this.flash;
    this.sprite.material.color.setRGB(1 - 0.3 * this.guard, 1 - 0.55 * f - 0.1 * this.guard, 1 - 0.55 * f);
    this.sprite.material.opacity = Math.min(1, v * 1.5);
    const sh = (1.9 * v * (1 - this.hop * 0.25)) * (1 + this.lunge * 0.1);
    this.shadow.scale.set(sh, 1, sh * 0.6);
    this.shadow.position.x = this.sprite.position.x;
    this.shadow.position.z = this.sprite.position.z;
  }
}

// ---- world -------------------------------------------------------------------------------------

interface Tween {
  start: number;
  ms: number;
  fn: (t: number) => void;
  ease: (x: number) => number;
  done: () => void;
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
  readonly actors: [Actor, Actor];
  private tweens: Tween[] = [];
  private grass!: THREE.InstancedMesh;
  private grassData: { x: number; y: number; z: number; ph: number; s: number }[] = [];
  private sway: THREE.Object3D[] = [];
  private clouds: THREE.Object3D[] = [];
  private foam!: THREE.Mesh;
  private water!: THREE.Mesh;
  private target = new THREE.Vector3(0, 0.9, 0);
  private dist = 15;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.buildSky();
    this.buildLights();
    this.buildIsland();
    const st = blobShadowTexture();
    this.actors = [new Actor(this.scene, -2.7, 1.5, 1, st), new Actor(this.scene, 2.7, -1.2, -1, st)];
    window.addEventListener('resize', () => this.resize());
    this.resize();
    const loop = (ms: number) => {
      this.frame(ms / 1000);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    // Keep tweens (and so the game flow) alive even if the tab throttles requestAnimationFrame.
    setInterval(() => this.advance(), 50);
  }

  tween(ms: number, fn: (t: number) => void, easing: (x: number) => number = ease.linear): Promise<void> {
    return new Promise((done) => {
      this.tweens.push({ start: performance.now(), ms, fn, ease: easing, done });
      fn(easing(0));
    });
  }
  wait(ms: number) {
    return this.tween(ms, () => {});
  }

  private advance() {
    const now = performance.now();
    for (const tw of [...this.tweens]) {
      const x = Math.min(1, (now - tw.start) / tw.ms);
      tw.fn(tw.ease(x));
      if (x >= 1) {
        this.tweens.splice(this.tweens.indexOf(tw), 1);
        tw.done();
      }
    }
  }

  /** CSS pixel position of a world point. */
  project(p: THREE.Vector3): { x: number; y: number } {
    const v = p.clone().project(this.camera);
    return { x: ((v.x + 1) / 2) * this.canvas.clientWidth, y: ((1 - v.y) / 2) * this.canvas.clientHeight };
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.dist = 15 * Math.max(1, Math.pow(1.5 / this.camera.aspect, 0.85));
    // Shift the picture up a little so the HUD at the bottom does not cover the creatures.
    this.camera.setViewOffset(w, h, 0, h * 0.07, w, h);
    this.camera.updateProjectionMatrix();
  }

  private frame(t: number) {
    this.advance();
    // gentle idle camera drift
    this.camera.position.set(Math.sin(t * 0.17) * 1.6, 5.4 + Math.sin(t * 0.11) * 0.3 + (this.dist - 15) * 0.3, this.dist + Math.sin(t * 0.13) * 0.4);
    this.camera.lookAt(this.target);
    for (const a of this.actors) a.update(t);
    // swaying grass
    const d = new THREE.Object3D();
    this.grassData.forEach((g, i) => {
      d.position.set(g.x, g.y, g.z);
      d.rotation.set(Math.sin(t * 1.6 + g.ph) * 0.22, 0, Math.cos(t * 1.3 + g.ph * 1.7) * 0.22);
      d.scale.setScalar(g.s);
      d.updateMatrix();
      this.grass.setMatrixAt(i, d.matrix);
    });
    this.grass.instanceMatrix.needsUpdate = true;
    this.sway.forEach((o, i) => (o.rotation.z = Math.sin(t * 0.9 + i * 1.7) * 0.025));
    this.clouds.forEach((c, i) => {
      c.position.x += 0.004 * (1 + i * 0.3);
      if (c.position.x > 28) c.position.x = -28;
    });
    this.foam.scale.setScalar(1 + Math.sin(t * 0.9) * 0.012);
    (this.foam.material as THREE.MeshBasicMaterial).opacity = 0.42 + Math.sin(t * 1.4) * 0.12;
    this.water.position.y = Math.sin(t * 0.8) * 0.015;
    this.renderer.render(this.scene, this.camera);
  }

  // ---- scene building ----

  private buildSky() {
    const cv = document.createElement('canvas');
    cv.width = 2;
    cv.height = 256;
    const g = cv.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#9fd3ff');
    grad.addColorStop(0.55, '#d8ecff');
    grad.addColorStop(1, '#fff0dd');
    g.fillStyle = grad;
    g.fillRect(0, 0, 2, 256);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = tex;
    this.scene.fog = new THREE.Fog('#e6f2fb', 28, 75);
  }

  private buildLights() {
    this.scene.add(new THREE.HemisphereLight('#dff0ff', '#f6e7c9', 1.35));
    const sun = new THREE.DirectionalLight('#fff1d8', 2.1);
    sun.position.set(7, 11, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -12;
    sc.right = sc.top = 12;
    sc.near = 1;
    sc.far = 40;
    sun.shadow.radius = 5;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);
  }

  private buildIsland() {
    const rng = makeRng(2024);
    const S = ISLAND_R * 2.4;
    const geo = new THREE.PlaneGeometry(S, S, 44, 44).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const deep = new THREE.Color('#6cbfd6');
    const shallow = new THREE.Color('#b9e6dd');
    const sand = new THREE.Color('#f5e6b8');
    const grassA = new THREE.Color('#a9e093');
    const grassB = new THREE.Color('#8cd48b');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = height(x, z);
      pos.setY(i, y);
      if (y < -0.3) c.lerpColors(shallow, deep, Math.min(1, (-0.3 - y) / 1.2));
      else if (y < 0) c.lerpColors(shallow, sand, (y + 0.3) / 0.3);
      else if (y < 0.28) c.lerpColors(sand, grassA, y / 0.28);
      else c.lerpColors(grassA, grassB, 0.5 + 0.5 * Math.sin(x * 0.7 + z * 0.5));
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const land = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
    land.receiveShadow = true;
    this.scene.add(land);

    const seabed = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#63bad4' }));
    seabed.position.y = -5;
    this.scene.add(seabed);
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#9adff0', transparent: true, opacity: 0.74, roughness: 0.25 }),
    );
    this.scene.add(this.water);
    this.foam = new THREE.Mesh(
      new THREE.RingGeometry(ISLAND_R * 0.86, ISLAND_R * 0.95, 72).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45, depthWrite: false }),
    );
    this.foam.position.y = 0.02;
    this.scene.add(this.foam);

    const keepClear = (x: number, z: number, r: number) => [[-2.7, 1.5], [2.7, -1.2]].some(([ax, az]) => Math.hypot(x - ax, z - az) < r);
    const onLand = (rmax: number): [number, number] => {
      for (;;) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * rmax;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        if (height(x, z) > 0.15) return [x, z];
      }
    };

    // grass tufts
    const tuft = new THREE.ConeGeometry(0.05, 0.34, 5).translate(0, 0.17, 0);
    this.grass = new THREE.InstancedMesh(tuft, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }), 520);
    for (let i = 0; i < 520; i++) {
      let x: number, z: number;
      do [x, z] = onLand(7.6);
      while (keepClear(x, z, 1.6));
      this.grassData.push({ x, y: height(x, z) - 0.02, z, ph: rng() * 6.28, s: 0.6 + rng() * 0.8 });
      this.grass.setColorAt(i, new THREE.Color().setHSL(0.27 + rng() * 0.06, 0.55, 0.52 + rng() * 0.12));
    }
    this.scene.add(this.grass);

    // flowers
    const flowerCols = ['#ffb3c7', '#fff1a8', '#ffffff', '#c9b6ff'];
    const fl = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 8, 6), new THREE.MeshStandardMaterial({ roughness: 0.8 }), 46);
    for (let i = 0; i < 46; i++) {
      const [x, z] = onLand(7);
      fl.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, height(x, z) + 0.14, z));
      fl.setColorAt(i, new THREE.Color(flowerCols[i % 4]));
    }
    this.scene.add(fl);

    // round trees
    const trunkMat = new THREE.MeshStandardMaterial({ color: '#c79a73', roughness: 1 });
    const leafMats = ['#8fd88c', '#7fcf8f', '#a4e08a'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }));
    for (let i = 0; i < 7; i++) {
      let x: number, z: number;
      do [x, z] = onLand(7.2);
      while (keepClear(x, z, 3.2) || Math.hypot(x, z) < 3.4 || (z > -2.2 && Math.abs(x) < 6.5));
      const tree = new THREE.Group();
      const k = 0.85 + rng() * 0.5;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13 * k, 0.2 * k, 1.1 * k, 8).translate(0, 0.55 * k, 0), trunkMat);
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85 * k, 1), leafMats[i % 3]);
      crown.position.y = 1.5 * k;
      crown.scale.y = 0.9;
      const crown2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55 * k, 1), leafMats[(i + 1) % 3]);
      crown2.position.set(0.45 * k, 2.05 * k, 0.1);
      for (const m of [trunk, crown, crown2]) m.castShadow = true;
      tree.add(trunk, crown, crown2);
      tree.position.set(x, height(x, z) - 0.05, z);
      this.scene.add(tree);
      this.sway.push(tree);
    }

    // rocks
    const rockMat = new THREE.MeshStandardMaterial({ color: '#d9d2e0', roughness: 1, flatShading: true });
    for (let i = 0; i < 6; i++) {
      let x: number, z: number;
      do [x, z] = onLand(7.4);
      while (keepClear(x, z, 2.4));
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.35 + rng() * 0.35, 0), rockMat);
      rock.position.set(x, height(x, z) + 0.12, z);
      rock.scale.set(1.2, 0.75, 1);
      rock.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      rock.castShadow = rock.receiveShadow = true;
      this.scene.add(rock);
    }

    // soft clouds
    const cloudMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, fog: false });
    for (let i = 0; i < 4; i++) {
      const cl = new THREE.Group();
      for (let j = 0; j < 4; j++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(1.2 + rng() * 0.9, 12, 8), cloudMat);
        b.position.set(j * 1.5 - 2, rng() * 0.4, rng() * 0.6);
        b.scale.y = 0.6;
        cl.add(b);
      }
      cl.position.set(-28 + i * 16, 9 + rng() * 4, -22 - rng() * 10);
      this.scene.add(cl);
      this.clouds.push(cl);
    }
  }
}
