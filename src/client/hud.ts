import { Art } from './art';
import { ELEMENT_COLOR } from './theme';
import type { Element } from '../engine/rules';

export interface AlbumEntry {
  name: string;
  element: Element;
  look: string;
  lv: number;
  met: boolean;
  art: Promise<Art>;
}

export const hearts = (lv: number) => '♥'.repeat(lv) + '♡'.repeat(3 - lv);

export function createHud(root: HTMLElement, cb: { onBerry: () => void; entries: () => AlbumEntry[] }) {
  const touch = matchMedia('(pointer: coarse)').matches;
  root.innerHTML = `
    <div class="fx"></div>
    <button class="pill" aria-haspopup="dialog">Friends <b>0/12</b></button>
    <button class="berry" aria-label="Drop a berry" title="Drop a berry (F)">
      <svg viewBox="0 0 40 40" width="38" height="38" aria-hidden="true"><ellipse cx="20" cy="24" rx="12" ry="11" fill="#ff6f8e"/><ellipse cx="16" cy="20" rx="3.5" ry="2.5" fill="#fff" opacity=".55"/><path d="M20 13c-1-5 3-8 8-7-1 5-4 8-8 7z" fill="#6fcf7f"/></svg>
    </button>
    <div class="hint">${touch ? 'Tap the ground to walk · tap a creature to pet it · berry button to feed' : 'WASD / arrows or click to walk · click a creature or press E to pet · F drops a berry · drag to look, wheel to zoom'}</div>
    <div class="tag" hidden></div>
    <div class="album" hidden role="dialog" aria-label="Friends album">
      <div class="sheet">
        <header><h2>Island friends</h2><button class="close" aria-label="Close">×</button></header>
        <div class="grid"></div>
      </div>
    </div>`;
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  const fx = $('.fx');
  const pill = $<HTMLButtonElement>('.pill');
  const album = $('.album');
  const grid = $('.grid');
  const tag = $('.tag');

  function renderAlbum() {
    grid.replaceChildren();
    for (const e of cb.entries()) {
      const card = document.createElement('div');
      card.className = 'card' + (e.met ? '' : ' unmet');
      const portrait = document.createElement('canvas');
      portrait.width = portrait.height = 128;
      portrait.style.setProperty('--c', ELEMENT_COLOR[e.element]);
      void e.art.then((a) => portrait.getContext('2d')!.drawImage(a, 0, 0, 128, 128));
      const info = document.createElement('div');
      info.className = 'info';
      info.innerHTML = e.met
        ? `<b></b><span class="hearts">${hearts(e.lv)}</span><p></p>`
        : `<b>???</b><span class="hearts">${hearts(0)}</span><p>Not met yet. Keep exploring!</p>`;
      if (e.met) {
        info.querySelector('b')!.textContent = e.name + (e.lv >= 3 ? ' · friend' : '');
        info.querySelector('p')!.textContent = e.look;
      }
      card.append(portrait, info);
      grid.append(card);
    }
  }
  const setOpen = (open: boolean) => {
    album.hidden = !open;
    if (open) renderAlbum();
  };
  pill.onclick = () => setOpen(album.hidden);
  $('.close').onclick = () => setOpen(false);
  album.addEventListener('pointerdown', (e) => {
    if (e.target === album) setOpen(false);
  });
  window.addEventListener('keydown', (e) => e.key === 'Escape' && setOpen(false));
  $('.berry').addEventListener('click', cb.onBerry);
  setTimeout(() => $('.hint').classList.add('gone'), 12000);

  return {
    setFriends(n: number, total: number) {
      pill.innerHTML = `Friends <b>${n}/${total}</b>`;
      if (!album.hidden) renderAlbum();
    },
    refreshAlbum() {
      if (!album.hidden) renderAlbum();
    },
    isOpen: () => !album.hidden,
    float(x: number, y: number, text: string, cls = '') {
      const el = document.createElement('span');
      el.className = 'float ' + cls;
      el.textContent = text;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      fx.append(el);
      el.addEventListener('animationend', () => el.remove());
      setTimeout(() => el.remove(), 3500);
    },
    /** Show the name tag at a screen point, or hide it with null. */
    tag(text: string | null, x = 0, y = 0) {
      tag.hidden = text === null;
      if (text !== null) {
        if (tag.dataset.t !== text) {
          tag.textContent = text;
          tag.dataset.t = text;
        }
        tag.style.transform = `translate(${Math.max(70, Math.min(innerWidth - 70, x))}px, ${Math.max(34, y)}px) translate(-50%, -100%)`;
      }
    },
  };
}
