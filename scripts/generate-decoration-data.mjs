#!/usr/bin/env node
/**
 * Generate src/worldgen/decoration.data.ts: the ground-cover (grass / tall grass / ferns / flowers) subset of the
 * vanilla vegetal-decoration step, with feature and block-state-provider references resolved.
 *
 *   node scripts/generate-decoration-data.mjs
 *
 * Feature order follows vanilla FeatureSorter (per-biome feature chains as edges, DFS in (step, first-seen) order),
 * so each feature keeps its own vanilla step/index and therefore its own random stream.
 */
import fs from 'node:fs';

const ROOT = 'data/minecraft/worldgen';
const strip = (s) => (typeof s === 'string' ? s.replace(/^minecraft:/, '') : s);
const readDir = (d) => Object.fromEntries(fs.readdirSync(`${ROOT}/${d}`).filter((f) => f.endsWith('.json')).sort()
  .map((f) => [f.slice(0, -5), JSON.parse(fs.readFileSync(`${ROOT}/${d}/${f}`, 'utf8'))]));
const placed = readDir('placed_feature');
const features = readDir('feature');
const providers = readDir('block_state_provider');
const biomes = readDir('biome');

// ---- FeatureSorter -------------------------------------------------------------------------------------------
const firstSeen = new Map(); // feature -> {step, index}
const edges = new Map();
const biomeNames = Object.keys(biomes);
for (const b of biomeNames) {
  let prev = null;
  biomes[b].features.forEach((list, step) => {
    for (const raw of list) {
      const f = strip(raw);
      if (!firstSeen.has(f)) firstSeen.set(f, { step, index: firstSeen.size });
      if (prev !== null && prev !== f) {
        if (!edges.has(prev)) edges.set(prev, new Set());
        edges.get(prev).add(f);
      }
      prev = f;
    }
  });
}
const cmp = (a, b) => firstSeen.get(a).step - firstSeen.get(b).step || firstSeen.get(a).index - firstSeen.get(b).index;
const nodes = [...firstSeen.keys()].sort(cmp);
const visited = new Set(); const onPath = new Set(); const post = [];
const visit = (n) => {
  if (visited.has(n) || onPath.has(n)) return;
  onPath.add(n);
  for (const m of [...(edges.get(n) ?? [])].sort(cmp)) visit(m);
  onPath.delete(n); visited.add(n); post.push(n);
};
for (const n of nodes) visit(n);
post.reverse();
const byStep = []; // step -> ordered feature names
for (const n of post) (byStep[firstSeen.get(n).step] ??= []).push(n);
const orderOf = new Map(); // feature -> {step, index within step}
byStep.forEach((list, step) => list?.forEach((n, index) => orderOf.set(n, { step, index })));

// ---- ground cover subset ---------------------------------------------------------------------------------------
const SUPPORTED = new Set(['short_grass', 'tall_grass', 'fern', 'large_fern', 'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet',
  'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'sunflower', 'lilac', 'rose_bush', 'peony']);
const normState = (s) => (typeof s === 'string' ? strip(s) : strip(s.id ?? s.Name));
const resolveProvider = (p) => {
  if (typeof p === 'string') return resolveProvider(providers[strip(p)] ?? { id: p });
  if (p.id !== undefined || p.Name !== undefined) return { type: 'constant', state: normState(p) };
  const t = strip(p.type);
  const o = { ...p, type: t };
  if (t === 'weighted') o.entries = p.entries.map((e) => ({ state: normState(e.data), weight: e.weight }));
  for (const k of ['default_state']) if (p[k] !== undefined) o[k] = normState(p[k]);
  for (const k of ['high_states', 'low_states', 'states']) if (p[k]) o[k] = p[k].map(normState);
  return o;
};
const providerBlocks = (p) => {
  if (p.type === 'constant') return [p.state];
  if (p.type === 'weighted') return p.entries.map((e) => e.state);
  return [...(p.states ?? []), ...(p.high_states ?? []), ...(p.low_states ?? []), ...(p.default_state ? [p.default_state] : [])];
};
const resolveFeature = (f) => {
  if (typeof f === 'string') f = features[strip(f)];
  else if (f.type !== undefined && f.config === undefined && f.to_place === undefined && f.features === undefined) return null;
  if (!f) return null;
  const t = strip(f.type);
  if (t === 'simple_block') {
    const to_place = resolveProvider(f.to_place);
    return { type: t, to_place, blocks: providerBlocks(to_place) };
  }
  if (t === 'simple_random_selector') {
    const list = f.features.map((e) => {
      const inner = typeof e === 'string' ? placed[strip(e)] : e;
      const feat = resolveFeature(inner.feature);
      return feat && { feature: feat, placement: inner.placement.map(cleanMod) };
    });
    if (list.some((x) => !x)) return null;
    return { type: t, features: list, blocks: list.flatMap((x) => x.feature.blocks) };
  }
  return null;
};
const cleanMod = (m) => ({ ...m, type: strip(m.type) });

const out = {};
for (const name of firstSeen.keys()) {
  const p = placed[name];
  if (!p || firstSeen.get(name).step !== 9) continue;
  const feat = resolveFeature(p.feature);
  if (!feat || !feat.blocks.every((b) => SUPPORTED.has(b))) continue;
  // Only the simple ground-cover placements we implement.
  const mods = p.placement.map(cleanMod);
  const okMods = new Set(['count', 'in_square', 'heightmap', 'biome', 'rarity_filter', 'noise_threshold_count', 'offset', 'block_predicate_filter']);
  if (!mods.every((m) => okMods.has(m.type))) continue;
  const bad = mods.some((m) => m.type === 'block_predicate_filter' && JSON.stringify(m.predicate).includes('podzol') === false && m.predicate.type !== 'minecraft:matching_block_tag');
  if (bad) continue;
  const { blocks, ...featureOut } = feat;
  out[name] = { ...orderOf.get(name), feature: JSON.parse(JSON.stringify(featureOut, (k, v) => (k === 'blocks' ? undefined : v))), placement: mods };
}
const biomeFeatures = {};
for (const [b, def] of Object.entries(biomes)) {
  const list = (def.features[9] ?? []).map(strip).filter((n) => out[n]);
  if (list.length) biomeFeatures[b] = list;
}
const body = `// Generated by scripts/generate-decoration-data.mjs from data/minecraft/worldgen. Do not hand-edit.
export interface DecorationFeatureData { step: number; index: number; feature: any; placement: any[]; }
export const DECORATION_FEATURES: Record<string, DecorationFeatureData> = ${JSON.stringify(out)};
export const DECORATION_BIOME_FEATURES: Record<string, string[]> = ${JSON.stringify(biomeFeatures)};
/** Every biome name, index = id stored in the per-column biome grid. */
export const DECORATION_BIOME_LIST: string[] = ${JSON.stringify(biomeNames)};
`;
fs.writeFileSync('src/worldgen/decoration.data.ts', body);
console.log(Object.keys(out).length, 'features;', Object.keys(biomeFeatures).length, 'biomes;', (body.length / 1024).toFixed(1), 'KB');
console.log(Object.keys(out).join(' '));
