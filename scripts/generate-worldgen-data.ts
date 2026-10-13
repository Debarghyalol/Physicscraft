#!/usr/bin/env node
/**
 * Generate src/worldgen/data.generated.ts from vanilla worldgen JSON.
 *
 * Usage:
 *   npx tsx scripts/generate-worldgen-data.ts            # reads ./data/minecraft/worldgen (committed in the repo)
 *   npx tsx scripts/generate-worldgen-data.ts <dir>      # a directory containing density_function/, noise/, ...
 *   npx tsx scripts/generate-worldgen-data.ts <x.zip>    # a decompiler zip (also refreshes ./data/minecraft)
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = process.argv[2];
const REPO_DATA = 'data/minecraft/worldgen';

async function loadFromZip(file: string): Promise<(rel: string) => any> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  // Refresh the committed raw JSON so the repo stays the source of truth.
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (!/^data\/minecraft\/(worldgen|tags\/worldgen)\//.test(name) || !name.endsWith('.json')) continue;
    fs.mkdirSync(path.dirname(name), { recursive: true });
    fs.writeFileSync(name, await entry.async('string'));
  }
  return (rel) => JSON.parse(fs.readFileSync(path.join(REPO_DATA, rel), 'utf8'));
}

function listJson(root: string, sub: string): Record<string, any> {
  const out: Record<string, any> = {};
  const base = path.join(root, sub);
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.json')) out[path.relative(base, p).replace(/\\/g, '/').slice(0, -5)] = JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  };
  if (fs.existsSync(base)) walk(base);
  return out;
}

let root = REPO_DATA;
if (arg && arg.endsWith('.zip')) await loadFromZip(arg);
else if (arg) root = arg;
if (!fs.existsSync(root)) {
  console.error(`Missing ${root}. Pass a vanilla data directory or a decompiler zip.`);
  process.exit(2);
}

const densities = listJson(root, 'density_function');
const noises = listJson(root, 'noise');
const materialRules = listJson(root, 'material_rule');
const materialConditions = listJson(root, 'material_condition');
const biomes = listJson(root, 'biome');
const settings = listJson(root, 'noise_settings');
if (!densities['overworld/final_density']) throw new Error('Missing overworld/final_density.json');
if (!materialRules['overworld']) throw new Error('Missing material_rule/overworld.json');

// Only the climate fields the generator needs from each biome (the full JSON stays in data/).
const biomeClimate: Record<string, [number, number, boolean, string]> = {};
for (const [name, b] of Object.entries(biomes)) biomeClimate[name] = [b.temperature, b.downfall, !!b.has_precipitation, b.temperature_modifier ?? 'none'];

const ow = settings['overworld'];
const overworld = {
  sea_level: ow.sea_level, default_block: ow.default_block, default_fluid: ow.default_fluid,
  material_rule: ow.material_rule, noise_router: ow.noise_router, noise: ow.noise,
};

const out = '// Generated from data/minecraft/worldgen by scripts/generate-worldgen-data.ts. Do not hand-edit.\n' +
  'export const DENSITY_JSON: Record<string, any> = ' + JSON.stringify(densities) + ';\n' +
  'export const NOISE_SETTINGS: Record<string, any> = ' + JSON.stringify(noises) + ';\n' +
  'export const MATERIAL_RULES: Record<string, any> = ' + JSON.stringify(materialRules) + ';\n' +
  'export const MATERIAL_CONDITIONS: Record<string, any> = ' + JSON.stringify(materialConditions) + ';\n' +
  '/** biome -> [temperature, downfall, has_precipitation, temperature_modifier] */\n' +
  'export const BIOME_CLIMATE: Record<string, [number, number, boolean, string]> = ' + JSON.stringify(biomeClimate) + ';\n' +
  'export const OVERWORLD_SETTINGS: Record<string, any> = ' + JSON.stringify(overworld) + ';\n';
fs.mkdirSync('src/worldgen', { recursive: true });
fs.writeFileSync('src/worldgen/data.generated.ts', out);
console.log(`Generated ${Object.keys(densities).length} density, ${Object.keys(noises).length} noise, ` +
  `${Object.keys(materialRules).length} material rules, ${Object.keys(materialConditions).length} conditions, ${Object.keys(biomeClimate).length} biomes.`);
