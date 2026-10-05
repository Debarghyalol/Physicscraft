/**
 * Desktop GLSL -> GLSL ES 3.00 type pass.
 *
 * Desktop GLSL (4.x) silently converts int -> float / uint, allows `float x = 1;`,
 * `vec2 v = ivec2(...)`, `x.x` on scalars, non-constant global initializers and so on.
 * GLSL ES 3.00 allows none of that. This module parses the (already preprocessed) program,
 * infers expression types, inserts the explicit conversions ES needs and re-emits the code.
 *
 * It is deliberately forgiving: when a type cannot be inferred it leaves the code untouched,
 * so unknown constructs fall through to the driver compiler (which then reports them).
 */

// ---------------------------------------------------------------- tokens

type Tok = string;

const PUNCT = [
  '<<=', '>>=', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '<=', '>=', '==', '!=',
  '&&', '||', '^^',
];

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      toks.push(src.slice(i, j));
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < n) {
        const d = src[j];
        if (/[A-Za-z0-9_.]/.test(d)) j++;
        else if ((d === '+' || d === '-') && /[eE]/.test(src[j - 1]) && !/^0[xX]/.test(src.slice(i, j))) j++;
        else break;
      }
      toks.push(src.slice(i, j));
      i = j;
      continue;
    }
    let matched = false;
    for (const p of PUNCT) {
      if (src.startsWith(p, i)) {
        toks.push(p);
        i += p.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    toks.push(c);
    i++;
  }
  return toks;
}

// ---------------------------------------------------------------- types

const SCALARS = new Set(['float', 'int', 'uint', 'bool']);
const VEC_RE = /^([biu]?)vec([234])$/;
const MAT_RE = /^mat([234])(?:x([234]))?$/;
const SAMPLER_RE = /^[iu]?sampler(2D|3D|Cube|2DShadow|2DArray|CubeShadow|2DArrayShadow)$/;
const QUALS = new Set([
  'const', 'in', 'out', 'inout', 'uniform', 'flat', 'smooth', 'centroid', 'highp', 'mediump', 'lowp',
  'precise', 'invariant', 'buffer', 'shared', 'coherent', 'volatile', 'restrict', 'readonly', 'writeonly',
  'attribute', 'varying', 'patch', 'sample',
]);

type Family = 'f' | 'i' | 'u' | 'b' | null;

function split(t: string | null): { fam: Family; dim: number; mat: boolean } | null {
  if (!t) return null;
  if (t === 'float') return { fam: 'f', dim: 1, mat: false };
  if (t === 'int') return { fam: 'i', dim: 1, mat: false };
  if (t === 'uint') return { fam: 'u', dim: 1, mat: false };
  if (t === 'bool') return { fam: 'b', dim: 1, mat: false };
  const v = VEC_RE.exec(t);
  if (v) return { fam: (({ '': 'f', i: 'i', u: 'u', b: 'b' }) as Record<string, Family>)[v[1]], dim: +v[2], mat: false };
  if (MAT_RE.test(t)) return { fam: 'f', dim: 0, mat: true };
  return null;
}

function make(fam: Family, dim: number): string {
  const base = fam === 'f' ? '' : fam === 'i' ? 'i' : fam === 'u' ? 'u' : 'b';
  if (dim === 1) return fam === 'f' ? 'float' : fam === 'i' ? 'int' : fam === 'u' ? 'uint' : 'bool';
  return `${base}vec${dim}`;
}

function isArray(t: string | null): boolean {
  return !!t && t.includes('[');
}

function elementType(t: string): string {
  return t.slice(0, t.indexOf('['));
}

// ---------------------------------------------------------------- AST

interface Expr {
  k: 'num' | 'id' | 'call' | 'field' | 'index' | 'un' | 'post' | 'bin' | 'assign' | 'tern' | 'comma' | 'paren';
  t: string | null;
  text?: string;
  name?: string;
  args?: Expr[];
  a?: Expr;
  b?: Expr;
  c?: Expr;
  op?: string;
  /** For calls: callee resolved to these parameter qualifiers (out/inout are not coerced). */
  outs?: boolean[];
}

interface FnSig {
  ret: string;
  params: Array<{ type: string; qual: string }>;
}

// ---------------------------------------------------------------- builtins

const GEN_SAME = new Set([
  'abs', 'sign', 'floor', 'ceil', 'fract', 'sqrt', 'inversesqrt', 'exp', 'exp2', 'log', 'log2', 'sin', 'cos', 'tan',
  'asin', 'acos', 'atan', 'radians', 'degrees', 'normalize', 'trunc', 'round', 'roundEven', 'sinh', 'cosh', 'tanh',
  'asinh', 'acosh', 'atanh', 'dFdx', 'dFdy', 'fwidth', 'min', 'max', 'mod', 'pow', 'clamp', 'mix', 'reflect',
  'refract', 'faceforward', 'step', 'smoothstep',
]);
const FLOAT_ONLY_ARGS = new Set(GEN_SAME); // every arg of these gets float-promoted when any float is present
const RET_FLOAT = new Set(['length', 'distance', 'dot', 'determinant']);
const RET_BOOL_VEC = new Set(['lessThan', 'lessThanEqual', 'greaterThan', 'greaterThanEqual', 'equal', 'notEqual']);

function samplerResult(s: string): string | null {
  if (/Shadow$/.test(s)) return 'float';
  if (s.startsWith('i')) return 'ivec4';
  if (s.startsWith('u')) return 'uvec4';
  return 'vec4';
}

// ---------------------------------------------------------------- parser / emitter

export interface CoerceOptions {
  /** Pre-declared symbols (engine provided names) -> type. */
  symbols?: Record<string, string>;
}

class Coercer {
  private t: Tok[];
  private p = 0;
  private out: string[] = [];
  private scopes: Array<Map<string, string>> = [new Map()];
  private structs = new Map<string, Array<[string, string]>>();
  private fns = new Map<string, FnSig[]>();
  private constGlobals = new Set<string>();
  private hoisted: string[] = [];
  private curRet = 'void';
  warnings: string[] = [];

  constructor(src: string, opts: CoerceOptions) {
    this.t = tokenize(src);
    const g = this.scopes[0];
    for (const [k, v] of Object.entries(opts.symbols ?? {})) g.set(k, v);
    g.set('gl_FragCoord', 'vec4');
    g.set('gl_Position', 'vec4');
    g.set('gl_PointCoord', 'vec2');
    g.set('gl_FrontFacing', 'bool');
    g.set('gl_VertexID', 'int');
    g.set('gl_InstanceID', 'int');
    g.set('gl_PointSize', 'float');
    g.set('gl_FragDepth', 'float');
  }

  // ---- token helpers
  private peek(o = 0): Tok | undefined {
    return this.t[this.p + o];
  }
  private next(): Tok {
    return this.t[this.p++];
  }
  private eat(s: Tok): boolean {
    if (this.t[this.p] === s) {
      this.p++;
      return true;
    }
    return false;
  }
  private expect(s: Tok) {
    if (!this.eat(s)) throw new Error(`expected '${s}' but found '${this.peek()}' near token ${this.p}`);
  }
  private emit(s: string) {
    this.out.push(s);
  }

  // ---- scopes
  private lookup(name: string): string | null {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const v = this.scopes[i].get(name);
      if (v !== undefined) return v;
    }
    return null;
  }
  private declare(name: string, type: string) {
    this.scopes[this.scopes.length - 1].set(name, type);
  }
  private isTypeName(s: string | undefined): boolean {
    if (!s) return false;
    return SCALARS.has(s) || s === 'void' || VEC_RE.test(s) || MAT_RE.test(s) || SAMPLER_RE.test(s) || this.structs.has(s);
  }

  // ---- top level
  run(): string {
    while (this.p < this.t.length) this.topLevel();
    return this.out.join('');
  }

  private topLevel() {
    const tk = this.peek()!;
    if (tk === ';') {
      this.next();
      return;
    }
    if (tk === 'precision') {
      while (this.peek() !== ';') this.emit(this.next() + ' ');
      this.emit(this.next() + '\n');
      return;
    }
    this.declarationOrFunction(true);
  }

  private parseQualifiers(): string[] {
    const q: string[] = [];
    for (;;) {
      const tk = this.peek();
      if (tk === undefined) break;
      if (tk === 'layout') {
        let s = this.next();
        let depth = 0;
        do {
          const x = this.next();
          s += x;
          if (x === '(') depth++;
          else if (x === ')') depth--;
        } while (depth > 0);
        q.push(s);
      } else if (QUALS.has(tk)) {
        q.push(this.next());
      } else break;
    }
    return q;
  }

  private parseTypeSpec(): string {
    const tk = this.next();
    if (tk === 'struct') {
      return this.parseStruct();
    }
    let type = tk;
    if (this.peek() === '[') {
      const start = this.p;
      this.next();
      let depth = 1;
      let s = '[';
      while (depth > 0) {
        const x = this.next();
        if (x === '[') depth++;
        else if (x === ']') depth--;
        s += x;
      }
      type += s;
      void start;
    }
    return type;
  }

  /** Parses `struct [Name] { ... }` (after the `struct` keyword), emits it, returns the type name. */
  private parseStruct(): string {
    let name = '';
    if (this.peek() !== '{') name = this.next();
    this.expect('{');
    const fields: Array<[string, string]> = [];
    let body = '';
    while (!this.eat('}')) {
      const quals = this.parseQualifiers();
      const ft = this.parseTypeSpec();
      do {
        const fname = this.next();
        let fullType = ft;
        let arr = '';
        while (this.peek() === '[') {
          this.next();
          let s = '[';
          while (this.peek() !== ']') s += this.next();
          this.next();
          s += ']';
          arr += s;
        }
        fullType = ft + arr;
        fields.push([fname, fullType]);
        body += `${quals.join(' ')} ${ft} ${fname}${arr};\n`;
      } while (this.eat(','));
      this.expect(';');
    }
    if (name) this.structs.set(name, fields);
    this.emit(`struct ${name} {\n${body}}`);
    return name;
  }

  private declarationOrFunction(global: boolean) {
    const quals = this.parseQualifiers();
    // bare qualifier declaration, e.g. `uniform;` is not supported; struct-only statements:
    let typeName: string;
    let isStructDef = false;
    if (this.peek() === 'struct') {
      this.next();
      const saved = this.out.length;
      typeName = this.parseStruct();
      isStructDef = true;
      void saved;
      if (this.peek() === ';') {
        this.next();
        this.emit(';\n');
        return;
      }
      this.emit(' ');
    } else {
      typeName = this.parseTypeSpec();
    }
    void isStructDef;

    // function?
    if (global && this.peek(1) === '(' && /^[A-Za-z_]/.test(this.peek()!)) {
      this.functionRest(quals, typeName);
      return;
    }

    // variable declaration list
    const qualStr = quals.length ? quals.join(' ') + ' ' : '';
    const isConst = quals.includes('const');
    const isUniformLike = quals.some((q) => q === 'uniform' || q === 'in' || q === 'out' || q === 'attribute' || q === 'varying');
    const parts: string[] = [];
    for (;;) {
      const name = this.next();
      let arr = '';
      while (this.peek() === '[') {
        this.next();
        let s = '[';
        let depth = 1;
        while (depth > 0) {
          const x = this.next();
          if (x === '[') depth++;
          else if (x === ']') depth--;
          if (depth > 0) s += x;
        }
        arr += s + ']';
      }
      let fullType = typeName;
      if (arr) fullType = isArray(typeName) ? typeName : typeName + arr;
      if (isArray(typeName) && arr) fullType = elementType(typeName) + arr;
      this.declare(name, fullType);
      let decl = `${name}${isArray(typeName) ? '' : arr}`;
      if (this.eat('=')) {
        let init = this.parseAssign();
        init = this.coerce(init, fullType);
        const text = this.emitExpr(init);
        if (global && !isConst && !isUniformLike && !this.isConstExpr(init)) {
          // Non-constant global initializer: declare now, assign at the top of main().
          this.hoisted.push(`${name} = ${text};`);
        } else {
          decl += ` = ${text}`;
        }
        if (isConst) this.constGlobals.add(name);
      } else if (isConst) this.constGlobals.add(name);
      parts.push(decl);
      if (!this.eat(',')) break;
    }
    this.expect(';');
    this.emit(`${qualStr}${typeName} ${parts.join(', ')};\n`);
  }

  private isConstExpr(e: Expr): boolean {
    switch (e.k) {
      case 'num':
        return true;
      case 'id':
        return this.constGlobals.has(e.name!) && this.scopes.length === 1;
      case 'call': {
        const n = e.name!;
        const builtinish =
          this.isTypeName(n.replace(/\[.*$/, '')) ||
          GEN_SAME.has(n) || RET_FLOAT.has(n) || ['cross', 'transpose', 'inverse', 'any', 'all', 'not'].includes(n);
        if (!builtinish || this.fns.has(n)) return false;
        return e.args!.every((a) => this.isConstExpr(a));
      }
      case 'paren':
      case 'un':
        return this.isConstExpr(e.a!);
      case 'bin':
        return this.isConstExpr(e.a!) && this.isConstExpr(e.b!);
      case 'tern':
        return this.isConstExpr(e.a!) && this.isConstExpr(e.b!) && this.isConstExpr(e.c!);
      case 'field':
        return this.isConstExpr(e.a!);
      case 'index':
        return this.isConstExpr(e.a!) && this.isConstExpr(e.b!);
      default:
        return false;
    }
  }

  private functionRest(quals: string[], ret: string) {
    const name = this.next();
    this.expect('(');
    const params: FnSig['params'] = [];
    const pText: string[] = [];
    const scope = new Map<string, string>();
    if (this.peek() === 'void' && this.peek(1) === ')') this.next();
    while (this.peek() !== ')') {
      const pq = this.parseQualifiers();
      const pt = this.parseTypeSpec();
      let pname = '';
      let arr = '';
      if (this.peek() !== ',' && this.peek() !== ')') {
        pname = this.next();
        while (this.peek() === '[') {
          this.next();
          let s = '[';
          while (this.peek() !== ']') s += this.next();
          this.next();
          arr += s + ']';
        }
      }
      const full = arr && !isArray(pt) ? pt + arr : pt;
      const dir = pq.includes('inout') ? 'inout' : pq.includes('out') ? 'out' : 'in';
      params.push({ type: full, qual: dir });
      if (pname) scope.set(pname, full);
      pText.push(`${pq.join(' ')} ${pt} ${pname}${isArray(pt) ? '' : arr}`.trim());
      if (!this.eat(',')) break;
    }
    this.expect(')');
    const sig: FnSig = { ret, params };
    const list = this.fns.get(name) ?? [];
    list.push(sig);
    this.fns.set(name, list);
    const head = `${quals.join(' ')} ${ret} ${name}(${pText.join(', ')})`.trim();
    if (this.eat(';')) {
      this.emit(head + ';\n');
      return;
    }
    this.emit(head + ' ');
    this.curRet = ret;
    this.scopes.push(scope);
    this.block(name === 'main');
    this.scopes.pop();
  }

  // ---- statements
  private block(isMain = false) {
    this.expect('{');
    this.emit('{\n');
    if (isMain && this.hoisted.length) for (const h of this.hoisted) this.emit(h + '\n');
    this.scopes.push(new Map());
    while (this.peek() !== '}') this.statement();
    this.scopes.pop();
    this.next();
    this.emit('}\n');
  }

  private looksLikeDecl(): boolean {
    let i = 0;
    let sawQual = false;
    for (;;) {
      const tk = this.peek(i);
      if (tk === undefined) return false;
      if (tk === 'layout') return true;
      if (QUALS.has(tk)) {
        sawQual = true;
        i++;
      } else break;
    }
    const tk = this.peek(i);
    if (tk === 'struct') return true;
    if (!this.isTypeName(tk)) return false;
    const nx = this.peek(i + 1);
    if (nx === undefined) return false;
    if (/^[A-Za-z_]/.test(nx)) return true;
    if (nx === '[') {
      let depth = 0;
      let j = i + 1;
      for (; j < this.t.length; j++) {
        if (this.t[this.p + j] === '[') depth++;
        else if (this.t[this.p + j] === ']') {
          depth--;
          if (depth === 0) break;
        }
      }
      const after = this.peek(j + 1);
      return !!after && /^[A-Za-z_]/.test(after);
    }
    return sawQual && false;
  }

  private statement() {
    const tk = this.peek()!;
    if (tk === '{') return this.block();
    if (tk === ';') {
      this.next();
      this.emit(';\n');
      return;
    }
    if (this.looksLikeDecl()) return this.declarationOrFunction(false);
    switch (tk) {
      case 'if': {
        this.next();
        this.expect('(');
        const c = this.parseExpr();
        this.expect(')');
        this.emit(`if (${this.emitExpr(c)}) `);
        this.statement();
        if (this.peek() === 'else') {
          this.next();
          this.emit('else ');
          this.statement();
        }
        return;
      }
      case 'for': {
        this.next();
        this.expect('(');
        this.scopes.push(new Map());
        this.emit('for (');
        // init
        if (this.peek() === ';') {
          this.next();
          this.emit('; ');
        } else if (this.looksLikeDecl()) {
          const saveOut = this.out;
          this.out = [];
          this.declarationOrFunction(false);
          const text = this.out.join('').replace(/\n$/, '');
          this.out = saveOut;
          this.emit(text + ' ');
        } else {
          const e = this.parseExpr();
          this.expect(';');
          this.emit(this.emitExpr(e) + '; ');
        }
        // cond
        if (this.peek() !== ';') this.emit(this.emitExpr(this.parseExpr()));
        this.expect(';');
        this.emit('; ');
        if (this.peek() !== ')') this.emit(this.emitExpr(this.parseExpr()));
        this.expect(')');
        this.emit(') ');
        this.statement();
        this.scopes.pop();
        return;
      }
      case 'while': {
        this.next();
        this.expect('(');
        const c = this.parseExpr();
        this.expect(')');
        this.emit(`while (${this.emitExpr(c)}) `);
        this.statement();
        return;
      }
      case 'do': {
        this.next();
        this.emit('do ');
        this.statement();
        this.expect('while');
        this.expect('(');
        const c = this.parseExpr();
        this.expect(')');
        this.expect(';');
        this.emit(`while (${this.emitExpr(c)});\n`);
        return;
      }
      case 'switch': {
        this.next();
        this.expect('(');
        const c = this.parseExpr();
        this.expect(')');
        this.emit(`switch (${this.emitExpr(c)}) `);
        this.expect('{');
        this.emit('{\n');
        this.scopes.push(new Map());
        while (this.peek() !== '}') {
          if (this.peek() === 'case') {
            this.next();
            const v = this.parseExpr();
            this.expect(':');
            this.emit(`case ${this.emitExpr(v)}:\n`);
          } else if (this.peek() === 'default') {
            this.next();
            this.expect(':');
            this.emit('default:\n');
          } else this.statement();
        }
        this.next();
        this.scopes.pop();
        this.emit('}\n');
        return;
      }
      case 'return': {
        this.next();
        if (this.eat(';')) {
          this.emit('return;\n');
          return;
        }
        let e = this.parseExpr();
        this.expect(';');
        e = this.coerce(e, this.curRet);
        this.emit(`return ${this.emitExpr(e)};\n`);
        return;
      }
      case 'break':
      case 'continue':
      case 'discard': {
        this.next();
        this.expect(';');
        this.emit(`${tk};\n`);
        return;
      }
    }
    const e = this.parseExpr();
    this.expect(';');
    this.emit(this.emitExpr(e) + ';\n');
  }

  // ---- expressions
  private parseExpr(): Expr {
    let e = this.parseAssign();
    while (this.peek() === ',') {
      this.next();
      const r = this.parseAssign();
      e = { k: 'comma', t: r.t, a: e, b: r };
    }
    return e;
  }

  private parseAssign(): Expr {
    const lhs = this.parseTernary();
    const op = this.peek();
    if (op && ['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '|=', '^='].includes(op)) {
      this.next();
      let rhs = this.parseAssign();
      if (op === '=' || op === '+=' || op === '-=' || op === '*=' || op === '/=') {
        rhs = this.coerceAssign(lhs.t, rhs, op);
      }
      return { k: 'assign', t: lhs.t, op, a: lhs, b: rhs };
    }
    return lhs;
  }

  private parseTernary(): Expr {
    const c = this.parseBinary(0);
    if (this.peek() === '?') {
      this.next();
      let a = this.parseAssign();
      this.expect(':');
      let b = this.parseAssign();
      const u = this.unify(a, b);
      a = u[0];
      b = u[1];
      return { k: 'tern', t: a.t ?? b.t, a: c, b: a, c: b };
    }
    return c;
  }

  private static PREC: Record<string, number> = {
    '||': 1, '^^': 2, '&&': 3, '|': 4, '^': 5, '&': 6, '==': 7, '!=': 7, '<': 8, '>': 8, '<=': 8, '>=': 8,
    '<<': 9, '>>': 9, '+': 10, '-': 10, '*': 11, '/': 11, '%': 11,
  };

  private parseBinary(minPrec: number): Expr {
    let lhs = this.parseUnary();
    for (;;) {
      const op = this.peek();
      const pr = op === undefined ? undefined : Coercer.PREC[op];
      if (pr === undefined || pr < minPrec) return lhs;
      this.next();
      let rhs = this.parseBinary(pr + 1);
      lhs = this.makeBinary(op!, lhs, rhs);
      void rhs;
    }
  }

  private makeBinary(op: string, l: Expr, r: Expr): Expr {
    if (['+', '-', '*', '/', '==', '!=', '<', '>', '<=', '>='].includes(op)) {
      const u = this.unify(l, r);
      l = u[0];
      r = u[1];
    }
    let t: string | null = null;
    if (['==', '!=', '<', '>', '<=', '>=', '&&', '||', '^^'].includes(op)) t = 'bool';
    else t = this.arithType(op, l.t, r.t);
    return { k: 'bin', t, op, a: l, b: r };
  }

  private arithType(op: string, a: string | null, b: string | null): string | null {
    const sa = split(a);
    const sb = split(b);
    if (!sa || !sb) return a ?? b;
    if (op === '<<' || op === '>>') return a;
    if (sa.mat && sb.mat) return a;
    if (op === '*') {
      if (sa.mat && !sb.mat) return sb.dim === 1 ? a : b;
      if (sb.mat && !sa.mat) return sa.dim === 1 ? b : a;
    }
    if (sa.mat) return a;
    if (sb.mat) return b;
    if (sa.dim >= sb.dim) return a;
    return b;
  }

  /** Make the two operands of an arithmetic operation agree on their component type. */
  private unify(a: Expr, b: Expr): [Expr, Expr] {
    const sa = split(a.t);
    const sb = split(b.t);
    if (!sa || !sb || sa.mat || sb.mat) return [a, b];
    if (sa.fam === sb.fam) return [a, b];
    const rank = (f: Family) => (f === 'f' ? 3 : f === 'u' ? 2 : f === 'i' ? 1 : 0);
    if (sa.fam === 'b' || sb.fam === 'b') return [a, b];
    if (rank(sa.fam) > rank(sb.fam)) return [a, this.convertTo(b, make(sa.fam, sb.dim))];
    return [this.convertTo(a, make(sb.fam, sa.dim)), b];
  }

  private coerceAssign(lt: string | null, rhs: Expr, op: string): Expr {
    if (!lt) return rhs;
    const sl = split(lt);
    const sr = split(rhs.t);
    if (!sl || !sr || sl.mat || sr.mat) return rhs;
    if (sl.fam === sr.fam) return rhs;
    // `float *= int` etc: bring rhs to the lhs component type, keeping its own dimension
    if (op === '=') return this.convertTo(rhs, lt);
    return this.convertTo(rhs, make(sl.fam, sr.dim));
  }

  /** Coerce `e` so it can initialise / be returned as a value of type `target`. */
  private coerce(e: Expr, target: string): Expr {
    if (!target || target === 'void') return e;
    if (isArray(target) || isArray(e.t)) return e;
    const st = split(target);
    const se = split(e.t);
    if (!st || !se) return e;
    if (st.mat || se.mat) return e;
    if (st.fam === se.fam && st.dim === se.dim) return e;
    if (st.fam === 'b' || se.fam === 'b') return e;
    if (st.dim !== se.dim) return e;
    return this.convertTo(e, target);
  }

  private convertTo(e: Expr, type: string): Expr {
    if (e.t === type) return e;
    // integer literal -> float / uint literal
    if (e.k === 'num' && e.t === 'int') {
      if (type === 'float' && /^\d+$/.test(e.text!)) return { k: 'num', t: 'float', text: e.text + '.0' };
      if (type === 'uint' && /^\d+$/.test(e.text!)) return { k: 'num', t: 'uint', text: e.text + 'u' };
    }
    if (e.k === 'un' && e.op === '-' && e.a!.k === 'num' && e.a!.t === 'int' && type === 'float') {
      const inner = this.convertTo(e.a!, type);
      return { k: 'un', t: type, op: '-', a: inner };
    }
    return { k: 'call', t: type, name: type, args: [e], outs: [false] };
  }

  private parseUnary(): Expr {
    const tk = this.peek()!;
    if (tk === '-' || tk === '+' || tk === '!' || tk === '~') {
      this.next();
      const a = this.parseUnary();
      return { k: 'un', t: tk === '!' ? 'bool' : a.t, op: tk, a };
    }
    if (tk === '++' || tk === '--') {
      this.next();
      const a = this.parseUnary();
      return { k: 'un', t: a.t, op: tk, a };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let e = this.parsePrimary();
    for (;;) {
      const tk = this.peek();
      if (tk === '.') {
        this.next();
        const name = this.next();
        e = this.makeField(e, name);
      } else if (tk === '[') {
        this.next();
        const idx = this.parseExpr();
        this.expect(']');
        e = { k: 'index', t: this.indexType(e.t), a: e, b: idx };
      } else if (tk === '++' || tk === '--') {
        this.next();
        e = { k: 'post', t: e.t, op: tk, a: e };
      } else return e;
    }
  }

  private indexType(t: string | null): string | null {
    if (!t) return null;
    if (isArray(t)) {
      const el = elementType(t);
      const rest = t.slice(t.indexOf(']') + 1);
      return el + rest;
    }
    const s = split(t);
    if (!s) return null;
    if (s.mat) {
      const m = MAT_RE.exec(t)!;
      return `vec${m[2] ?? m[1]}`;
    }
    return make(s.fam, 1);
  }

  private makeField(e: Expr, name: string): Expr {
    const s = split(e.t);
    if (s && !s.mat) {
      const n = name.length;
      const t = make(s.fam, n);
      if (s.dim === 1) {
        // scalar swizzle (`x.x`, `x.xxx`) is desktop-only
        if (n === 1) return e;
        return { k: 'field', t, name, a: { k: 'call', t: make(s.fam, n), name: make(s.fam, n), args: [e], outs: [false] } , text: 'ctor' };
      }
      return { k: 'field', t, name, a: e };
    }
    if (e.t && this.structs.has(e.t)) {
      const f = this.structs.get(e.t)!.find((x) => x[0] === name);
      return { k: 'field', t: f ? f[1] : null, name, a: e };
    }
    if (e.t && /\.length$/.test(name)) return { k: 'field', t: 'int', name, a: e };
    return { k: 'field', t: null, name, a: e };
  }

  private parsePrimary(): Expr {
    const tk = this.next();
    if (tk === undefined) throw new Error('unexpected end of input');
    if (tk === '(') {
      const e = this.parseExpr();
      this.expect(')');
      return { k: 'paren', t: e.t, a: e };
    }
    if (/^[0-9.]/.test(tk)) {
      let t = 'int';
      if (/^0[xX]/.test(tk)) t = /[uU]$/.test(tk) ? 'uint' : 'int';
      else if (/[uU]$/.test(tk)) t = 'uint';
      else if (/[.eE]/.test(tk) || /[fF]$/.test(tk)) t = 'float';
      return { k: 'num', t, text: tk };
    }
    if (tk === 'true' || tk === 'false') return { k: 'num', t: 'bool', text: tk };
    // type constructor with array suffix: float[6](...)
    let name = tk;
    if (this.isTypeName(tk) && this.peek() === '[') {
      let s = '[';
      this.next();
      let depth = 1;
      while (depth > 0) {
        const x = this.next();
        if (x === '[') depth++;
        else if (x === ']') depth--;
        s += x;
      }
      name = tk + s;
    }
    if (this.peek() === '(') {
      this.next();
      const args: Expr[] = [];
      if (this.peek() === 'void') this.next();
      while (this.peek() !== ')') {
        args.push(this.parseAssign());
        if (!this.eat(',')) break;
      }
      this.expect(')');
      return this.makeCall(name, args);
    }
    return { k: 'id', t: this.lookup(tk), name: tk };
  }

  private makeCall(name: string, args: Expr[]): Expr {
    const base = name.replace(/\[.*$/, '');
    // array constructor: coerce elements to the element type
    if (isArray(name)) {
      const el = base;
      args = args.map((a) => this.coerce(a, el));
      return { k: 'call', t: name, name, args, outs: args.map(() => false) };
    }
    // struct constructor
    if (this.structs.has(name)) {
      const fields = this.structs.get(name)!;
      if (fields.length === args.length) args = args.map((a, i) => this.coerce(a, fields[i][1]));
      return { k: 'call', t: name, name, args, outs: args.map(() => false) };
    }
    if (this.isTypeName(name)) {
      return { k: 'call', t: name, name, args, outs: args.map(() => false) };
    }
    // user function
    const sigs = this.fns.get(name);
    if (sigs) {
      let best: FnSig | null = null;
      let bestScore = Infinity;
      for (const s of sigs) {
        if (s.params.length !== args.length) continue;
        let score = 0;
        let ok = true;
        for (let i = 0; i < args.length; i++) {
          const pt = s.params[i].type;
          const at = args[i].t;
          if (!at || at === pt) continue;
          const sp = split(pt);
          const sa = split(at);
          if (sp && sa && !sp.mat && !sa.mat && sp.dim === sa.dim && sp.fam !== 'b' && sa.fam !== 'b') score += 1;
          else ok = false;
        }
        if (ok && score < bestScore) {
          best = s;
          bestScore = score;
        }
      }
      if (best) {
        const outs = best.params.map((p) => p.qual !== 'in');
        args = args.map((a, i) => (outs[i] ? a : this.coerce(a, best!.params[i].type)));
        return { k: 'call', t: best.ret, name, args, outs };
      }
      return { k: 'call', t: sigs[0].ret, name, args, outs: args.map(() => false) };
    }
    return this.builtinCall(name, args);
  }

  private builtinCall(name: string, args: Expr[]): Expr {
    const mk = (t: string | null, a = args): Expr => ({ k: 'call', t, name, args: a, outs: a.map(() => false) });

    if (name === 'modf' || name === 'frexp') return mk(args[0]?.t ?? null);
    if (FLOAT_ONLY_ARGS.has(name) && args.length > 0) {
      // Agree on one component type: floats win; integer-capable functions keep int/uint.
      const intOk = name === 'abs' || name === 'sign' || name === 'min' || name === 'max' || name === 'clamp';
      const rank = (f: Family) => (f === 'f' ? 3 : f === 'u' ? 2 : f === 'i' ? 1 : 0);
      let target: Family = null;
      let maxDim = 1;
      for (const a of args) {
        const s = split(a.t);
        if (s && !s.mat) {
          if (s.fam !== 'b' && rank(s.fam) > rank(target)) target = s.fam;
          maxDim = Math.max(maxDim, s.dim);
        }
      }
      if (!intOk && target && target !== 'f') target = 'f';
      if (target) {
        args = args.map((a) => {
          const s = split(a.t);
          if (s && !s.mat && s.fam !== target && s.fam !== 'b') return this.convertTo(a, make(target, s.dim));
          return a;
        });
      }
      let rt: string | null;
      if (name === 'step') rt = args[1]?.t ?? args[0].t;
      else if (name === 'smoothstep') rt = args[2]?.t ?? null;
      else if (name === 'mix' || name === 'clamp' || name === 'min' || name === 'max' || name === 'mod' || name === 'pow') {
        // widest argument
        rt = args[0].t;
        for (const a of args) {
          const s = split(a.t);
          const r = split(rt);
          if (s && r && !s.mat && s.dim > r.dim && name !== 'mix') rt = a.t;
        }
        if (name === 'mix') rt = args[0].t;
      } else rt = args[0].t;
      void maxDim;
      return mk(rt, args);
    }
    if (RET_FLOAT.has(name)) return mk('float');
    if (RET_BOOL_VEC.has(name)) {
      const s = split(args[0]?.t ?? null);
      return mk(s ? make('b', s.dim) : null);
    }
    switch (name) {
      case 'cross':
        return mk('vec3');
      case 'transpose':
      case 'inverse':
        return mk(args[0]?.t ?? null);
      case 'any':
      case 'all':
      case 'isnan':
      case 'isinf': {
        if (name === 'isnan' || name === 'isinf') {
          const s = split(args[0]?.t ?? null);
          return mk(s ? make('b', s.dim) : null);
        }
        return mk('bool');
      }
      case 'not': {
        return mk(args[0]?.t ?? null);
      }
      case 'texture':
      case 'textureLod':
      case 'textureProj':
      case 'textureGrad': {
        // coordinates, bias and LOD must be float in ES (desktop accepts ints)
        args = args.map((a, i) => {
          const s = split(a.t);
          return i > 0 && s && !s.mat && (s.fam === 'i' || s.fam === 'u') ? this.convertTo(a, make('f', s.dim)) : a;
        });
        const st = args[0]?.t ?? '';
        return mk(SAMPLER_RE.test(st) ? samplerResult(st) : 'vec4', args);
      }
      case 'textureOffset':
      case 'texelFetch':
      case 'texelFetchOffset': {
        const st = args[0]?.t ?? '';
        return mk(SAMPLER_RE.test(st) ? samplerResult(st) : 'vec4');
      }
      case 'iris_textureGather':
        return mk('vec4');
      case 'textureSize': {
        const st = args[0]?.t ?? '';
        return mk(/3D/.test(st) ? 'ivec3' : 'ivec2');
      }
      case 'floatBitsToUint':
      case 'packHalf2x16':
      case 'packUnorm2x16':
      case 'packSnorm2x16':
      case 'packUnorm4x8':
        return mk('uint');
      case 'floatBitsToInt':
        return mk('int');
      case 'uintBitsToFloat':
      case 'intBitsToFloat':
        return mk('float');
      case 'unpackHalf2x16':
      case 'unpackUnorm2x16':
      case 'unpackSnorm2x16':
        return mk('vec2');
      case 'unpackUnorm4x8':
        return mk('vec4');
      case 'iris_bitfieldInsert':
      case 'iris_bitfieldExtract':
        return mk(args[0]?.t ?? 'uint');
      case 'matrixCompMult':
        return mk(args[0]?.t ?? null);
      case 'outerProduct': {
        const a = split(args[0]?.t ?? null);
        const b = split(args[1]?.t ?? null);
        return mk(a && b ? `mat${b.dim}x${a.dim}`.replace(/^mat(\d)x\1$/, 'mat$1') : null);
      }
      default:
        return mk(null);
    }
  }

  // ---- emission
  private emitExpr(e: Expr): string {
    switch (e.k) {
      case 'num':
        return e.text!;
      case 'id':
        return e.name!;
      case 'paren':
        return `(${this.emitExpr(e.a!)})`;
      case 'call':
        return `${e.name}(${e.args!.map((a) => this.emitExpr(a)).join(', ')})`;
      case 'field':
        if (e.text === 'ctor') return `${this.emitExpr(e.a!)}.${e.name}`;
        return `${this.emitExpr(e.a!)}.${e.name}`;
      case 'index':
        return `${this.emitExpr(e.a!)}[${this.emitExpr(e.b!)}]`;
      case 'un':
        return `${e.op}${this.emitExpr(e.a!)}`;
      case 'post':
        return `${this.emitExpr(e.a!)}${e.op}`;
      case 'bin':
        return `(${this.emitExpr(e.a!)} ${e.op} ${this.emitExpr(e.b!)})`;
      case 'assign':
        return `${this.emitExpr(e.a!)} ${e.op} ${this.emitExpr(e.b!)}`;
      case 'tern':
        return `(${this.emitExpr(e.a!)} ? ${this.emitExpr(e.b!)} : ${this.emitExpr(e.c!)})`;
      case 'comma':
        return `${this.emitExpr(e.a!)}, ${this.emitExpr(e.b!)}`;
    }
  }
}

export interface CoerceResult {
  source: string;
  warnings: string[];
}

/**
 * Rewrite preprocessed desktop GLSL so it is valid GLSL ES 3.00 as far as typing goes.
 * On a parse failure the original source is returned with a warning (the driver will then
 * report the real error).
 */
export function coerceProgram(src: string, opts: CoerceOptions = {}): CoerceResult {
  try {
    const c = new Coercer(src, opts);
    const source = c.run();
    return { source, warnings: c.warnings };
  } catch (e) {
    return { source: src, warnings: [`type pass failed: ${(e as Error).message}`] };
  }
}
