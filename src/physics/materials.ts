import * as THREE from 'three';
import { BlockMaterial, MaterialProperties, VisualTheme } from '../types/physics';

export const MATERIAL_CONFIGS: Record<BlockMaterial, MaterialProperties> = {
  wood: {
    name: 'Pine Wood',
    density: 650,
    friction: 0.55,
    restitution: 0.18,
    color: '#d4a373',
    roughness: 0.75,
    metalness: 0.05,
    description: 'Natural pine blocks with balanced weight and tactile friction',
  },
  stone: {
    name: 'Granite Stone',
    density: 2500,
    friction: 0.85,
    restitution: 0.05,
    color: '#94a3b8',
    roughness: 0.9,
    metalness: 0.1,
    description: 'Heavy architectural stone blocks with maximum stability',
  },
  rubber: {
    name: 'Super Bouncy Rubber',
    density: 950,
    friction: 0.65,
    restitution: 0.92,
    color: '#ec4899',
    roughness: 0.35,
    metalness: 0.0,
    description: 'High elastic restitution that ricochets and bounces wildly',
  },
  ice: {
    name: 'Glacier Ice',
    density: 917,
    friction: 0.02,
    restitution: 0.12,
    color: '#38bdf8',
    roughness: 0.1,
    metalness: 0.15,
    description: 'Ultra-low friction glass-like ice that slides freely across surfaces',
  },
  metal: {
    name: 'Brushed Steel',
    density: 7800,
    friction: 0.45,
    restitution: 0.25,
    color: '#cbd5e1',
    roughness: 0.25,
    metalness: 0.85,
    description: 'Dense metallic blocks with high inertia and chrome reflections',
  },
  tnt: {
    name: 'TNT Explosive',
    density: 1650,
    friction: 0.6,
    restitution: 0.15,
    color: '#ef4444',
    roughness: 0.65,
    metalness: 0.1,
    description: 'Detonates on high-impact collisions or manual trigger, blasting adjacent blocks',
  },
};

/**
 * Procedural canvas textures
 */
function createWoodTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#c59560';
  ctx.fillRect(0, 0, 512, 512);

  // Wood grain bands
  ctx.fillStyle = 'rgba(120, 75, 30, 0.14)';
  for (let y = 0; y < 512; y += 4) {
    const jitter = Math.sin(y * 0.05) * 12 + Math.cos(y * 0.02) * 8;
    ctx.fillRect(0, y + jitter, 512, 2.5);
  }

  // Subtle border bevel
  ctx.strokeStyle = 'rgba(70, 40, 15, 0.35)';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 504, 504);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function createStoneTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#64748b';
  ctx.fillRect(0, 0, 512, 512);

  // Speckles / noise
  for (let i = 0; i < 6000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const s = Math.random() * 2.5;
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255, 255, 255, 0.18)' : 'rgba(15, 23, 42, 0.25)';
    ctx.fillRect(x, y, s, s);
  }

  ctx.strokeStyle = 'rgba(30, 41, 59, 0.5)';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 504, 504);

  return new THREE.CanvasTexture(canvas);
}

function createTNTTexture(theme: VisualTheme = 'realistic'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const isCandy = theme === 'candy';
  const isNeon = theme === 'neon';
  const isCeramic = theme === 'ceramic';

  // Body color
  ctx.fillStyle = isCandy ? '#f43f5e' : isNeon ? '#0f172a' : isCeramic ? '#c2410c' : '#dc2626';
  ctx.fillRect(0, 0, 512, 512);

  // Warning stripe
  ctx.fillStyle = isCandy ? '#fef08a' : isNeon ? '#38bdf8' : isCeramic ? '#ffedd5' : '#fef08a';
  ctx.fillRect(0, 180, 512, 152);

  // Black TNT text
  ctx.fillStyle = isNeon ? '#0284c7' : '#0f172a';
  ctx.font = 'bold 96px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TNT', 256, 256);

  ctx.strokeStyle = isNeon ? '#38bdf8' : 'rgba(0, 0, 0, 0.6)';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 502, 502);

  return new THREE.CanvasTexture(canvas);
}

// Material cache: key is `${materialType}_${theme}`
const materialCache: Map<string, THREE.Material> = new Map();

export function getThreeMaterial(materialType: BlockMaterial, theme: VisualTheme = 'realistic'): THREE.Material {
  const cacheKey = `${materialType}_${theme}`;
  if (materialCache.has(cacheKey)) {
    return materialCache.get(cacheKey)!;
  }

  const config = MATERIAL_CONFIGS[materialType];
  let mat: THREE.Material;

  if (theme === 'candy') {
    // Candy & Gummy theme: bright pastel colors, squishy high shine
    const candyColors: Record<BlockMaterial, string> = {
      wood: '#fed7aa',      // Marshmallow butterscotch
      stone: '#c4b5fd',     // Taro purple
      rubber: '#f472b6',    // Bubblegum pink
      ice: '#a5f3fc',       // Blue raspberry ice
      metal: '#fef08a',     // Lemon drop gold
      tnt: '#fb7185',       // Cherry blast
    };
    mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(candyColors[materialType]),
      roughness: 0.15,
      metalness: 0.05,
      transmission: materialType === 'ice' ? 0.75 : 0.25,
      clearcoat: 0.9,
      clearcoatRoughness: 0.1,
    });
  } else if (theme === 'ceramic') {
    // Minimalist Ceramic Studio: matte porcelain & glazed earth tones
    const ceramicColors: Record<BlockMaterial, string> = {
      wood: '#e2e8f0',      // Matte white porcelain
      stone: '#ea580c',     // Terracotta clay
      rubber: '#0284c7',    // Glazed cobalt blue
      ice: '#e0f2fe',       // Frosted milk glass
      metal: '#d97706',     // Raw brass
      tnt: '#b91c1c',       // Crimson glaze
    };
    mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(ceramicColors[materialType]),
      roughness: 0.82,
      metalness: 0.05,
    });
  } else if (theme === 'neon') {
    // Neon Cyber: deep obsidian bodies with glowing emissive outlines
    const neonColors: Record<BlockMaterial, { color: string; emissive: string }> = {
      wood: { color: '#0f172a', emissive: '#059669' },     // Emerald outline
      stone: { color: '#0f172a', emissive: '#0284c7' },    // Cyan outline
      rubber: { color: '#0f172a', emissive: '#db2777' },   // Hot pink outline
      ice: { color: '#0284c7', emissive: '#38bdf8' },      // Electric blue
      metal: { color: '#334155', emissive: '#f59e0b' },    // Amber
      tnt: { color: '#450a0a', emissive: '#ef4444' },      // Crimson laser
    };
    const c = neonColors[materialType];
    mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(c.color),
      emissive: new THREE.Color(c.emissive),
      emissiveIntensity: 0.45,
      roughness: 0.3,
      metalness: 0.7,
    });
  } else {
    // Realistic Construction (Default)
    if (materialType === 'wood') {
      mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(config.color),
        map: createWoodTexture(),
        roughness: config.roughness,
        metalness: config.metalness,
      });
    } else if (materialType === 'stone') {
      mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(config.color),
        map: createStoneTexture(),
        roughness: config.roughness,
        metalness: config.metalness,
      });
    } else if (materialType === 'tnt') {
      mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(config.color),
        map: createTNTTexture('realistic'),
        roughness: config.roughness,
        metalness: config.metalness,
      });
    } else if (materialType === 'rubber') {
      mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(config.color),
        roughness: config.roughness,
        metalness: config.metalness,
      });
    } else if (materialType === 'ice') {
      mat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(config.color),
        roughness: 0.1,
        metalness: 0.15,
        transmission: 0.65,
        ior: 1.31,
        transparent: true,
        opacity: 0.88,
      });
    } else {
      // Metal
      mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(config.color),
        roughness: config.roughness,
        metalness: config.metalness,
      });
    }
  }

  materialCache.set(cacheKey, mat);
  return mat;
}
