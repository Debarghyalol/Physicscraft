import * as THREE from 'three';
import { PackFiles, ShaderStage, translateProgram } from './GlslTranslator';
import { shaderPacks } from './ShaderPackManager';

export interface ShaderPassDefinition {
  name: string;
  vertexEntry: string;
  fragmentEntry: string;
  vertexSource: string;
  fragmentSource: string;
  drawBuffers: number[] | null;
  vertexBuiltins: string[];
  fragmentBuiltins: string[];
  warnings: string[];
}

export interface ShaderRuntimeOptions {
  debug?: boolean;
}

/**
 * Runtime program catalog for an imported OptiFine/Iris shader pack.
 *
 * This is deliberately separate from the existing vanilla Three.js renderer:
 * this first stage only turns the translated shader sources into persistent WebGL
 * programs and records the metadata needed by later framebuffer/pass stages.
 */
export class ShaderPackRuntime {
  private gl: WebGL2RenderingContext;
  private programs = new Map<string, WebGLProgram>();
  private definitions = new Map<string, ShaderPassDefinition>();
  private debug: boolean;
  private packId: string | null = null;
  private dimension: string | null = null;

  constructor(renderer: THREE.WebGLRenderer, options: ShaderRuntimeOptions = {}) {
    this.gl = renderer.getContext();
    this.debug = !!options.debug;
  }

  public get isLoaded(): boolean {
    return this.packId !== null && this.dimension !== null;
  }

  public getProgramNames(): string[] {
    return [...this.definitions.keys()].sort();
  }

  public getDefinition(name: string): ShaderPassDefinition | undefined {
    return this.definitions.get(name);
  }

  public getProgram(name: string): WebGLProgram | undefined {
    return this.programs.get(name);
  }

  /**
   * Load one shader-pack dimension and create persistent WebGL programs.
   *
   * Only paired .vsh/.fsh programs are executable. Files are discovered from
   * the actual pack rather than from a hard-coded list.
   */
  public async load(packId: string, dimension: string): Promise<void> {
    this.dispose();

    const { files } = await shaderPacks.loadFiles(packId);
    const entries = this.discoverPrograms(files, dimension);

    this.log(`Loading ${packId} / ${dimension}: ${entries.size} programs`);

    for (const [name, entry] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
      const vertex = translateProgram({
        files,
        entry: entry.vsh!,
        stage: 'vertex',
      });
      const fragment = translateProgram({
        files,
        entry: entry.fsh!,
        stage: 'fragment',
      });

      const program = this.createProgram(name, vertex.source, fragment.source);
      const drawBuffers = fragment.drawBuffers ?? vertex.drawBuffers;

      this.definitions.set(name, {
        name,
        vertexEntry: entry.vsh!,
        fragmentEntry: entry.fsh!,
        vertexSource: vertex.source,
        fragmentSource: fragment.source,
        drawBuffers,
        vertexBuiltins: vertex.usedBuiltins,
        fragmentBuiltins: fragment.usedBuiltins,
        warnings: [...vertex.warnings, ...fragment.warnings],
      });
      this.programs.set(name, program);

      if (this.debug) {
        this.log(
          `PASS ${name}: program=${program} outputs=${drawBuffers?.join(',') ?? 'default'}`
        );
      }
    }

    this.packId = packId;
    this.dimension = dimension;
    this.log(`Loaded ${this.getProgramNames().length} executable programs`);
  }

  private discoverPrograms(
    files: PackFiles,
    dimension: string
  ): Map<string, { vsh?: string; fsh?: string }> {
    const result = new Map<string, { vsh?: string; fsh?: string }>();
    const prefix = `${dimension}/`;

    for (const path of files.keys()) {
      if (!path.startsWith(prefix)) continue;
      const match = /^([^/]+)\.(vsh|fsh)$/.exec(path.slice(prefix.length));
      if (!match) continue;

      const name = match[1];
      const current = result.get(name) ?? {};
      current[match[2] as 'vsh' | 'fsh'] = path;
      result.set(name, current);
    }

    // An executable pass needs both stages. Keep discovery deterministic and
    // leave unsupported/partial programs out of the runtime catalog.
    for (const [name, entry] of [...result]) {
      if (!entry.vsh || !entry.fsh) result.delete(name);
    }

    return result;
  }

  private createProgram(name: string, vertexSource: string, fragmentSource: string): WebGLProgram {
    const gl = this.gl;

    const vertex = gl.createShader(gl.VERTEX_SHADER);
    const fragment = gl.createShader(gl.FRAGMENT_SHADER);
    if (!vertex || !fragment) throw new Error(`[${name}] unable to allocate shader objects`);

    try {
      gl.shaderSource(vertex, vertexSource);
      gl.compileShader(vertex);
      this.assertShaderCompiled(name, 'vertex', vertex);

      gl.shaderSource(fragment, fragmentSource);
      gl.compileShader(fragment);
      this.assertShaderCompiled(name, 'fragment', fragment);

      const program = gl.createProgram();
      if (!program) throw new Error(`[${name}] unable to create WebGL program`);

      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(program) || 'program link failed';
        gl.deleteProgram(program);
        throw new Error(`[${name}] link failed: ${log}`);
      }

      return program;
    } finally {
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    }
  }

  private assertShaderCompiled(name: string, stage: ShaderStage, shader: WebGLShader): void {
    if (this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) return;
    const log = this.gl.getShaderInfoLog(shader) || 'compile failed';
    throw new Error(`[${name}] ${stage} compile failed: ${log}`);
  }

  public dispose(): void {
    for (const program of this.programs.values()) this.gl.deleteProgram(program);
    this.programs.clear();
    this.definitions.clear();
    this.packId = null;
    this.dimension = null;
  }

  private log(message: string): void {
    if (this.debug) console.info(`[ShaderPipeline] ${message}`);
  }
}
