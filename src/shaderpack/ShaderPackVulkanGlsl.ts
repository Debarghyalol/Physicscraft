/**
 * WebGL2-flavoured GLSL (as produced by GlslTranslator) -> Vulkan-flavoured GLSL 450.
 *
 * glslang can only emit SPIR-V from "GLSL for Vulkan", which differs from what WebGL2 accepts:
 *  - `#version 450` (ES shaders need 310+ for SPIR-V, and desktop 450 is what packs expect anyway)
 *  - every user `in` / `out` needs an explicit `layout(location = N)`
 *  - loose (non-opaque) uniforms are illegal; they must live in a uniform block
 *  - combined samplers are replaced by a separate texture + shared sampler, because WGSL has no
 *    combined texture/sampler type (naga cannot express `sampler2D`)
 *
 * The pass is purely textual and works on top-level declarations only (brace/paren depth 0), so
 * function parameters such as `out vec3 x` are untouched.
 */

export type VulkanStage = 'vertex' | 'fragment';

export interface VulkanGlslOptions {
  stage: VulkanStage;
  /**
   * Program-wide varying -> location table. Vertex outputs and fragment inputs of the same
   * program must agree, so the caller builds it from both stages (see `collectVaryingNames`).
   */
  varyingLocations?: ReadonlyMap<string, number>;
}

export interface TextureBinding {
  name: string;
  /** Vulkan texture type, e.g. `texture2D`, `utexture2D`. */
  type: string;
  shadow: boolean;
  binding: number;
}

export interface UniformMember {
  name: string;
  type: string;
  /** Raw array suffix such as `[4]`, or ''. */
  array: string;
  /** True when a `bool` was stored as `int` in the block. */
  boolAsInt: boolean;
}

export interface VulkanGlslResult {
  source: string;
  /** Bind group 0: binding 0 = uniform block, 1 = filtering sampler, 2 = comparison sampler, 3+ = textures. */
  textures: TextureBinding[];
  uniforms: UniformMember[];
  vertexInputs: Array<{ name: string; location: number }>;
  varyings: Array<{ name: string; location: number }>;
  fragmentOutputs: Array<{ name: string; location: number }>;
  warnings: string[];
}

export const UNIFORM_BLOCK_BINDING = 0;
export const SAMPLER_BINDING = 1;
export const COMPARISON_SAMPLER_BINDING = 2;
export const FIRST_TEXTURE_BINDING = 3;

const SAMPLER_TYPES: Record<string, { tex: string; shadow: boolean }> = {
  sampler2D: { tex: 'texture2D', shadow: false },
  isampler2D: { tex: 'itexture2D', shadow: false },
  usampler2D: { tex: 'utexture2D', shadow: false },
  sampler3D: { tex: 'texture3D', shadow: false },
  isampler3D: { tex: 'itexture3D', shadow: false },
  usampler3D: { tex: 'utexture3D', shadow: false },
  samplerCube: { tex: 'textureCube', shadow: false },
  sampler2DArray: { tex: 'texture2DArray', shadow: false },
  sampler2DShadow: { tex: 'texture2D', shadow: true },
  sampler2DArrayShadow: { tex: 'texture2DArray', shadow: true },
  samplerCubeShadow: { tex: 'textureCube', shadow: true },
};

/** Replace comments with spaces (keeping newlines) so line scanning is not fooled by them. */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      i += 2;
      out += ' ';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

interface Decl {
  lineIndex: number;
  layout: string;
  qualifiers: string[];
  storage: 'uniform' | 'in' | 'out';
  type: string;
  /** Declarators with array suffix, initializer removed, e.g. `foo[4]`. */
  names: Array<{ name: string; array: string }>;
}

const DECL_RE =
  /^\s*(?:layout\s*\(([^)]*)\)\s*)?((?:(?:flat|smooth|centroid|noperspective|highp|mediump|lowp|const|invariant)\s+)*)(uniform|in|out)\s+((?:(?:highp|mediump|lowp)\s+)?[A-Za-z_]\w*)\s+(.+?)\s*;\s*$/;

function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === sep && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts;
}

function parseDeclarators(list: string): Array<{ name: string; array: string }> {
  return splitTopLevel(list, ',').map((raw) => {
    const noInit = splitTopLevel(raw, '=')[0].trim();
    const m = /^([A-Za-z_]\w*)\s*((?:\[[^\]]*\]\s*)*)$/.exec(noInit);
    if (!m) throw new Error(`unparseable declarator: ${raw.trim()}`);
    return { name: m[1], array: m[2].replace(/\s+/g, '') };
  });
}

/** Find top-level `in`/`out`/`uniform` declarations. */
function findDecls(lines: string[], clean: string[]): Decl[] {
  const decls: Decl[] = [];
  let brace = 0;
  let paren = 0;
  for (let li = 0; li < clean.length; li++) {
    const line = clean[li];
    if (brace === 0 && paren === 0 && !line.trimStart().startsWith('#')) {
      const m = DECL_RE.exec(line);
      if (m) {
        decls.push({
          lineIndex: li,
          layout: m[1] ?? '',
          qualifiers: m[2].split(/\s+/).filter(Boolean),
          storage: m[3] as Decl['storage'],
          type: m[4].trim().replace(/^(?:highp|mediump|lowp)\s+/, ''),
          names: parseDeclarators(m[5]),
        });
      }
    }
    for (const ch of line) {
      if (ch === '{') brace++;
      else if (ch === '}') brace--;
      else if (ch === '(') paren++;
      else if (ch === ')') paren--;
    }
  }
  void lines;
  return decls;
}

/** Number of location slots a GLSL type (with optional array suffix) occupies. */
export function locationSlots(type: string, array: string): number {
  let slots = 1;
  const m = /^[a-z]*mat(\d)(?:x\d)?$/.exec(type);
  if (m) slots = parseInt(m[1], 10);
  for (const dim of array.matchAll(/\[\s*(\d+)\s*\]/g)) slots *= parseInt(dim[1], 10);
  return slots;
}

export interface VaryingInfo {
  name: string;
  slots: number;
}

/** User varyings declared by a stage (vertex `out` / fragment `in`). */
export function collectVaryings(source: string, stage: VulkanStage): VaryingInfo[] {
  const lines = source.split('\n');
  const clean = stripComments(source).split('\n');
  const want = stage === 'vertex' ? 'out' : 'in';
  const out: VaryingInfo[] = [];
  for (const d of findDecls(lines, clean)) {
    if (d.storage === want) for (const n of d.names) out.push({ name: n.name, slots: locationSlots(d.type, n.array) });
  }
  return out;
}

/** Deterministic program-wide varying table (sorted union, honouring multi-slot types). */
export function buildVaryingLocations(...lists: VaryingInfo[][]): Map<string, number> {
  const slots = new Map<string, number>();
  for (const v of lists.flat()) slots.set(v.name, Math.max(slots.get(v.name) ?? 1, v.slots));
  const table = new Map<string, number>();
  let next = 0;
  for (const name of [...slots.keys()].sort()) {
    table.set(name, next);
    next += slots.get(name)!;
  }
  return table;
}

/** Stable vertex attribute locations so one vertex layout serves every program. */
const FIXED_ATTRIBUTES: Record<string, number> = {
  iris_Vertex: 0,
  iris_Normal: 1,
  iris_MultiTexCoord0: 2,
  iris_MultiTexCoord1: 3,
  iris_Color: 4,
  mc_Entity: 5,
  mc_midTexCoord: 6,
  at_tangent: 7,
  at_midBlock: 8,
};
const FIRST_DYNAMIC_ATTRIBUTE = 9;

function replaceWord(src: string, word: string, replacement: string): string {
  return src.replace(new RegExp(`\\b${word}\\b`, 'g'), replacement);
}

/** Matrix and array varyings -> one vector varying per column / element. */
function lowerVarying(type: string, array: string): { elementType: string; elements: string[] } | null {
  const mat = /^([a-z]*)mat(\d)(?:x(\d))?$/.exec(type);
  const dims = [...array.matchAll(/\[\s*(\d+)\s*\]/g)].map((m) => parseInt(m[1], 10));
  if (!mat && !dims.length) return null;
  if (mat && dims.length) throw new Error(`array of matrices as varying not supported: ${type}${array}`);
  if (dims.length > 1) throw new Error(`multi-dimensional varying arrays not supported: ${type}${array}`);
  if (mat) {
    const cols = parseInt(mat[2], 10);
    const rows = parseInt(mat[3] ?? mat[2], 10);
    return {
      elementType: `${mat[1] === 'd' ? 'd' : ''}vec${rows}`,
      elements: Array.from({ length: cols }, (_v, c) => `[${c}]`),
    };
  }
  return { elementType: type, elements: Array.from({ length: dims[0] }, (_v, i) => `[${i}]`) };
}

/** Split `a, b(c, d), e` at top-level commas (also used for call arguments). */
function splitArgs(s: string): string[] {
  return splitTopLevel(s, ',');
}

const QUAL_RE = /^(in|const|highp|mediump|lowp)$/;

interface SamplerFunc {
  positions: number[];
}

/**
 * glslang refuses `f(sampler2D(tex, smp))` for user functions, so functions taking sampler
 * parameters get `(texture2D p_tex, sampler p_smp)` pairs instead, and call sites pass the
 * pair. Inside the body the parameter name is a macro for the constructor expression.
 */
function rewriteSamplerFunctions(
  lines: string[],
  samplerUniforms: Map<string, { shadow: boolean }>,
  warnings: string[],
): string[] {
  const headerRe = /^(\s*)((?:(?:highp|mediump|lowp|const)\s+)*[A-Za-z_]\w*\s+)([A-Za-z_]\w*)\s*\(([^()]*)\)\s*(\{.*|;)?\s*$/;
  const funcs = new Map<string, SamplerFunc>();
  const paramSamplers = new Map<string, { shadow: boolean }>();
  const lineStart = lines.findIndex((l) => l.trim() === '#line 1');
  const clean = stripComments(lines.join('\n')).split('\n');

  const out: string[] = [];
  let brace = 0;
  let pendingEnd: { names: string[]; depth: number } | null = null;
  let extraLines = false;
  for (let i = 0; i < lines.length; i++) {
    const cl = clean[i];
    let line = lines[i];
    const m = brace === 0 && !cl.trimStart().startsWith('#') ? headerRe.exec(cl) : null;
    if (m) {
      const params = splitArgs(m[4]).map((p) => p.trim());
      const positions: number[] = [];
      const newParams: string[] = [];
      const names: Array<{ name: string; type: string }> = [];
      params.forEach((p, idx) => {
        const toks = p.split(/\s+/).filter((t) => !QUAL_RE.test(t));
        const type = toks[0];
        const name = toks[1];
        if (toks.length === 2 && SAMPLER_TYPES[type]) {
          const st = SAMPLER_TYPES[type];
          positions.push(idx);
          newParams.push(`${st.tex} ${name}_tex`, `${st.shadow ? 'samplerShadow' : 'sampler'} ${name}_smp`);
          names.push({ name, type });
          paramSamplers.set(name, { shadow: st.shadow });
        } else newParams.push(p);
      });
      if (positions.length) {
        const existing = funcs.get(m[3]);
        funcs.set(m[3], { positions: [...new Set([...(existing?.positions ?? []), ...positions])] });
        const rest = m[5] ?? '';
        const header = `${m[1]}${m[2]}${m[3]}(${newParams.join(', ')}) ${rest}`;
        const isDef = rest.startsWith('{');
        if (isDef) {
          const defs = names.map((n) => {
            const st = SAMPLER_TYPES[n.type];
            return `#define ${n.name} ${n.type}(${n.name}_tex, ${n.name}_${st.shadow ? 'smp' : 'smp'})`;
          });
          out.push(...defs);
          extraLines = true;
          line = header;
          pendingEnd = { names: names.map((n) => n.name), depth: 0 };
        } else {
          line = header;
        }
        // Count braces of the (possibly one-line) header with the *original* text.
        for (const ch of cl) {
          if (ch === '{') brace++;
          else if (ch === '}') brace--;
        }
        out.push(line);
        if (pendingEnd && brace === 0) {
          out.push(...pendingEnd.names.map((n) => `#undef ${n}`));
          pendingEnd = null;
        }
        if (extraLines && lineStart >= 0) out.push(`#line ${i + 2 - lineStart}`), (extraLines = false);
        continue;
      }
    }
    for (const ch of cl) {
      if (ch === '{') brace++;
      else if (ch === '}') brace--;
    }
    out.push(line);
    if (pendingEnd && brace === 0) {
      out.push(...pendingEnd.names.map((n) => `#undef ${n}`));
      pendingEnd = null;
      extraLines = true;
    }
    if (extraLines && lineStart >= 0 && !pendingEnd) {
      out.push(`#line ${i + 2 - lineStart}`);
      extraLines = false;
    }
  }

  if (!funcs.size) return out;

  // Call sites.
  let text = out.join('\n');
  const pairFor = (ident: string): string | null => {
    const u = samplerUniforms.get(ident);
    if (u) return `${ident}_tex, ${u.shadow ? 'iris_cmp_sampler' : 'iris_sampler'}`;
    if (paramSamplers.has(ident)) return `${ident}_tex, ${ident}_smp`;
    return null;
  };
  for (const [fname, f] of funcs) {
    const re = new RegExp(`\\b${fname}\\s*\\(`, 'g');
    let result = '';
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const open = m.index + m[0].length;
      let depth = 1;
      let j = open;
      while (j < text.length && depth > 0) {
        if (text[j] === '(') depth++;
        else if (text[j] === ')') depth--;
        j++;
      }
      const inner = text.slice(open, j - 1);
      const args = splitArgs(inner);
      if (/^\s*(i|u)?texture\w*\s/.test(args[0] ?? '')) continue; // already a rewritten header
      for (const pos of f.positions) {
        const a = args[pos]?.trim();
        const pair = a ? pairFor(a) : null;
        if (pair) args[pos] = ` ${pair}`;
        else warnings.push(`cannot pass sampler argument ${pos} of ${fname}(): ${a}`);
      }
      result += text.slice(last, open) + args.join(',');
      last = j - 1;
      re.lastIndex = j;
    }
    text = result + text.slice(last);
  }
  return text.split('\n');
}

export function toVulkanGlsl(translatedIn: string, opts: VulkanGlslOptions): VulkanGlslResult {
  const warnings: string[] = [];
  // GLSL 450 has textureGather / bitfield* natively; drop the WebGL2 polyfills. Replace each
  // block by blank lines so line numbers stay stable.
  const translated = translatedIn
    .replace(/\/\/ @iris-polyfill-begin[\s\S]*?\/\/ @iris-polyfill-end/g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/\biris_textureGather\(/g, 'textureGather(')
    .replace(/\biris_bitfield(Insert|Extract)\(/g, 'bitfield$1(');
  const isVertex = opts.stage === 'vertex';
  const lines = translated.split('\n');
  const clean = stripComments(translated).split('\n');
  const decls = findDecls(lines, clean);

  const textures: TextureBinding[] = [];
  const uniforms: UniformMember[] = [];
  const vertexInputs: VulkanGlslResult['vertexInputs'] = [];
  const varyings: VulkanGlslResult['varyings'] = [];
  const fragmentOutputs: VulkanGlslResult['fragmentOutputs'] = [];
  const macros: string[] = [];
  const loweredVaryings: Array<{ storage: 'in' | 'out'; target: string; var: string }> = [];

  const replacementByLine = new Map<number, string>();
  let uniformBlockLine = -1;
  let nextOutput = 0;
  let nextVarying = 0;
  if (opts.varyingLocations) for (const v of opts.varyingLocations.values()) nextVarying = Math.max(nextVarying, v + 16);
  let nextDynamicAttr = FIRST_DYNAMIC_ATTRIBUTE;
  let usesSampler = false;
  let usesComparison = false;

  for (const d of decls) {
    const quals = d.qualifiers.filter((q) => !/^(highp|mediump|lowp)$/.test(q));
    const interp = quals.filter((q) => /^(flat|smooth|centroid|noperspective)$/.test(q)).join(' ');
    // `flat` is mandatory for integer varyings in Vulkan GLSL.
    const needsFlat = /^(u?int|[iu]vec[234])$/.test(d.type) && !/flat/.test(interp);
    const interpOut = needsFlat ? `flat ${interp}`.trim() : interp;

    if (d.storage === 'uniform') {
      const sampler = SAMPLER_TYPES[d.type];
      if (sampler) {
        const out: string[] = [];
        for (const n of d.names) {
          if (n.array) {
            warnings.push(`sampler array not supported: ${n.name}${n.array}`);
            out.push(`/* unsupported sampler array ${n.name} */`);
            continue;
          }
          const binding = FIRST_TEXTURE_BINDING + textures.length;
          textures.push({ name: n.name, type: sampler.tex, shadow: sampler.shadow, binding });
          out.push(`layout(set = 0, binding = ${binding}) uniform ${sampler.tex} ${n.name}_tex;`);
          if (sampler.shadow) usesComparison = true;
          else usesSampler = true;
          const sampName = sampler.shadow ? 'iris_cmp_sampler' : 'iris_sampler';
          macros.push(`#define ${n.name} ${d.type}(${n.name}_tex, ${sampName})`);
        }
        replacementByLine.set(d.lineIndex, out.join(' '));
      } else {
        for (const n of d.names) {
          if (d.type === 'bool') {
            uniforms.push({ name: n.name, type: 'int', array: n.array, boolAsInt: true });
            macros.push(`#define ${n.name} (iris_ub_${n.name} != 0)`);
          } else {
            uniforms.push({ name: n.name, type: d.type, array: n.array, boolAsInt: false });
          }
        }
        if (uniformBlockLine < 0) uniformBlockLine = d.lineIndex;
        replacementByLine.set(d.lineIndex, '');
      }
      continue;
    }

    // in / out
    const out: string[] = [];
    const isVertexInput = isVertex && d.storage === 'in';
    const isFragOutput = !isVertex && d.storage === 'out';
    for (const n of d.names) {
      let loc: number;
      const existing = /location\s*=\s*(\d+)/.exec(d.layout);
      if (isVertexInput) {
        loc = existing ? parseInt(existing[1], 10) : FIXED_ATTRIBUTES[n.name] ?? nextDynamicAttr;
        if (!existing && FIXED_ATTRIBUTES[n.name] === undefined) nextDynamicAttr += locationSlots(d.type, n.array);
        vertexInputs.push({ name: n.name, location: loc });
      } else if (isFragOutput) {
        loc = existing ? parseInt(existing[1], 10) : nextOutput;
        nextOutput = loc + locationSlots(d.type, n.array);
        fragmentOutputs.push({ name: n.name, location: loc });
      } else {
        const known = opts.varyingLocations?.get(n.name);
        loc = known ?? nextVarying;
        if (known === undefined) nextVarying += locationSlots(d.type, n.array);
        varyings.push({ name: n.name, location: loc });
      }
      const q = [interpOut].filter(Boolean).join(' ');
      const lowered = isVertexInput || isFragOutput ? null : lowerVarying(d.type, n.array);
      if (lowered) {
        // WGSL only allows scalar/vector user IO: keep the variable private and copy elements.
        out.push(`${d.type} ${n.name}${n.array};`);
        lowered.elements.forEach((el, k) => {
          const v = `iris_v_${n.name}_${k}`;
          out.push(`layout(location = ${loc + k}) ${q ? q + ' ' : ''}${d.storage} ${lowered.elementType} ${v};`);
          loweredVaryings.push({ storage: d.storage as 'in' | 'out', target: `${n.name}${el}`, var: v });
        });
      } else {
        out.push(`layout(location = ${loc}) ${q ? q + ' ' : ''}${d.storage} ${d.type} ${n.name}${n.array};`);
      }
    }
    replacementByLine.set(d.lineIndex, out.join(' '));
  }

  // Uniform block (declared at the first loose uniform).
  let blockText = '';
  if (uniforms.length) {
    const members = uniforms.map((u) => {
      const nm = u.boolAsInt ? `iris_ub_${u.name}` : u.name;
      return `  ${u.type} ${nm}${u.array};`;
    });
    blockText = `layout(std140, set = 0, binding = ${UNIFORM_BLOCK_BINDING}) uniform IrisUniforms { ${members.join(" ")} };`;
  }

  // Rebuild, replacing declaration lines (using the original lines to keep their #line numbering).
  const outLines = lines.map((line, i) => {
    if (!replacementByLine.has(i)) return line;
    if (i === uniformBlockLine) return `${blockText}${replacementByLine.get(i)}`;
    return replacementByLine.get(i)!;
  });

  const samplerMap = new Map(textures.map((t) => [t.name, { shadow: t.shadow }]));
  // `sampler` is a keyword in Vulkan GLSL but a common parameter name in packs.
  const renamed = outLines.map((l) => (/\bsampler\b/.test(l) ? replaceWord(l, 'sampler', 'iris_smp') : l));
  let body = rewriteSamplerFunctions(renamed, samplerMap, warnings).join('\n');

  // Strip the ES header: #version, precision statements.
  body = body.replace(/^[ \t]*#version[^\n]*$/m, '');
  body = body.replace(/^[ \t]*precision[ \t]+\w+[ \t]+\w+[ \t]*;[ \t]*$/gm, '');

  // Vulkan renames.
  body = replaceWord(body, 'gl_VertexID', 'gl_VertexIndex');
  body = replaceWord(body, 'gl_InstanceID', 'gl_InstanceIndex');

  // Legacy fragment outputs.
  const extraDecls: string[] = [];
  if (!isVertex) {
    if (/\bgl_FragColor\b/.test(body)) {
      body = replaceWord(body, 'gl_FragColor', 'iris_FragColor');
      extraDecls.push('layout(location = 0) out vec4 iris_FragColor;');
      fragmentOutputs.push({ name: 'iris_FragColor', location: 0 });
    }
    const fragData = new Set<number>();
    body = body.replace(/\bgl_FragData\s*\[\s*(\d+)\s*\]/g, (_m, n: string) => {
      fragData.add(parseInt(n, 10));
      return `iris_FragData${n}`;
    });
    for (const n of [...fragData].sort((a, b) => a - b)) {
      extraDecls.push(`layout(location = ${n}) out vec4 iris_FragData${n};`);
      fragmentOutputs.push({ name: `iris_FragData${n}`, location: n });
    }
  }

  if (loweredVaryings.length) {
    if (!/\bvoid\s+main\s*\(\s*(?:void)?\s*\)/.test(body)) throw new Error('no main() found to wrap');
    body = body.replace(/\bvoid\s+main\s*\(\s*(?:void)?\s*\)/, 'void iris_user_main()');
    const pre = loweredVaryings.filter((v) => v.storage === 'in').map((v) => `  ${v.target} = ${v.var};`);
    const post = loweredVaryings.filter((v) => v.storage === 'out').map((v) => `  ${v.var} = ${v.target};`);
    body += `\nvoid main() {\n${pre.join('\n')}\n  iris_user_main();\n${post.join('\n')}\n}\n`;
  }

  const prelude: string[] = ['#version 450'];
  if (usesSampler) prelude.push(`layout(set = 0, binding = ${SAMPLER_BINDING}) uniform sampler iris_sampler;`);
  if (usesComparison) {
    prelude.push(`layout(set = 0, binding = ${COMPARISON_SAMPLER_BINDING}) uniform samplerShadow iris_cmp_sampler;`);
  }
  prelude.push(...extraDecls, ...macros);

  // `#line 1` in the translator output anchors line numbers to the pack source; keep it
  // after our prelude so errors still point at pack lines.
  const lineIdx = body.search(/^#line 1$/m);
  if (lineIdx >= 0) {
    body = `${body.slice(0, lineIdx)}${prelude.slice(1).join('\n')}\n${body.slice(lineIdx)}`;
    body = `#version 450\n${body}`;
  } else {
    body = `${prelude.join('\n')}\n${body}`;
  }

  return { source: body, textures, uniforms, vertexInputs, varyings, fragmentOutputs, warnings };
}
