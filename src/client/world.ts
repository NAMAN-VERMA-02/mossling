import * as THREE from 'three';
import { makeRng } from '../engine/rng';
import { dotTexture } from './art';

export const ISLAND_R = 15.5;
export const POND = { x: 5.5, z: 4.5 };
export const HILL = { x: -6.5, z: -6.5 };
export const ROCKS = { x: 8, z: -6 };
export const MEADOW = { x: -1, z: 1 };
export const FLOWERS = [
  { x: -7.5, z: 4.5 },
  { x: 3, z: -9 },
  { x: 9.5, z: -0.5 },
  { x: -3, z: 8.5 },
];
const WALK_MIN = 0.1;

/** Island height field: a soft dome with a hilltop, a pond hollow and gentle bumps, sinking below the water (y = 0) at the rim. */
export function height(x: number, z: number): number {
  const r = Math.hypot(x, z) / ISLAND_R;
  if (r >= 1) return -0.45 - (r - 1) * 7;
  const g = (c: { x: number; z: number }, s: number) => Math.exp(-((x - c.x) ** 2 + (z - c.z) ** 2) / (2 * s * s));
  const bump = 0.12 * Math.sin(x * 0.45) * Math.cos(z * 0.4) + 0.05 * Math.sin(x * 1.3 + z * 1.1);
  return 1.25 * Math.pow(1 - r * r, 0.6) - 0.45 + 1.7 * g(HILL, 3.2) - 1.15 * g(POND, 1.9) + bump * (1 - r);
}

const easeOutBack = (x: number) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);
export const ease = { linear: (x: number) => x, out: (x: number) => 1 - (1 - x) * (1 - x), back: easeOutBack };

interface Key {
  t: number;
  top: string;
  mid: string;
  bot: string;
  fog: string;
  sun: string;
  sunI: number;
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
  night: number;
}
const DAY: Key = { t: 0, top: '#9fd3ff', mid: '#d8ecff', bot: '#fff0dd', fog: '#e6f2fb', sun: '#fff1d8', sunI: 2.1, hemiSky: '#dff0ff', hemiGround: '#f6e7c9', hemiI: 1.35, night: 0 };
const SUNSET: Key = { t: 0.5, top: '#8d7bd0', mid: '#f4a6b0', bot: '#ffd29a', fog: '#f3c9c0', sun: '#ffa56e', sunI: 1.7, hemiSky: '#f6c8d8', hemiGround: '#e8b890', hemiI: 1.05, night: 0.15 };
const NIGHT: Key = { t: 0.6, top: '#14183f', mid: '#2a2f6b', bot: '#4a4a86', fog: '#2b2f63', sun: '#9fb4ff', sunI: 0.55, hemiSky: '#6a76c0', hemiGround: '#38396a', hemiI: 0.85, night: 1 };
const DAWN: Key = { t: 0.94, top: '#a9b4e8', mid: '#ffc9c0', bot: '#ffe6bf', fog: '#f6dccd', sun: '#ffd0a0', sunI: 1.6, hemiSky: '#ffe0e0', hemiGround: '#f0d2a8', hemiI: 1.1, night: 0.2 };
const KEYS: Key[] = [DAY, { ...DAY, t: 0.4 }, SUNSET, NIGHT, { ...NIGHT, t: 0.86 }, DAWN, { ...DAY, t: 1 }];
export const DAY_SECONDS = 270;

const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
const mixColor = (out: THREE.Color, a: string, b: string, f: number) => out.set(a).lerp(_c2.set(b), f);

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 220);
  readonly colliders: { x: number; z: number; r: number }[] = [];
  /** 0 = bright day .. 1 = deep night. */
  night = 0;
  /** Colour to multiply onto unlit sprites so they dim at night. */
  readonly spriteTint = new THREE.Color(1, 1, 1);
  readonly focus = new THREE.Vector3();
  /** Time of day 0..1. */
  day = 0.08;
  time = 0;
  onUpdate: (dt: number, t: number) => void = () => {};

  yaw = 0.35;
  pitch = 0.62;
  dist = 13;
  private camTarget = new THREE.Vector3();

  private grass!: THREE.InstancedMesh;
  private grassData: { x: number; y: number; z: number; ph: number; s: number }[] = [];
  private sway: THREE.Object3D[] = [];
  private clouds: THREE.Object3D[] = [];
  private cloudMat!: THREE.MeshBasicMaterial;
  private foam!: THREE.Mesh;
  private water!: THREE.Mesh;
  private sun!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private skyCanvas = document.createElement('canvas');
  private skyTex!: THREE.CanvasTexture;
  private skyClock = 99;
  private stars!: THREE.Points;
  private flies!: THREE.Points;
  private flyBase: { x: number; z: number; ph: number }[] = [];
  private petals!: THREE.Points;
  private petalData: { x: number; y: number; z: number; ph: number; v: number }[] = [];
  private butterflies: { g: THREE.Group; wings: THREE.Mesh[]; c: { x: number; z: number }; ph: number; sp: number; rad: number }[] = [];
  private lastStep = performance.now();
  private ray = new THREE.Raycaster();

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.buildSky();
    this.buildLights();
    this.buildIsland();
    this.buildAtmosphere();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.dist = 13 * Math.min(1.9, Math.max(1, 1.1 / this.camera.aspect)); // portrait phones start further back
    const loop = () => {
      this.step();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    // A hidden tab throttles requestAnimationFrame; keep the simulation ticking anyway.
    setInterval(() => {
      if (performance.now() - this.lastStep > 150) this.step();
    }, 100);
  }

  walkable(x: number, z: number, pad = 0): boolean {
    if (height(x, z) < WALK_MIN) return false;
    for (const c of this.colliders) if (Math.hypot(x - c.x, z - c.z) < c.r + pad) return false;
    return true;
  }

  /** CSS pixel position of a world point. */
  project(p: THREE.Vector3): { x: number; y: number } {
    const v = p.clone().project(this.camera);
    return { x: ((v.x + 1) / 2) * this.canvas.clientWidth, y: ((1 - v.y) / 2) * this.canvas.clientHeight };
  }

  /** Where a screen point meets the ground (ray-marched against the height field). */
  pickGround(cx: number, cy: number): THREE.Vector3 | null {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), this.camera);
    const o = this.ray.ray.origin;
    const d = this.ray.ray.direction;
    const at = (t: number) => new THREE.Vector3().copy(o).addScaledVector(d, t);
    for (let t = 0.5; t < 90; t += 0.3) {
      const p = at(t);
      if (p.y < height(p.x, p.z)) {
        let lo = t - 0.3;
        let hi = t;
        for (let i = 0; i < 8; i++) {
          const m = (lo + hi) / 2;
          const q = at(m);
          if (q.y < height(q.x, q.z)) hi = m;
          else lo = m;
        }
        const q = at(hi);
        q.y = height(q.x, q.z);
        return q;
      }
    }
    return null;
  }

  orbit(dx: number, dy: number) {
    this.yaw -= dx * 0.006;
    this.pitch = Math.max(0.22, Math.min(1.25, this.pitch + dy * 0.005));
  }
  zoom(f: number) {
    this.dist = Math.max(5.5, Math.min(32, this.dist * f));
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private step() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastStep) / 1000);
    this.lastStep = now;
    this.time += dt;
    this.day = (this.day + dt / DAY_SECONDS) % 1;
    this.onUpdate(dt, this.time);
    this.updateCamera(dt);
    this.updateSky(dt);
    this.updateAtmosphere(dt, this.time);
    const t = this.time;
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
      c.position.x += dt * 0.25 * (1 + i * 0.3);
      if (c.position.x > 40) c.position.x = -40;
    });
    this.foam.scale.setScalar(1 + Math.sin(t * 0.9) * 0.012);
    (this.foam.material as THREE.MeshBasicMaterial).opacity = 0.42 + Math.sin(t * 1.4) * 0.12;
    this.water.position.y = Math.sin(t * 0.8) * 0.015;
  }

  private updateCamera(dt: number) {
    const k = 1 - Math.exp(-7 * dt);
    this.camTarget.x += (this.focus.x - this.camTarget.x) * k;
    this.camTarget.y += (this.focus.y + 0.8 - this.camTarget.y) * k;
    this.camTarget.z += (this.focus.z - this.camTarget.z) * k;
    const cp = Math.cos(this.pitch);
    const p = this.camera.position.set(
      this.camTarget.x + Math.sin(this.yaw) * cp * this.dist,
      this.camTarget.y + Math.sin(this.pitch) * this.dist,
      this.camTarget.z + Math.cos(this.yaw) * cp * this.dist,
    );
    p.y = Math.max(p.y, height(p.x, p.z) + 0.8);
    this.camera.lookAt(this.camTarget);
  }

  private updateSky(dt: number) {
    let a = KEYS[0];
    let b = KEYS[1];
    for (let i = 0; i < KEYS.length - 1; i++) if (this.day >= KEYS[i].t && this.day <= KEYS[i + 1].t) [a, b] = [KEYS[i], KEYS[i + 1]];
    const f = b.t === a.t ? 0 : (this.day - a.t) / (b.t - a.t);
    const s = f * f * (3 - 2 * f);
    this.night = a.night + (b.night - a.night) * s;
    mixColor(_c1, a.fog, b.fog, s);
    (this.scene.fog as THREE.Fog).color.copy(_c1);
    mixColor(this.sun.color, a.sun, b.sun, s);
    this.sun.intensity = a.sunI + (b.sunI - a.sunI) * s;
    mixColor(this.hemi.color, a.hemiSky, b.hemiSky, s);
    mixColor(this.hemi.groundColor, a.hemiGround, b.hemiGround, s);
    this.hemi.intensity = a.hemiI + (b.hemiI - a.hemiI) * s;
    this.spriteTint.setRGB(1 - 0.38 * this.night, 1 - 0.32 * this.night, 1 - 0.08 * this.night);
    this.cloudMat.color.set('#ffffff').lerp(_c2.set('#7a7fb8'), this.night);
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, this.night - 0.3) * 1.4;

    // sun/moon light follows the player so the shadow map stays sharp where it matters
    const a2 = this.day * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(a2), 0.5 + 0.4 * Math.cos((this.day - 0.2) * Math.PI * 2), Math.sin(a2) * 0.6).normalize();
    this.sun.target.position.copy(this.focus);
    this.sun.position.copy(this.focus).addScaledVector(dir, 26);

    this.skyClock += dt;
    if (this.skyClock > 0.25) {
      this.skyClock = 0;
      const g = this.skyCanvas.getContext('2d')!;
      const grad = g.createLinearGradient(0, 0, 0, 128);
      grad.addColorStop(0, mixColor(_c1, a.top, b.top, s).getStyle());
      grad.addColorStop(0.55, mixColor(_c1, a.mid, b.mid, s).getStyle());
      grad.addColorStop(1, mixColor(_c1, a.bot, b.bot, s).getStyle());
      g.fillStyle = grad;
      g.fillRect(0, 0, 2, 128);
      this.skyTex.needsUpdate = true;
    }
  }

  private updateAtmosphere(dt: number, t: number) {
    const f = this.focus;
    // fireflies
    const fm = this.flies.material as THREE.PointsMaterial;
    fm.opacity = Math.min(1, Math.max(0, (this.night - 0.35) * 2.2));
    this.flies.visible = fm.opacity > 0.01;
    if (this.flies.visible) {
      const pos = this.flies.geometry.attributes.position as THREE.BufferAttribute;
      this.flyBase.forEach((b, i) => {
        const x = b.x + Math.sin(t * 0.5 + b.ph) * 1.2;
        const z = b.z + Math.cos(t * 0.4 + b.ph * 1.3) * 1.2;
        pos.setXYZ(i, x, Math.max(0, height(x, z)) + 0.6 + Math.sin(t * 0.9 + b.ph) * 0.35, z);
      });
      pos.needsUpdate = true;
    }
    // petals / leaves drifting around the player
    const pp = this.petals.geometry.attributes.position as THREE.BufferAttribute;
    this.petalData.forEach((p, i) => {
      p.y -= p.v * dt;
      p.x += Math.sin(t * 0.6 + p.ph) * 0.35 * dt + 0.25 * dt;
      p.z += Math.cos(t * 0.5 + p.ph) * 0.3 * dt;
      if (p.y < height(p.x, p.z) + 0.1) p.y += 7;
      if (p.x - f.x > 13) p.x -= 26;
      if (p.x - f.x < -13) p.x += 26;
      if (p.z - f.z > 13) p.z -= 26;
      if (p.z - f.z < -13) p.z += 26;
      pp.setXYZ(i, p.x, p.y, p.z);
    });
    pp.needsUpdate = true;
    // butterflies
    const day = 1 - this.night;
    for (const b of this.butterflies) {
      b.g.visible = day > 0.35;
      if (!b.g.visible) continue;
      const a = t * b.sp + b.ph;
      const x = b.c.x + Math.cos(a) * b.rad;
      const z = b.c.z + Math.sin(a * 1.3) * b.rad;
      const nx = b.c.x + Math.cos(a + 0.05) * b.rad;
      const nz = b.c.z + Math.sin((a + 0.05) * 1.3) * b.rad;
      b.g.position.set(x, Math.max(0, height(x, z)) + 0.9 + Math.sin(t * 2 + b.ph) * 0.25, z);
      b.g.rotation.y = Math.atan2(nx - x, nz - z);
      const flap = Math.sin(t * 16 + b.ph) * 0.9;
      b.wings[0].rotation.z = flap;
      b.wings[1].rotation.z = -flap;
    }
  }

  // ---- scene building ----

  private buildSky() {
    this.skyCanvas.width = 2;
    this.skyCanvas.height = 128;
    this.skyTex = new THREE.CanvasTexture(this.skyCanvas);
    this.skyTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.skyTex;
    this.scene.fog = new THREE.Fog('#e6f2fb', 30, 85);
  }

  private buildLights() {
    this.hemi = new THREE.HemisphereLight('#dff0ff', '#f6e7c9', 1.35);
    this.scene.add(this.hemi);
    const sun = (this.sun = new THREE.DirectionalLight('#fff1d8', 2.1));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -16;
    sc.right = sc.top = 16;
    sc.near = 1;
    sc.far = 70;
    sun.shadow.radius = 5;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target);
  }

  private buildIsland() {
    const rng = makeRng(2024);
    const S = ISLAND_R * 2.5;
    const geo = new THREE.PlaneGeometry(S, S, 150, 150).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const deep = new THREE.Color('#6cbfd6');
    const shallow = new THREE.Color('#b9e6dd');
    const sand = new THREE.Color('#f5e6b8');
    const grassA = new THREE.Color('#a9e093');
    const grassB = new THREE.Color('#8cd48b');
    const top = new THREE.Color('#c6eeb2');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = height(x, z);
      pos.setY(i, y);
      if (y < -0.3) c.lerpColors(shallow, deep, Math.min(1, (-0.3 - y) / 1.2));
      else if (y < 0) c.lerpColors(shallow, sand, (y + 0.3) / 0.3);
      else if (y < 0.28) c.lerpColors(sand, grassA, y / 0.28);
      else {
        c.lerpColors(grassA, grassB, 0.5 + 0.5 * Math.sin(x * 0.7 + z * 0.5));
        if (y > 1.3) c.lerp(top, Math.min(1, (y - 1.3) / 0.8));
      }
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const land = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
    land.receiveShadow = true;
    this.scene.add(land);

    const seabed = new THREE.Mesh(new THREE.PlaneGeometry(500, 500).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#63bad4' }));
    seabed.position.y = -5;
    this.scene.add(seabed);
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(500, 500).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#9adff0', transparent: true, opacity: 0.74, roughness: 0.25 }),
    );
    this.scene.add(this.water);
    this.foam = new THREE.Mesh(
      new THREE.RingGeometry(ISLAND_R * 0.86, ISLAND_R * 0.95, 96).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45, depthWrite: false }),
    );
    this.foam.position.y = 0.02;
    this.scene.add(this.foam);

    const onLand = (rmax: number, minH = 0.2): [number, number] => {
      for (;;) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * rmax;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        if (height(x, z) > minH) return [x, z];
      }
    };
    const dist = (x: number, z: number, p: { x: number; z: number }) => Math.hypot(x - p.x, z - p.z);

    // round trees, spaced apart, keeping the spawn meadow open
    const trunkMat = new THREE.MeshStandardMaterial({ color: '#c79a73', roughness: 1 });
    const leafMats = ['#8fd88c', '#7fcf8f', '#a4e08a'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }));
    let placed = 0;
    for (let tries = 0; placed < 26 && tries < 2000; tries++) {
      const [x, z] = onLand(12.4, 0.3);
      if (dist(x, z, MEADOW) < 4.8 || Math.hypot(x, z) < 3.2 || dist(x, z, POND) < 3.8 || dist(x, z, ROCKS) < 3) continue;
      if (this.colliders.some((o) => Math.hypot(o.x - x, o.z - z) < 2.4)) continue;
      const tree = new THREE.Group();
      const k = 0.85 + rng() * 0.5;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13 * k, 0.2 * k, 1.1 * k, 8).translate(0, 0.55 * k, 0), trunkMat);
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85 * k, 1), leafMats[placed % 3]);
      crown.position.y = 1.5 * k;
      crown.scale.y = 0.9;
      const crown2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55 * k, 1), leafMats[(placed + 1) % 3]);
      crown2.position.set(0.45 * k, 2.05 * k, 0.1);
      for (const m of [trunk, crown, crown2]) m.castShadow = true;
      tree.add(trunk, crown, crown2);
      tree.position.set(x, height(x, z) - 0.05, z);
      this.scene.add(tree);
      this.sway.push(tree);
      this.colliders.push({ x, z, r: 0.42 * k });
      placed++;
    }

    // rocks: a cluster by the rock field plus some scattered ones
    const rockMat = new THREE.MeshStandardMaterial({ color: '#d9d2e0', roughness: 1, flatShading: true });
    const addRock = (x: number, z: number, sz: number) => {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(sz, 0), rockMat);
      rock.position.set(x, height(x, z) + sz * 0.3, z);
      rock.scale.set(1.2, 0.75, 1);
      rock.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      rock.castShadow = rock.receiveShadow = true;
      this.scene.add(rock);
      this.colliders.push({ x, z, r: sz * 1.05 });
    };
    for (let i = 0; i < 7; i++) {
      const a = rng() * 6.28;
      const r = 0.8 + rng() * 2.4;
      const x = ROCKS.x + Math.cos(a) * r;
      const z = ROCKS.z + Math.sin(a) * r;
      if (height(x, z) > 0.3 && !this.colliders.some((o) => Math.hypot(o.x - x, o.z - z) < 1.1)) addRock(x, z, 0.4 + rng() * 0.45);
    }
    for (let i = 0; i < 8; i++) {
      const [x, z] = onLand(12, 0.3);
      if (dist(x, z, MEADOW) < 3.5 || Math.hypot(x, z) < 2.5 || !this.colliders.every((o) => Math.hypot(o.x - x, o.z - z) > 1.3)) continue;
      addRock(x, z, 0.3 + rng() * 0.4);
    }

    // grass tufts
    const N = 1300;
    const tuft = new THREE.ConeGeometry(0.05, 0.34, 5).translate(0, 0.17, 0);
    this.grass = new THREE.InstancedMesh(tuft, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }), N);
    for (let i = 0; i < N; i++) {
      const [x, z] = onLand(13, 0.18);
      this.grassData.push({ x, y: height(x, z) - 0.02, z, ph: rng() * 6.28, s: 0.6 + rng() * 0.8 });
      this.grass.setColorAt(i, new THREE.Color().setHSL(0.27 + rng() * 0.06, 0.55, 0.52 + rng() * 0.12));
    }
    this.scene.add(this.grass);

    // flower patches
    const petalCols = [['#ffb3c7', '#ffd9e3', '#ff8fb0'], ['#fff1a8', '#ffffff', '#ffe27a'], ['#c9b6ff', '#e3d8ff', '#ffffff'], ['#ffc29a', '#fff1a8', '#ffb3c7']];
    const per = 32;
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshStandardMaterial({ roughness: 0.8 }), FLOWERS.length * per + 30);
    const stems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 4).translate(0, 0.11, 0), new THREE.MeshStandardMaterial({ color: '#6fbf73', roughness: 1 }), heads.count);
    let fi = 0;
    const addFlower = (x: number, z: number, color: string) => {
      const y = height(x, z);
      stems.setMatrixAt(fi, new THREE.Matrix4().makeTranslation(x, y, z));
      heads.setMatrixAt(fi, new THREE.Matrix4().makeTranslation(x, y + 0.24, z));
      heads.setColorAt(fi, new THREE.Color(color));
      fi++;
    };
    FLOWERS.forEach((p, k) => {
      for (let i = 0; i < per; i++) {
        let x: number, z: number;
        do {
          const a = rng() * 6.28;
          const r = Math.sqrt(rng()) * 2.2;
          x = p.x + Math.cos(a) * r;
          z = p.z + Math.sin(a) * r;
        } while (!this.walkable(x, z, 0.1));
        addFlower(x, z, petalCols[k][i % 3]);
      }
    });
    while (fi < heads.count) {
      const [x, z] = onLand(12, 0.3);
      addFlower(x, z, petalCols[fi % 4][fi % 3]);
    }
    this.scene.add(heads, stems);

    // mushrooms
    const stemG = new THREE.CylinderGeometry(0.045, 0.065, 0.16, 8).translate(0, 0.08, 0);
    const capG = new THREE.SphereGeometry(0.13, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.15, 0);
    const stemMat = new THREE.MeshStandardMaterial({ color: '#fff4e0', roughness: 1 });
    const capMats = ['#ff8f8f', '#c9a7ff', '#ffb36b'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));
    for (let i = 0; i < 9; i++) {
      const [x0, z0] = onLand(11.5, 0.3);
      if (!this.walkable(x0, z0, 0.5)) continue;
      const cap = capMats[i % 3];
      for (let j = 0; j < 3; j++) {
        const x = x0 + (rng() - 0.5) * 0.6;
        const z = z0 + (rng() - 0.5) * 0.6;
        const m = new THREE.Group();
        m.add(new THREE.Mesh(stemG, stemMat), new THREE.Mesh(capG, cap));
        m.position.set(x, height(x, z) - 0.01, z);
        m.scale.setScalar(0.8 + rng() * 0.9);
        m.rotation.z = (rng() - 0.5) * 0.25;
        m.children.forEach((o) => (o.castShadow = true));
        this.scene.add(m);
      }
    }

    // lily pads on the pond
    const padMat = new THREE.MeshStandardMaterial({ color: '#7fcf8f', roughness: 1, side: THREE.DoubleSide });
    for (let i = 0; i < 5; i++) {
      const a = i * 1.9 + 0.5;
      const r = 0.3 + (i % 3) * 0.55;
      const pad = new THREE.Mesh(new THREE.CircleGeometry(0.3, 10).rotateX(-Math.PI / 2), padMat);
      pad.position.set(POND.x + Math.cos(a) * r, 0.03, POND.z + Math.sin(a) * r);
      this.scene.add(pad);
      if (i === 1) {
        const fl = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshStandardMaterial({ color: '#ffb3c7' }));
        fl.position.set(pad.position.x, 0.1, pad.position.z);
        this.scene.add(fl);
      }
    }

    // soft clouds
    this.cloudMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, fog: false });
    for (let i = 0; i < 6; i++) {
      const cl = new THREE.Group();
      for (let j = 0; j < 4; j++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(1.2 + rng() * 0.9, 12, 8), this.cloudMat);
        b.position.set(j * 1.5 - 2, rng() * 0.4, rng() * 0.6);
        b.scale.y = 0.6;
        cl.add(b);
      }
      cl.position.set(-40 + i * 14, 11 + rng() * 4, -30 - rng() * 14);
      this.scene.add(cl);
      this.clouds.push(cl);
    }
  }

  private buildAtmosphere() {
    const rng = makeRng(77);
    const dot = dotTexture();

    // stars
    const sp = new Float32Array(150 * 3);
    for (let i = 0; i < 150; i++) {
      const a = rng() * 6.28;
      const e = 0.15 + rng() * 1.2;
      sp.set([Math.cos(a) * Math.cos(e) * 150, Math.sin(e) * 150, Math.sin(a) * Math.cos(e) * 150], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);

    // fireflies
    const nf = 80;
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nf * 3), 3));
    for (let i = 0; i < nf; i++) {
      let x: number, z: number;
      do {
        x = (rng() - 0.5) * 28;
        z = (rng() - 0.5) * 28;
      } while (height(x, z) < 0.1);
      this.flyBase.push({ x, z, ph: rng() * 6.28 });
    }
    this.flies = new THREE.Points(fg, new THREE.PointsMaterial({ color: '#f4ff8a', size: 0.42, map: dot, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.flies.frustumCulled = false;
    this.scene.add(this.flies);

    // petals and leaves
    const np = 55;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(np * 3), 3));
    const colors = new Float32Array(np * 3);
    const palette = ['#ffc2d4', '#fff0f5', '#c4eaa0', '#ffd9a8'].map((c) => new THREE.Color(c));
    for (let i = 0; i < np; i++) {
      this.petalData.push({ x: (rng() - 0.5) * 26, y: 0.5 + rng() * 7, z: (rng() - 0.5) * 26, ph: rng() * 6.28, v: 0.25 + rng() * 0.3 });
      colors.set(palette[i % 4].toArray(), i * 3);
    }
    pg.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.petals = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.2, map: dot, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
    this.petals.frustumCulled = false;
    this.scene.add(this.petals);

    // butterflies
    const wingG = new THREE.PlaneGeometry(0.26, 0.2).translate(0.13, 0, 0);
    const wingCols = ['#ffb3d1', '#ffe27a', '#b9d4ff', '#d9b8ff', '#ffc29a', '#fff'];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: wingCols[i], side: THREE.DoubleSide });
      const w1 = new THREE.Mesh(wingG, mat);
      const w2 = new THREE.Mesh(wingG, mat);
      w2.scale.x = -1;
      g.add(w1, w2);
      g.scale.setScalar(1.1);
      this.scene.add(g);
      const c = FLOWERS[i % FLOWERS.length];
      this.butterflies.push({ g, wings: [w1, w2], c, ph: rng() * 6.28, sp: 0.25 + rng() * 0.2, rad: 1.5 + rng() * 2 });
    }
  }
}
