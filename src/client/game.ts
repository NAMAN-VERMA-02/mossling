import * as THREE from 'three';
import { CREATURES } from '../data/creatures';
import type { CreatureDef } from '../engine/rules';
import { blobShadowTexture, creatureArt, creatureTexture } from './art';
import { createHud, hearts } from './hud';
import { FLOWERS, HILL, MEADOW, POND, ROCKS, World, height } from './world';

const SAVE_KEY = 'mossling.v1';
interface SaveRow { lv: number; met: boolean; stay: boolean; fo: number }
type Save = Record<string, SaveRow>;
type Hud = ReturnType<typeof createHud>;
type Pt = { x: number; z: number };

const PET_CD = 3; // seconds between friendship gains
const BERRY_CD = 5;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Loose favourite spot per element. */
const HOME: Record<string, { c: Pt; r: number }> = {
  tide: { c: POND, r: 5 },
  bloom: { c: FLOWERS[0], r: 3.5 },
  stone: { c: ROCKS, r: 4 },
  frost: { c: HILL, r: 3.5 },
  ember: { c: MEADOW, r: 4.5 },
  spark: { c: MEADOW, r: 4.5 },
};

type Mode = 'pause' | 'walk' | 'nap' | 'berry' | 'follow';

interface Berry { mesh: THREE.Group; x: number; z: number; life: number }

class Critter {
  readonly sprite: THREE.Sprite;
  readonly shadow: THREE.Mesh;
  x = 0;
  z = 0;
  mode: Mode = 'pause';
  timer = rand(0.5, 3);
  goal: Pt = { x: 0, z: 0 };
  partner: Critter | null = null;
  berry: Berry | null = null;
  bounceT = 0;
  petT = 0;
  napFx = 0;
  walkPh = Math.random() * 6;
  phase = Math.random() * 6;
  lastPet = -99;
  lastBerry = -99;
  row: SaveRow = { lv: 0, met: false, stay: false, fo: 0 };
  readonly size = 1.55;

  constructor(readonly def: CreatureDef, scene: THREE.Scene, shadowTex: THREE.Texture) {
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
    this.sprite.center.set(0.5, 0.04);
    this.sprite.renderOrder = 10;
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
    );
    this.shadow.renderOrder = 5; // after the transparent water
    this.sprite.userData.critter = this;
    scene.add(this.sprite, this.shadow);
    void creatureTexture(def).then((t) => {
      this.sprite.material.map = t;
      this.sprite.material.needsUpdate = true;
    });
  }

  get friend() { return this.row.lv >= 3; }
  get following() { return this.friend && !this.row.stay; }
  bounce(s = 1.3) { this.bounceT = s; }
}

export class Game {
  private critters: Critter[] = [];
  private berries: Berry[] = [];
  private save: Save = {};
  private keys = new Set<string>();
  private trail: Pt[] = [];
  private player = new THREE.Group();
  private pBody = new THREE.Group();
  private pShadow: THREE.Mesh;
  private px = 0;
  private pz = 0;
  private pFace = 0;
  private hopPh = 0;
  private moving = false;
  private target: Pt | null = null;
  private marker: THREE.Mesh;
  private lastBerryDrop = -99;
  private tagFor: Critter | null = null;
  private tagT = 0;
  private foCounter = 0;
  private hud: Hud;

  constructor(private world: World, hudRoot: HTMLElement) {
    this.load();
    this.hud = createHud(hudRoot, {
      onBerry: () => this.dropBerry(),
      entries: () => this.critters.map((c) => ({ name: c.def.name, element: c.def.element, look: c.def.look, lv: c.row.lv, met: c.row.met, art: creatureArt(c.def) })),
    });
    const st = blobShadowTexture();
    this.pShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false }));
    this.pShadow.renderOrder = 5;
    this.buildPlayer();
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.32, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false }),
    );
    this.marker.renderOrder = 6;
    this.marker.visible = false;
    world.scene.add(this.player, this.pShadow, this.marker);
    for (let k = 0; k < 24; k++) this.trail.push({ x: 0, z: k * 0.3 });

    for (const def of CREATURES) {
      const c = new Critter(def, world.scene, st);
      c.row = this.save[def.id] ?? c.row;
      this.save[def.id] = c.row;
      const home = HOME[def.element];
      for (let r = 1; ; r += 0.05) {
        const a = Math.random() * 6.28;
        const rr = Math.sqrt(Math.random()) * Math.min(home.r, r);
        const x = home.c.x + Math.cos(a) * rr;
        const z = home.c.z + Math.sin(a) * rr;
        if (world.walkable(x, z, 0.5) && this.critters.every((o) => Math.hypot(o.x - x, o.z - z) > 1.1)) {
          c.x = x;
          c.z = z;
          break;
        }
      }
      this.critters.push(c);
    }
    this.hud.setFriends(this.friendCount(), CREATURES.length);
    this.bindInput();
    world.onUpdate = (dt, t) => this.update(dt, t);
  }

  // ---- persistence ----
  private load() {
    try {
      const raw = JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}');
      for (const c of CREATURES) {
        const r = raw[c.id];
        if (r && typeof r.lv === 'number') this.save[c.id] = { lv: Math.max(0, Math.min(3, r.lv | 0)), met: !!r.met, stay: !!r.stay, fo: Number(r.fo) || 0 };
      }
    } catch { /* unreadable save: start fresh */ }
    this.foCounter = Math.max(0, ...Object.values(this.save).map((r) => r.fo));
  }
  private persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); } catch { /* storage blocked */ }
  }
  private friendCount() { return this.critters.length ? this.critters.filter((c) => c.friend).length : Object.values(this.save).filter((r) => r.lv >= 3).length; }

  // ---- player ----
  private buildPlayer() {
    const std = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 18), std('#ffe6c4'));
    body.position.y = 0.5;
    body.scale.set(1, 0.92, 1);
    const parts: THREE.Object3D[] = [body];
    for (const s of [-1, 1]) {
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), std('#f4a98a'));
      foot.position.set(s * 0.17, 0.1, 0.1);
      foot.scale.set(1, 0.7, 1.3);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.048, 10, 8), new THREE.MeshBasicMaterial({ color: '#3b3050' }));
      eye.position.set(s * 0.14, 0.58, 0.38);
      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff9fb3', transparent: true, opacity: 0.8 }));
      cheek.position.set(s * 0.25, 0.47, 0.32);
      cheek.scale.set(1, 0.6, 0.35);
      cheek.rotation.y = s * 0.7;
      parts.push(foot, eye, cheek);
    }
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 6, 12, Math.PI), new THREE.MeshBasicMaterial({ color: '#3b3050' }));
    smile.position.set(0, 0.5, 0.405);
    smile.rotation.z = Math.PI;
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 8), std('#7fd08a'));
    leaf.scale.set(1.35, 0.22, 0.75);
    leaf.position.set(0.04, 0.93, 0);
    leaf.rotation.z = 0.3;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.12, 6), std('#5fae6b'));
    stem.position.set(-0.08, 0.9, 0);
    stem.rotation.z = 0.3;
    parts.push(smile, leaf, stem);
    for (const p of parts) p.traverse((o) => (o.castShadow = true));
    this.pBody.add(...parts);
    this.player.add(this.pBody);
  }

  // ---- input ----
  private bindInput() {
    const cv = this.world.renderer.domElement;
    cv.style.touchAction = 'none';
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === 'f' && !e.repeat) this.dropBerry();
      if (k === 'e' && !e.repeat) this.petNearest();
      if (k.startsWith('arrow') || k === ' ') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.world.zoom(Math.exp(e.deltaY * 0.001)); }, { passive: false });

    const ptrs = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let pinch = 0;
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0;
      pinch = 0;
    });
    cv.addEventListener('pointermove', (e) => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) this.world.zoom(pinch / d);
        pinch = d;
      } else if (moved > 8) this.world.orbit(dx, dy);
    });
    const up = (e: PointerEvent) => {
      const had = ptrs.delete(e.pointerId);
      if (had && e.type === 'pointerup' && moved <= 8 && ptrs.size === 0 && pinch === 0) this.click(e.clientX, e.clientY);
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
  }

  private click(cx: number, cy: number) {
    const r = this.world.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), this.world.camera);
    const hit = ray.intersectObjects(this.critters.map((c) => c.sprite), false)[0];
    if (hit) {
      const c = hit.object.userData.critter as Critter;
      this.pet(c, true);
      return;
    }
    const g = this.world.pickGround(cx, cy);
    if (!g) return;
    // pull the target back along the line to the player until it is somewhere you can stand
    let tx = g.x;
    let tz = g.z;
    for (let i = 0; i < 24 && !this.world.walkable(tx, tz, 0.3); i++) {
      tx += (this.px - tx) * 0.12;
      tz += (this.pz - tz) * 0.12;
    }
    this.target = { x: tx, z: tz };
    this.marker.visible = true;
    this.marker.position.set(tx, height(tx, tz) + 0.05, tz);
  }

  // ---- interactions ----
  /** Raise a creature's friendship by one heart unless it is still on cooldown. */
  private love(c: Critter, kind: 'pet' | 'berry'): boolean {
    const now = this.world.time;
    const last = kind === 'pet' ? c.lastPet : c.lastBerry;
    if (now - last < (kind === 'pet' ? PET_CD : BERRY_CD) || c.row.lv >= 3) return false;
    if (kind === 'pet') c.lastPet = now;
    else c.lastBerry = now;
    c.row.lv++;
    if (c.row.lv >= 3) {
      c.row.fo = ++this.foCounter;
      c.row.stay = false;
      this.say(c, 'New friend!', 'big');
      for (let i = 0; i < 6; i++) setTimeout(() => this.burst(c, 1), i * 120);
      this.hud.setFriends(this.friendCount(), CREATURES.length);
    }
    this.persist();
    this.hud.refreshAlbum();
    return true;
  }

  private anchor(c: Critter, lift = 1.9) {
    return this.world.project(new THREE.Vector3(c.x, height(c.x, c.z) + lift * (c.size / 1.55), c.z));
  }
  private burst(c: Critter, n: number) {
    for (let i = 0; i < n; i++) {
      const p = this.anchor(c);
      this.hud.float(p.x + rand(-26, 26), p.y + rand(-6, 10), '♥', 'heart');
    }
  }
  private say(c: Critter, text: string, cls = '') {
    const p = this.anchor(c, 2.4);
    this.hud.float(p.x, p.y, text, cls);
  }
  private meet(c: Critter) {
    if (c.row.met) return;
    c.row.met = true;
    this.persist();
    this.hud.refreshAlbum();
  }

  private pet(c: Critter, fromClick = false) {
    this.meet(c);
    if (c.mode === 'nap') { c.mode = 'pause'; c.timer = 1.5; }
    c.petT = 0.8;
    c.bounce(0.7);
    const gained = this.love(c, 'pet');
    this.burst(c, gained ? 3 : 1);
    this.tagFor = c;
    this.tagT = 2.6;
    // clicking a friend also toggles follow / stay
    if (c.friend && !gained && fromClick) {
      c.row.stay = !c.row.stay;
      if (c.row.stay) { c.mode = 'pause'; c.timer = 2; }
      this.say(c, c.row.stay ? 'Staying here' : 'Following you!');
      this.persist();
    }
  }

  private petNearest() {
    let best: Critter | null = null;
    let bd = 2.6;
    for (const c of this.critters) {
      const d = Math.hypot(c.x - this.px, c.z - this.pz);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) this.pet(best);
  }

  private dropBerry() {
    const now = this.world.time;
    if (now - this.lastBerryDrop < 0.8 || this.berries.length >= 4) return;
    this.lastBerryDrop = now;
    const x = this.px + Math.sin(this.pFace) * 0.7;
    const z = this.pz + Math.cos(this.pFace) * 0.7;
    const ok = this.world.walkable(x, z, 0.1);
    const bx = ok ? x : this.px;
    const bz = ok ? z : this.pz;
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), new THREE.MeshStandardMaterial({ color: '#ff6f8e', roughness: 0.5 }));
    b.position.y = 0.17;
    b.castShadow = true;
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshStandardMaterial({ color: '#6fcf7f' }));
    l.position.set(0.04, 0.34, 0);
    l.scale.set(1.6, 0.4, 1);
    g.add(b, l);
    g.position.set(bx, height(bx, bz), bz);
    this.world.scene.add(g);
    const berry: Berry = { mesh: g, x: bx, z: bz, life: 30 };
    this.berries.push(berry);
    // the nearest few creatures within earshot come running
    const near = this.critters
      .filter((c) => Math.hypot(c.x - bx, c.z - bz) < 12)
      .sort((a, b2) => Math.hypot(a.x - bx, a.z - bz) - Math.hypot(b2.x - bx, b2.z - bz))
      .slice(0, 3);
    for (const c of near) {
      c.mode = 'berry';
      c.berry = berry;
      c.partner = null;
    }
  }

  // ---- per-frame ----
  private moveCritter(c: Critter, gx: number, gz: number, speed: number, dt: number): number {
    const dx = gx - c.x;
    const dz = gz - c.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.001) return 0;
    const step = Math.min(speed * dt, d);
    const nx = c.x + (dx / d) * step;
    const nz = c.z + (dz / d) * step;
    const w = this.world;
    if (w.walkable(nx, nz, 0.25)) { c.x = nx; c.z = nz; }
    else if (w.walkable(nx, c.z, 0.25)) c.x = nx;
    else if (w.walkable(c.x, nz, 0.25)) c.z = nz;
    else return -1; // boxed in
    c.walkPh += step * 5;
    return d - step;
  }

  private choose(c: Critter) {
    const r = Math.random();
    const home = HOME[c.def.element];
    const friendsNearby = this.critters.filter((o) => o !== c && Math.hypot(o.x - c.x, o.z - c.z) < 9 && o.mode !== 'berry');
    if (r < 0.45) {
      for (let i = 0; i < 12; i++) {
        const near = Math.random() < 0.7;
        const a = Math.random() * 6.28;
        const rr = Math.sqrt(Math.random()) * (near ? home.r : 7);
        const base = near ? home.c : c;
        const x = base.x + Math.cos(a) * rr;
        const z = base.z + Math.sin(a) * rr;
        if (this.world.walkable(x, z, 0.4)) { c.goal = { x, z }; c.mode = 'walk'; c.partner = null; return; }
      }
      c.timer = 1;
    } else if (r < 0.62) { c.bounce(1.2); c.timer = rand(1.4, 2.4); }
    else if (r < 0.74) { c.mode = 'nap'; c.timer = rand(7, 12); c.napFx = 0; }
    else if (r < 0.9 && friendsNearby.length) {
      const o = friendsNearby[Math.floor(Math.random() * friendsNearby.length)];
      c.partner = o;
      c.goal = { x: o.x, z: o.z };
      c.mode = 'walk';
    } else c.timer = rand(1.5, 4);
  }

  private trailPoint(dist: number): Pt {
    let acc = 0;
    for (let i = this.trail.length - 1; i > 0; i--) {
      acc += Math.hypot(this.trail[i].x - this.trail[i - 1].x, this.trail[i].z - this.trail[i - 1].z);
      if (acc >= dist) return this.trail[i - 1];
    }
    return this.trail[0];
  }

  private update(dt: number, t: number) {
    const w = this.world;
    this.updatePlayer(dt, t);

    // berries
    for (const b of [...this.berries]) {
      b.life -= dt;
      b.mesh.position.y = height(b.x, b.z) + Math.sin(t * 3 + b.x) * 0.02;
      if (b.life <= 0) this.removeBerry(b);
    }

    const followers = this.critters.filter((c) => c.following).sort((a, b) => a.row.fo - b.row.fo);
    for (const c of this.critters) {
      if (!c.row.met && Math.hypot(c.x - this.px, c.z - this.pz) < 3.5) this.meet(c);
      if (c.bounceT > 0) c.bounceT -= dt;
      if (c.petT > 0) c.petT -= dt;

      if (c.mode === 'berry') {
        const b = c.berry;
        if (!b || !this.berries.includes(b)) { c.mode = 'pause'; c.timer = 0.6; c.berry = null; }
        else {
          const left = this.moveCritter(c, b.x, b.z, 3.2, dt);
          if (left < 0.5) {
            this.removeBerry(b);
            c.berry = null;
            c.mode = 'pause';
            c.timer = 1.6;
            c.bounce(1.1);
            this.meet(c);
            const gained = this.love(c, 'berry');
            this.burst(c, gained ? 3 : 2);
            this.tagFor = c;
            this.tagT = 2.2;
          }
        }
      } else if (c.following) {
        const i = followers.indexOf(c);
        const p = this.trailPoint(1.3 + i * 1.1);
        const d = Math.hypot(p.x - c.x, p.z - c.z);
        if (Math.hypot(this.px - c.x, this.pz - c.z) > 16) { c.x = p.x; c.z = p.z; }
        else if (d > 0.3) this.moveCritter(c, p.x, p.z, Math.min(5.5, 1.5 + d * 1.3), dt);
        c.mode = 'follow';
      } else {
        if (c.mode === 'follow') { c.mode = 'pause'; c.timer = 1; }
        if (c.mode === 'pause') {
          c.timer -= dt;
          if (c.timer <= 0 && c.bounceT <= 0) this.choose(c);
        } else if (c.mode === 'walk') {
          if (c.partner) { c.goal.x = c.partner.x; c.goal.z = c.partner.z; }
          const left = this.moveCritter(c, c.goal.x, c.goal.z, rand(1.25, 1.3), dt);
          const reach = c.partner ? 1.0 : 0.15;
          if (left < 0 || left < reach) {
            if (c.partner && left >= 0) {
              c.bounce(1.4);
              c.partner.bounce(1.4);
              if (c.partner.mode === 'nap') c.partner.mode = 'pause';
              c.partner.timer = 1.8;
              this.sparkle(c);
            }
            c.partner = null;
            c.mode = 'pause';
            c.timer = rand(1.5, 4);
          }
        } else if (c.mode === 'nap') {
          c.timer -= dt;
          c.napFx -= dt;
          if (c.napFx <= 0 && Math.random() < 0.5 * dt * 3) {
            c.napFx = 1.5;
            this.say(c, 'z z z', 'zzz');
          }
          if (c.timer <= 0 || Math.hypot(c.x - this.px, c.z - this.pz) < 1.3) { c.mode = 'pause'; c.timer = 1.5; }
        }
      }
    }
    // gentle push-apart so they do not stack
    for (let i = 0; i < this.critters.length; i++)
      for (let j = i + 1; j < this.critters.length; j++) {
        const a = this.critters[i];
        const b = this.critters[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.7 && d > 0.001 && a.mode !== 'berry' && b.mode !== 'berry') {
          const push = (0.7 - d) * 0.5 * Math.min(1, dt * 6);
          for (const [o, s] of [[a, -1], [b, 1]] as const) {
            const nx = o.x + (dx / d) * push * s;
            const nz = o.z + (dz / d) * push * s;
            if (w.walkable(nx, nz, 0.25)) { o.x = nx; o.z = nz; }
          }
        }
      }
    for (const c of this.critters) this.pose(c, t);

    // name tag
    if (this.tagFor && this.tagT > 0) {
      this.tagT -= dt;
      const p = this.anchor(this.tagFor, 2.0);
      this.hud.tag(`${this.tagFor.def.name}  ${hearts(this.tagFor.row.lv)}`, p.x, p.y);
    } else this.hud.tag(null);
  }

  private sparkle(c: Critter) {
    const p = this.anchor(c, 2.2);
    this.hud.float(p.x, p.y, '♪', 'note');
  }

  private removeBerry(b: Berry) {
    this.world.scene.remove(b.mesh);
    this.berries.splice(this.berries.indexOf(b), 1);
  }

  private pose(c: Critter, t: number) {
    const gy = height(c.x, c.z);
    const walking = c.mode === 'walk' || c.mode === 'berry' || c.mode === 'follow';
    const hopWalk = walking ? Math.abs(Math.sin(c.walkPh)) * 0.14 : 0;
    const hopBounce = c.bounceT > 0 ? Math.abs(Math.sin((1.4 - Math.min(1.4, c.bounceT)) * Math.PI * 2.2)) * 0.45 : 0;
    const sleeping = c.mode === 'nap';
    const bob = Math.sin(t * (sleeping ? 1.1 : 2.2) + c.phase) * 0.5 + 0.5;
    const w = c.petT > 0 ? Math.sin(c.petT * 22) * (c.petT / 0.8) : 0; // squish wobble
    const sx = c.size * (1 + w * 0.2 + (1 - bob) * 0.03);
    const sy = c.size * (1 - w * 0.2 + bob * 0.04) * (sleeping ? 0.9 : 1);
    const lift = hopWalk + hopBounce;
    c.sprite.position.set(c.x, gy + 0.04 + lift + bob * 0.03, c.z);
    c.sprite.scale.set(sx, sy, 1);
    c.sprite.material.color.copy(this.world.spriteTint);
    const sh = c.size * 1.05 * (1 - Math.min(0.4, lift));
    c.shadow.scale.set(sh, 1, sh * 0.6);
    c.shadow.position.set(c.x, gy + 0.03, c.z);
  }

  private updatePlayer(dt: number, t: number) {
    const k = this.keys;
    let ix = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    let iz = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0); // +z = toward the camera
    const yaw = this.world.yaw;
    const speed = 4.2;
    let dx = 0;
    let dz = 0;
    if (ix || iz) {
      this.target = null;
      this.marker.visible = false;
      const len = Math.hypot(ix, iz);
      ix /= len;
      iz /= len;
      // camera sits at +(sin yaw, cos yaw) from the player: "up" on the keys is the opposite direction
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      dx = fx * -iz + -fz * ix;
      dz = fz * -iz + fx * ix;
    } else if (this.target) {
      const tx = this.target.x - this.px;
      const tz = this.target.z - this.pz;
      const d = Math.hypot(tx, tz);
      if (d < 0.12) { this.target = null; this.marker.visible = false; }
      else { dx = tx / d; dz = tz / d; }
    }
    this.moving = false;
    if (dx || dz) {
      const w = this.world;
      const step = Math.min(speed * dt, this.target ? Math.hypot(this.target.x - this.px, this.target.z - this.pz) : 99);
      const nx = this.px + dx * step;
      const nz = this.pz + dz * step;
      if (w.walkable(nx, nz, 0.3)) { this.px = nx; this.pz = nz; this.moving = true; }
      else if (w.walkable(nx, this.pz, 0.3) && Math.abs(dx) > 0.2) { this.px = nx; this.moving = true; }
      else if (w.walkable(this.px, nz, 0.3) && Math.abs(dz) > 0.2) { this.pz = nz; this.moving = true; }
      else if (this.target) { this.target = null; this.marker.visible = false; } // walked into the shore: stop
      if (this.moving) {
        const want = Math.atan2(dx, dz);
        let da = want - this.pFace;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        this.pFace += da * Math.min(1, dt * 14);
      }
    }
    const last = this.trail[this.trail.length - 1];
    if (Math.hypot(this.px - last.x, this.pz - last.z) > 0.3) {
      this.trail.push({ x: this.px, z: this.pz });
      if (this.trail.length > 160) this.trail.shift();
    }
    this.hopPh = this.moving ? this.hopPh + dt * 11 : 0;
    const hop = this.moving ? Math.abs(Math.sin(this.hopPh)) * 0.2 : 0;
    const breathe = this.moving ? 0 : Math.sin(t * 2.2) * 0.012;
    const gy = height(this.px, this.pz);
    this.player.position.set(this.px, gy + hop, this.pz);
    this.pBody.rotation.y = this.pFace;
    this.pBody.scale.set(1 + (this.moving ? 0.05 * (1 - hop / 0.2) : -breathe), 1 - (this.moving ? 0.05 * (1 - hop / 0.2) : -breathe), 1 + (this.moving ? 0.05 * (1 - hop / 0.2) : -breathe));
    this.pShadow.position.set(this.px, gy + 0.03, this.pz);
    const s = 1.0 * (1 - hop * 0.8);
    this.pShadow.scale.set(s, 1, s * 0.65);
    if (this.marker.visible) this.marker.scale.setScalar(1 + Math.sin(t * 6) * 0.1);
    this.world.focus.set(this.px, gy, this.pz);
  }

  /** Debug / test access. */
  api() {
    return {
      critters: this.critters,
      player: () => ({ x: this.px, z: this.pz }),
      teleport: (x: number, z: number) => { this.px = x; this.pz = z; },
      pet: (id: string) => { const c = this.critters.find((o) => o.def.id === id); if (c) this.pet(c, true); },
      berry: () => this.dropBerry(),
      save: this.save,
    };
  }
}
