/**
 * Small C-style preprocessor for GLSL shader packs.
 *
 * Handles `#define` (object and function-like), `#undef`, `#if / #ifdef / #ifndef / #elif /
 * #else / #endif` with integer expressions and `defined`, and drops `#version`, `#extension`,
 * `#pragma`, `#line` and `#error` lines. Macros are expanded here (not by the GPU driver)
 * because the type pass that follows needs to see the final expressions.
 */

export type DefineValue = string | number | boolean;

interface Macro {
  params: string[] | null;
  body: string;
}

/** Replace comments with whitespace, keeping newlines so line structure survives. */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
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

const isIdStart = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const isIdChar = (c: string) => isIdStart(c) || (c >= '0' && c <= '9');
const isDigit = (c: string) => c >= '0' && c <= '9';

function splitArgs(text: string, start: number): { args: string[]; end: number } | null {
  // `start` points just after the opening parenthesis.
  const args: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '(') {
      depth++;
      cur += c;
    } else if (c === ')') {
      if (depth === 0) {
        args.push(cur);
        return { args, end: i + 1 };
      }
      depth--;
      cur += c;
    } else if (c === ',' && depth === 0) {
      args.push(cur);
      cur = '';
    } else cur += c;
  }
  return null;
}

class Preprocessor {
  private macros = new Map<string, Macro>();
  warnings: string[] = [];

  constructor(predefined: Record<string, DefineValue>) {
    for (const [k, v] of Object.entries(predefined)) {
      if (v === false) continue;
      this.macros.set(k, { params: null, body: v === true ? '' : String(v) });
    }
  }

  // ------------------------------------------------------------ expansion

  expand(text: string, hide: Set<string> = new Set()): string {
    let out = '';
    let i = 0;
    const n = text.length;
    while (i < n) {
      const c = text[i];
      if (isIdStart(c)) {
        let j = i + 1;
        while (j < n && isIdChar(text[j])) j++;
        const id = text.slice(i, j);
        const m = this.macros.get(id);
        if (!m || hide.has(id)) {
          out += id;
          i = j;
          continue;
        }
        if (m.params === null) {
          const h = new Set(hide);
          h.add(id);
          out += this.expand(m.body, h);
          i = j;
          continue;
        }
        // function-like macro: needs '(' after optional whitespace
        let k = j;
        while (k < n && (text[k] === ' ' || text[k] === '\t' || text[k] === '\n' || text[k] === '\r')) k++;
        if (text[k] !== '(') {
          out += id;
          i = j;
          continue;
        }
        const parsed = splitArgs(text, k + 1);
        if (!parsed) {
          out += id;
          i = j;
          continue;
        }
        const args = parsed.args.map((a) => this.expand(a.trim(), hide));
        // `f()` for a zero-parameter macro yields one empty argument
        const body = this.substitute(m, args);
        const h = new Set(hide);
        h.add(id);
        out += this.expand(body, h);
        i = parsed.end;
      } else if (isDigit(c) || (c === '.' && isDigit(text[i + 1] ?? ''))) {
        // numeric literal: copy verbatim (so `1e5` / `0x1F` are not split into identifiers)
        let j = i + 1;
        while (j < n && (isIdChar(text[j]) || text[j] === '.' || ((text[j] === '+' || text[j] === '-') && /[eE]/.test(text[j - 1])))) j++;
        out += text.slice(i, j);
        i = j;
      } else {
        out += c;
        i++;
      }
    }
    return out;
  }

  private substitute(m: Macro, args: string[]): string {
    const params = m.params!;
    const map = new Map<string, string>();
    params.forEach((p, idx) => map.set(p, args[idx] ?? ''));
    const body = m.body;
    let out = '';
    let i = 0;
    while (i < body.length) {
      const c = body[i];
      if (isIdStart(c)) {
        let j = i + 1;
        while (j < body.length && isIdChar(body[j])) j++;
        const id = body.slice(i, j);
        out += map.has(id) ? map.get(id)! : id;
        i = j;
      } else if (isDigit(c)) {
        let j = i + 1;
        while (j < body.length && (isIdChar(body[j]) || body[j] === '.')) j++;
        out += body.slice(i, j);
        i = j;
      } else {
        out += c;
        i++;
      }
    }
    return out;
  }

  // ------------------------------------------------------------ #if evaluation

  evalCondition(expr: string): boolean {
    // defined X / defined(X) first, so the operand is not macro-expanded
    let s = expr.replace(/\bdefined\s*\(\s*([A-Za-z_]\w*)\s*\)|\bdefined\s+([A-Za-z_]\w*)/g, (_m, a, b) =>
      this.macros.has(a ?? b) ? ' 1 ' : ' 0 '
    );
    s = this.expand(s);
    s = s.replace(/[A-Za-z_]\w*/g, (id) => (/^\d/.test(id) ? id : '0'));
    try {
      return this.evalExpr(s) !== 0;
    } catch (e) {
      this.warnings.push(`cannot evaluate #if ${expr.trim()}`);
      return false;
    }
  }

  private evalExpr(src: string): number {
    const tokens = src.match(/0[xX][0-9a-fA-F]+[uU]?|\d+[uU]?|<<|>>|<=|>=|==|!=|&&|\|\||[-+*/%<>!~&|^?:()]/g) ?? [];
    let pos = 0;
    const peek = () => tokens[pos];
    const next = () => tokens[pos++];
    const primary = (): number => {
      const t = next();
      if (t === undefined) throw new Error('eof');
      if (t === '(') {
        const v = ternary();
        next();
        return v;
      }
      if (t === '!') return primary() === 0 ? 1 : 0;
      if (t === '-') return -primary();
      if (t === '+') return primary();
      if (t === '~') return ~primary();
      return parseInt(t.replace(/[uU]$/, ''), t.startsWith('0x') || t.startsWith('0X') ? 16 : 10);
    };
    const prec: Record<string, number> = {
      '*': 10, '/': 10, '%': 10, '+': 9, '-': 9, '<<': 8, '>>': 8, '<': 7, '<=': 7, '>': 7, '>=': 7,
      '==': 6, '!=': 6, '&': 5, '^': 4, '|': 3, '&&': 2, '||': 1,
    };
    const apply = (op: string, a: number, b: number): number => {
      switch (op) {
        case '*': return a * b;
        case '/': return b === 0 ? 0 : Math.trunc(a / b);
        case '%': return b === 0 ? 0 : a % b;
        case '+': return a + b;
        case '-': return a - b;
        case '<<': return a << b;
        case '>>': return a >> b;
        case '<': return a < b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
        case '==': return a === b ? 1 : 0;
        case '!=': return a !== b ? 1 : 0;
        case '&': return a & b;
        case '^': return a ^ b;
        case '|': return a | b;
        case '&&': return a !== 0 && b !== 0 ? 1 : 0;
        default: return a !== 0 || b !== 0 ? 1 : 0;
      }
    };
    const binary = (minPrec: number): number => {
      let lhs = primary();
      for (;;) {
        const op = peek();
        const p = op === undefined ? undefined : prec[op];
        if (p === undefined || p < minPrec) return lhs;
        next();
        const rhs = binary(p + 1);
        lhs = apply(op, lhs, rhs);
      }
    };
    const ternary = (): number => {
      const c = binary(1);
      if (peek() === '?') {
        next();
        const a = ternary();
        next(); // ':'
        const b = ternary();
        return c !== 0 ? a : b;
      }
      return c;
    };
    return ternary();
  }

  // ------------------------------------------------------------ driver

  run(source: string): string {
    // join `\` continuation lines, then drop comments
    const text = stripComments(source.replace(/\r\n?/g, '\n').replace(/\\\n/g, ' '));
    const lines = text.split('\n');
    const out: string[] = [];
    let chunk: string[] = [];
    const flush = () => {
      if (chunk.length) {
        out.push(this.expand(chunk.join('\n')));
        chunk = [];
      }
    };

    // conditional stack: [parentActive, thisBranchTaken, currentlyActive]
    const stack: Array<{ parent: boolean; taken: boolean; active: boolean }> = [];
    const active = () => (stack.length === 0 ? true : stack[stack.length - 1].active);

    for (const raw of lines) {
      const m = /^\s*#\s*(\w+)\s*(.*)$/.exec(raw);
      if (!m) {
        if (active()) chunk.push(raw);
        continue;
      }
      const dir = m[1];
      const rest = m[2];
      switch (dir) {
        case 'ifdef':
        case 'ifndef':
        case 'if': {
          flush();
          const parent = active();
          let cond = false;
          if (parent) {
            if (dir === 'if') cond = this.evalCondition(rest);
            else {
              const name = rest.trim().split(/\s+/)[0];
              cond = this.macros.has(name) === (dir === 'ifdef');
            }
          }
          stack.push({ parent, taken: cond, active: parent && cond });
          break;
        }
        case 'elif': {
          flush();
          const top = stack[stack.length - 1];
          if (!top) break;
          if (top.parent && !top.taken && this.evalCondition(rest)) {
            top.taken = true;
            top.active = true;
          } else top.active = false;
          break;
        }
        case 'else': {
          flush();
          const top = stack[stack.length - 1];
          if (!top) break;
          top.active = top.parent && !top.taken;
          top.taken = true;
          break;
        }
        case 'endif':
          flush();
          stack.pop();
          break;
        case 'define':
          if (active()) {
            flush();
            this.define(rest);
          }
          break;
        case 'undef':
          if (active()) {
            flush();
            this.macros.delete(rest.trim().split(/\s+/)[0]);
          }
          break;
        case 'error':
          if (active()) this.warnings.push(`#error ${rest.trim()}`);
          break;
        default:
          // version / extension / pragma / line / include (already expanded): dropped
          break;
      }
      // keep line count stable for diagnostics
      if (active()) chunk.push('');
    }
    flush();
    return out.join('\n');
  }

  private define(rest: string) {
    const m = /^([A-Za-z_]\w*)(\(([^)]*)\))?(?:\s+([\s\S]*))?$/.exec(rest.trim());
    if (!m) return;
    const params = m[2] !== undefined ? m[3].split(',').map((s) => s.trim()).filter((s) => s.length > 0) : null;
    // A '(' directly after the name makes it function-like; `#define X (1)` has a space.
    const directParen = new RegExp('^' + m[1] + '\\(').test(rest.trim());
    this.macros.set(m[1], {
      params: directParen ? params : null,
      body: (directParen ? m[4] : (rest.trim().slice(m[1].length))) ?? '',
    });
    if (!directParen) this.macros.get(m[1])!.body = rest.trim().slice(m[1].length).trim();
    else this.macros.get(m[1])!.body = (m[4] ?? '').trim();
  }
}

export function preprocess(
  source: string,
  predefined: Record<string, DefineValue>,
  warnings: string[]
): string {
  const pp = new Preprocessor(predefined);
  const text = pp.run(source);
  warnings.push(...pp.warnings);
  return text;
}
