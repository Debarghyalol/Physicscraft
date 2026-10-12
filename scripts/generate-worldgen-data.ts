#!/usr/bin/env node
/** Generate src/worldgen/data.generated.ts from a decompiler ZIP.
 * Usage: npx tsx scripts/generate-worldgen-data.ts client.jar_Decompiler.com.zip
 */
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
const input=process.argv[2];
if(!input){console.error('Usage: npx tsx scripts/generate-worldgen-data.ts <minecraft-decompiler.zip>');process.exit(2);}
const zip=await JSZip.loadAsync(fs.readFileSync(input));
const densities:Record<string,unknown>={},noises:Record<string,unknown>={};
for(const [name,entry] of Object.entries(zip.files)){
 if(entry.dir)continue;
 const d='data/minecraft/worldgen/density_function/',n='data/minecraft/worldgen/noise/';
 if(name.startsWith(d)&&name.endsWith('.json'))densities[name.slice(d.length,-5)]=JSON.parse(await entry.async('string'));
 if(name.startsWith(n)&&name.endsWith('.json'))noises[name.slice(n.length,-5)]=JSON.parse(await entry.async('string'));
}
if(!densities['overworld/final_density'])throw new Error('Missing overworld/final_density.json in archive');
fs.mkdirSync(path.dirname('src/worldgen/data.generated.ts'),{recursive:true});
fs.writeFileSync('src/worldgen/data.generated.ts','// Generated from Minecraft worldgen JSON. Do not hand-edit.\n'+
 'export const DENSITY_JSON: Record<string, any> = '+JSON.stringify(densities)+';\n'+
 'export const NOISE_SETTINGS: Record<string, any> = '+JSON.stringify(noises)+';\n');
console.log('Generated '+Object.keys(densities).length+' density JSONs and '+Object.keys(noises).length+' noise settings.');
