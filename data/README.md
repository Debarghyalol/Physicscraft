# Vanilla worldgen data

Raw Minecraft (26.3) data-pack JSON used to reproduce vanilla terrain generation:

- `minecraft/worldgen/density_function`, `noise`, `noise_settings` – terrain shape (BlendedNoise, splines, caves)
- `minecraft/worldgen/material_rule`, `material_condition` – surface rules (grass/dirt/sand/terracotta/snow, deepslate, bedrock)
- `minecraft/worldgen/biome`, `multi_noise_biome_source_parameter_list` – biome definitions (the overworld biome *table* is code, ported to `src/worldgen/biome/OverworldBiomeBuilder.ts`)
- `minecraft/worldgen/feature`, `placed_feature`, `carver`, `structure`, `template_pool` and `minecraft/tags/worldgen` – not consumed yet; kept for upcoming feature/structure work

The files are Mojang's data, extracted unmodified from the client jar.

Regenerate the bundled TypeScript data after changing anything here:

```bash
npx tsx scripts/generate-worldgen-data.ts            # reads ./data/minecraft/worldgen
npx tsx scripts/generate-worldgen-data.ts client.zip # or refresh ./data from a decompiler zip
```
