/** mulberry32. Returns [value in [0,1), next seed]. Pure: the seed lives in battle state. */
export function nextRandom(seed: number): [number, number] {
  const t = (seed + 0x6d2b79f5) >>> 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
  return [((r ^ (r >>> 14)) >>> 0) / 4294967296, t];
}

/** Small stateful wrapper for code outside the engine (sim, bots). */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    const [v, n] = nextRandom(s);
    s = n;
    return v;
  };
}
