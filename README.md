# Mossling

A cozy little creature island that runs in the browser. Walk around, pet the
creatures, feed them berries, and make friends who follow you about.

## Play

```bash
npm install
npm run dev
```

Then open http://localhost:5173/.

- **Walk:** WASD / arrow keys, or click the ground
- **Look:** drag to orbit, scroll to zoom
- **Pet:** click a creature, or press E next to it
- **Berry:** press F or use the berry button
- **Friends:** three hearts and a creature follows you; click it to stay or follow

Friendship is saved in your browser.

## What's inside

- `src/client/` – the island, player, creatures and HUD (three.js + plain HTML/CSS)
- `src/data/creatures.ts` – the 12 creatures
- `src/engine/` – an unused turn-based battle engine with tests, kept from an earlier direction
- `public/creatures/` – creature portraits, AI-generated with the free Pollinations image API

```bash
npm test       # engine tests
npm run build  # production build
```
