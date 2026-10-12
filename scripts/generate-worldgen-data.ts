#!/usr/bin/env node
/** Generate data.generated.ts from a decompiler ZIP: npx tsx scripts/generate-worldgen-data.ts client.jar_Decompiler.com.zip */
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
const input=process.argv[2];
if(!input){console.error('Usage: npx tsx scripts/generate-worldgen-data.ts <minecraft-decompiler.zip>');process.exit(2);}
const zip=await JSZip.loadAsync(fs.readFileSync(input)),density:Record<string,unknown>={},noise:Record<string,unknown>={};
for(const [name,entry] of Object.entries(zip.files)){
 if(entry.dir)continue;
 const dp='data/minecraft/worldgen/density_function/',np='data/minecraft/worldgen/noise/';
 if(name.startsWith(dp)&&name.endsWith('.json'))density[name.slice(dp.length,-5)]=JSON.parse(await entry.async('string'));
 if(name.startsWith(np)&&name.endsWith('.json'))noise[name.slice(np.length,-5)]=JSON.parse(await entry.async('string'));
}
if(!density['overworld/final_density'])throw new Error('This ZIP does not contain overworld/final_density.json');
fs.mkdirSync(path.dirname('src/worldgen/data.generated.ts'),{recursive:true});
fs.writeFileSync('src/worldgen/data.generated.ts','// Generated from Minecraft worldgen JSON. Do not hand-edit.\nexport const DENSITY_JSON: Record<string, any> = '+JSON.stringify(density)+';\nexport const NOISE_SETTINGS: Record<string, any> = '+JSON.stringify(noise)+';\n');
console.log('Generated '+Object.keys(density).length+' density functions and '+Object.keys(noise).length+' noise settings.');
