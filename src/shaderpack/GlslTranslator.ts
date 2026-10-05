/**
 * OptiFine / Iris style shader program -> WebGL2 (GLSL ES 3.00) translator.
 *
 * Shader packs are written for desktop GLSL (`#version 400 compatibility` and friends):
 * they pull shared code in with `#include`, use the legacy fixed-function built-ins
 * (`gl_Vertex`, `gl_ModelViewMatrix`, ...) and rely on loose desktop typing rules.
 * WebGL2 only accepts GLSL ES 3.00, so every program is rewritten before compiling.
 *
 * This module is generic: it contains no pack code. Packs are loaded at runtime from the
 * user's own imported .zip.
 */

/** Pack files keyed by path relative to the pack's `shaders/` folder, e.g. `lib/head.glsl`. */
export type PackFiles = Map<string, string>;

export type ShaderStage = 'vertex' | 'fragment';

export interface TranslateInput {
  files: PackFiles;
  /** Entry program, e.g. `world0/composite.fsh`. */
  entry: string;
  stage: ShaderStage;
  /** Extra `#define`s (pack option overrides, engine macros). */
  defines?: Record<string, string | number | boolean>;
}

export interface TranslateResult {
  source: string;
  /** Colour attachments listed in a `RENDERTARGETS` / `DRAWBUFFERS` comment, if any. */
  drawBuffers: number[] | null;
  /** Legacy built-ins the program used (so the runtime knows what to feed it). */
  usedBuiltins: string[];
  warnings: string[];
}

/** Macros OptiFine / Iris provide to every program. */
export const ENGINE_DEFINES: Record<string, string | number | boolean> = {
  MC_VERSION: 12100,
  MC_GL_VERSION: 460,
  MC_GLSL_VERSION: 460,
  MC_SHADOW_QUALITY: 1.0,
  MC_RENDER_QUALITY: 1.0,
  MC_HAND_DEPTH: 0.56,
};

import { preprocess } from './glsl/preprocess';
import { coerceProgram } from './glsl/coerce';

const MAX_INCLUDE_DEPTH = 32;
const MAX_EXPANDED_BYTES = 4 * 1024 * 1024;

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function resolveInclude(from: string, target: string): string {
  return target.startsWith('/') ? normalize(target.slice(1)) : normalize(`${dirname(from)}/${target}`);
}

const INCLUDE_RE = /^[ \t]*#[ \t]*include[ \t]+"([^"]+)"[^\n]*$/gm;

/** Textually expand `#include "..."` (like OptiFine/Iris, before any preprocessing). */
export function expandIncludes(files: PackFiles, entry: string, warnings: string[]): string {
  let total = 0;
  const expand = (path: string, depth: number): string => {
    const src = files.get(path);
    if (src === undefined) {
      warnings.push(`missing include: ${path}`);
      return `#error missing include ${path}`;
    }
    if (depth > MAX_INCLUDE_DEPTH) {
      warnings.push(`include depth exceeded at ${path}`);
      return '';
    }
    return src.replace(INCLUDE_RE, (_m, target: string) => {
      const resolved = resolveInclude(path, target);
      const body = expand(resolved, depth + 1);
      total += body.length;
      if (total > MAX_EXPANDED_BYTES) throw new Error('shader include expansion too large');
      return body;
    });
  };
  return expand(entry, 0);
}

/** Legacy built-ins -> engine-provided names (gl_ identifiers are reserved in GLSL ES). */
const BUILTIN_RENAMES: Array<[RegExp, string]> = [
  [/\bgl_ModelViewProjectionMatrixInverse\b/g, 'iris_ModelViewProjectionMatrixInverse'],
  [/\bgl_ModelViewProjectionMatrix\b/g, 'iris_ModelViewProjectionMatrix'],
  [/\bgl_ModelViewMatrixInverse\b/g, 'iris_ModelViewMatrixInverse'],
  [/\bgl_ProjectionMatrixInverse\b/g, 'iris_ProjectionMatrixInverse'],
  [/\bgl_ModelViewMatrix\b/g, 'iris_ModelViewMatrix'],
  [/\bgl_ProjectionMatrix\b/g, 'iris_ProjectionMatrix'],
  [/\bgl_NormalMatrix\b/g, 'iris_NormalMatrix'],
  [/\bgl_TextureMatrix\[\s*0\s*\]/g, 'iris_TextureMatrix0'],
  [/\bgl_TextureMatrix\[\s*1\s*\]/g, 'iris_TextureMatrix1'],
  [/\bgl_Vertex\b/g, 'iris_Vertex'],
  [/\bgl_Normal\b/g, 'iris_Normal'],
  [/\bgl_MultiTexCoord0\b/g, 'iris_MultiTexCoord0'],
  [/\bgl_MultiTexCoord1\b/g, 'iris_MultiTexCoord1'],
  [/\bgl_TexCoord\[\s*0\s*\]/g, 'iris_TexCoord0'],
  [/\bgl_TexCoord\[\s*1\s*\]/g, 'iris_TexCoord1'],
  [/\bgl_FrontColor\b/g, 'iris_FrontColor'],
  [/\bgl_Color\b/g, 'iris_Color'],
  [/\bftransform\s*\(\s*\)/g, 'iris_ftransform()'],
];

const BUILTIN_DECLS: Record<string, { vertex?: string; fragment?: string; both?: string }> = {
  iris_ModelViewProjectionMatrixInverse: { vertex: 'uniform mat4 iris_ModelViewProjectionMatrixInverse;' },
  iris_ModelViewProjectionMatrix: { vertex: 'uniform mat4 iris_ModelViewProjectionMatrix;' },
  iris_ModelViewMatrixInverse: { vertex: 'uniform mat4 iris_ModelViewMatrixInverse;' },
  iris_ProjectionMatrixInverse: { vertex: 'uniform mat4 iris_ProjectionMatrixInverse;' },
  iris_ModelViewMatrix: { vertex: 'uniform mat4 iris_ModelViewMatrix;' },
  iris_ProjectionMatrix: { vertex: 'uniform mat4 iris_ProjectionMatrix;' },
  iris_NormalMatrix: { vertex: 'uniform mat3 iris_NormalMatrix;' },
  iris_TextureMatrix0: { vertex: 'uniform mat4 iris_TextureMatrix0;' },
  iris_TextureMatrix1: { vertex: 'uniform mat4 iris_TextureMatrix1;' },
  iris_Vertex: { vertex: 'in vec4 iris_Vertex;' },
  iris_Normal: { vertex: 'in vec3 iris_Normal;' },
  iris_MultiTexCoord0: { vertex: 'in vec4 iris_MultiTexCoord0;' },
  iris_MultiTexCoord1: { vertex: 'in vec4 iris_MultiTexCoord1;' },
  iris_TexCoord0: { vertex: 'out vec4 iris_TexCoord0;', fragment: 'in vec4 iris_TexCoord0;' },
  iris_TexCoord1: { vertex: 'out vec4 iris_TexCoord1;', fragment: 'in vec4 iris_TexCoord1;' },
  iris_FrontColor: { vertex: 'out vec4 iris_FrontColor;', fragment: 'in vec4 iris_FrontColor;' },
  iris_Color: { vertex: 'in vec4 iris_Color;' },
};

const FTRANSFORM_DECL =
  'vec4 iris_ftransform() { return iris_ProjectionMatrix * (iris_ModelViewMatrix * iris_Vertex); }';

/** `textureGather` is GLSL ES 3.10+, so WebGL2 needs a texelFetch based replacement. */
const TEXTURE_GATHER_POLYFILL = `
vec4 iris_textureGather(sampler2D s, vec2 uv, int comp) {
  ivec2 sz = textureSize(s, 0);
  vec2 t = uv * vec2(sz) - 0.5;
  ivec2 b = ivec2(floor(t));
  ivec2 hi = sz - 1;
  vec4 a = texelFetch(s, clamp(b + ivec2(0, 1), ivec2(0), hi), 0);
  vec4 c = texelFetch(s, clamp(b + ivec2(1, 1), ivec2(0), hi), 0);
  vec4 d = texelFetch(s, clamp(b + ivec2(1, 0), ivec2(0), hi), 0);
  vec4 e = texelFetch(s, clamp(b, ivec2(0), hi), 0);
  return vec4(a[comp], c[comp], d[comp], e[comp]);
}
vec4 iris_textureGather(sampler2D s, vec2 uv) { return iris_textureGather(s, uv, 0); }
vec4 iris_textureGather(sampler2DShadow s, vec2 uv, float refZ) {
  vec2 sz = vec2(textureSize(s, 0));
  vec2 b = floor(uv * sz - 0.5) + 0.5;
  return vec4(
    texture(s, vec3((b + vec2(0.0, 1.0)) / sz, refZ)),
    texture(s, vec3((b + vec2(1.0, 1.0)) / sz, refZ)),
    texture(s, vec3((b + vec2(1.0, 0.0)) / sz, refZ)),
    texture(s, vec3(b / sz, refZ)));
}
`;

/** `bitfieldInsert` / `bitfieldExtract` are desktop GLSL 4.0 only. */
const BITFIELD_POLYFILL = `
uint iris_bitfieldInsert(uint base, uint ins, int off, int bits) {
  uint mask = bits >= 32 ? 0xFFFFFFFFu : ((1u << uint(bits)) - 1u);
  return (base & ~(mask << uint(off))) | ((ins & mask) << uint(off));
}
uint iris_bitfieldExtract(uint v, int off, int bits) {
  uint mask = bits >= 32 ? 0xFFFFFFFFu : ((1u << uint(bits)) - 1u);
  return (v >> uint(off)) & mask;
}
int iris_bitfieldExtract(int v, int off, int bits) {
  uint mask = bits >= 32 ? 0xFFFFFFFFu : ((1u << uint(bits)) - 1u);
  uint r = (uint(v) >> uint(off)) & mask;
  if (bits < 32 && (r & (1u << uint(bits - 1))) != 0u) r |= ~mask;
  return int(r);
}
`;

const ENGINE_SYMBOLS: Record<string, string> = {
  iris_ModelViewProjectionMatrixInverse: 'mat4', iris_ModelViewProjectionMatrix: 'mat4',
  iris_ModelViewMatrixInverse: 'mat4', iris_ProjectionMatrixInverse: 'mat4', iris_ModelViewMatrix: 'mat4',
  iris_ProjectionMatrix: 'mat4', iris_NormalMatrix: 'mat3', iris_TextureMatrix0: 'mat4', iris_TextureMatrix1: 'mat4',
  iris_Vertex: 'vec4', iris_Normal: 'vec3', iris_MultiTexCoord0: 'vec4', iris_MultiTexCoord1: 'vec4',
  iris_TexCoord0: 'vec4', iris_TexCoord1: 'vec4', iris_FrontColor: 'vec4', iris_Color: 'vec4',
};

const PRECISION_HEADER = `precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;
precision highp sampler2DShadow;
precision highp usampler2D;
precision highp isampler2D;
`;

/** Parse `/* RENDERTARGETS: 0,5,7 *\/` (OptiFine) or `/* DRAWBUFFERS:057 *\/`. */
export function parseDrawBuffers(source: string): number[] | null {
  const rt = /\/\*\s*RENDERTARGETS\s*:\s*([0-9,\s]+)\*\//.exec(source);
  if (rt) return rt[1].split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n));
  const db = /\/\*\s*DRAWBUFFERS\s*:\s*([0-9]+)\s*\*\//.exec(source);
  if (db) return db[1].split('').map((c) => parseInt(c, 10));
  return null;
}

/** Translate one program stage into WebGL2 GLSL ES 3.00. */
export function translateProgram(input: TranslateInput): TranslateResult {
  const warnings: string[] = [];
  let src = expandIncludes(input.files, input.entry, warnings);
  const drawBuffers = parseDrawBuffers(src);

  // Preprocess here (macros, conditionals); `#version` / `#extension` are dropped and
  // replaced by our own header.
  src = preprocess(src, { ...ENGINE_DEFINES, ...(input.defines ?? {}) }, warnings);

  // Legacy interface qualifiers.
  const isVertex = input.stage === 'vertex';
  src = src.replace(/^([ \t]*)(flat[ \t]+|centroid[ \t]+|smooth[ \t]+)?varying[ \t]+/gm, (_m, ws, q = '') =>
    `${ws}${q}${isVertex ? 'out' : 'in'} `
  );
  if (isVertex) src = src.replace(/^([ \t]*)attribute[ \t]+/gm, '$1in ');

  // Legacy texture function names.
  src = src
    .replace(/\btexture2DLod\s*\(/g, 'textureLod(')
    .replace(/\btexture2DProj\s*\(/g, 'textureProj(')
    .replace(/\btexture2D\s*\(/g, 'texture(')
    .replace(/\btexture3D\s*\(/g, 'texture(')
    .replace(/\btextureGather\s*\(/g, 'iris_textureGather(')
    .replace(/\bbitfieldInsert\s*\(/g, 'iris_bitfieldInsert(')
    .replace(/\bbitfieldExtract\s*\(/g, 'iris_bitfieldExtract(');

  // Legacy built-ins.
  const used = new Set<string>();
  for (const [re, name] of BUILTIN_RENAMES) {
    if (re.test(src)) {
      used.add(name.replace(/\(\)$/, ''));
      re.lastIndex = 0;
      src = src.replace(re, name);
    }
    re.lastIndex = 0;
  }

  const typed = coerceProgram(src, { symbols: ENGINE_SYMBOLS });
  src = typed.source;
  warnings.push(...typed.warnings);

  const decls: string[] = [];
  for (const name of used) {
    const d = BUILTIN_DECLS[name === 'iris_ftransform' ? 'iris_ModelViewMatrix' : name];
    const text = d ? (isVertex ? d.vertex : d.fragment) : undefined;
    if (text) decls.push(text);
  }
  if (isVertex && used.has('iris_ftransform')) {
    for (const n of ['iris_ProjectionMatrix', 'iris_ModelViewMatrix', 'iris_Vertex']) {
      const t = BUILTIN_DECLS[n].vertex!;
      if (!decls.includes(t)) decls.push(t);
    }
    decls.push(FTRANSFORM_DECL);
  }
  const header = [
    '#version 300 es',
    PRECISION_HEADER,
    src.includes('iris_textureGather(') ? TEXTURE_GATHER_POLYFILL : '',
    src.includes('iris_bitfield') ? BITFIELD_POLYFILL : '',
    decls.join('\n'),
  ].join('\n');

  return { source: `${header}\n#line 1\n${src}`, drawBuffers, usedBuiltins: [...used], warnings };
}
