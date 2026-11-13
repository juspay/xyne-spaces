import { type Node, type ElementNode, type ExprNode, type TextNode, type AttrValue, type Expr, LayoutError } from './types.js';

const NAME_RE = /[A-Za-z0-9_$]/;
const WS_RE = /\s/;

/**
 * Parse a restricted JSX template into a node list. Supports elements
 * (`<Name attr="s" attr={expr} flag>children</Name>` and self-closing),
 * `{expression}` children, and text. Expressions are member/index/literal access
 * only. Throws LayoutError on malformed input (surfaced as an inline error, never a crash).
 */
export function parse(src: string): Node[] {
  return new Parser(src).parseRoot();
}

class Parser {
  private pos = 0;
  constructor(private readonly src: string) {}

  parseRoot(): Node[] {
    const nodes = this.parseNodes();
    if (this.pos < this.src.length) throw new LayoutError(`Unexpected '${this.src.slice(this.pos, this.pos + 12)}' at ${String(this.pos)}`);
    return nodes;
  }

  // Nodes up to a closing tag (`</`) or EOF; the closing tag is left for the caller.
  private parseNodes(): Node[] {
    const out: Node[] = [];
    while (this.pos < this.src.length) {
      if (this.src.startsWith('</', this.pos)) break;
      const c = this.src[this.pos]!;
      if (c === '<') out.push(this.parseElement());
      else if (c === '{') out.push(this.parseExprNode());
      else { const t = this.parseText(); if (t) out.push(t); }
    }
    return out;
  }

  private parseElement(): ElementNode {
    this.expect('<');
    const name = this.parseName();
    const attrs = this.parseAttrs();
    this.skipWs();
    if (this.src.startsWith('/>', this.pos)) { this.pos += 2; return { kind: 'element', name, attrs, children: [] }; }
    this.expect('>');
    const children = this.parseNodes();
    this.expect('<'); this.expect('/');
    const close = this.parseName();
    this.skipWs(); this.expect('>');
    if (close !== name) throw new LayoutError(`Mismatched closing tag </${close}> for <${name}>`);
    return { kind: 'element', name, attrs, children };
  }

  private parseAttrs(): Record<string, AttrValue> {
    const attrs: Record<string, AttrValue> = {};
    for (;;) {
      this.skipWs();
      const c = this.src[this.pos];
      if (c === undefined || c === '>' || c === '/') break;
      const name = this.parseName();
      this.skipWs();
      if (this.src[this.pos] === '=') {
        this.pos++; this.skipWs();
        const v = this.src[this.pos];
        if (v === '{') attrs[name] = { kind: 'expr', expr: this.parseBraced() };
        else if (v === '"' || v === "'") attrs[name] = { kind: 'string', value: this.parseString() };
        else throw new LayoutError(`Expected value for attribute '${name}'`);
      } else {
        attrs[name] = { kind: 'bool', value: true };
      }
    }
    return attrs;
  }

  private parseExprNode(): ExprNode { return { kind: 'expr', expr: this.parseBraced() }; }

  private parseBraced(): Expr {
    this.expect('{'); this.skipWs();
    const e = this.parseExpr();
    this.skipWs(); this.expect('}');
    return e;
  }

  private parseText(): TextNode | null {
    let s = '';
    while (this.pos < this.src.length) {
      const c = this.src[this.pos]!;
      if (c === '<' || c === '{') break;
      s += c; this.pos++;
    }
    const collapsed = s.replace(/\s+/g, ' ');
    return collapsed.trim() === '' ? null : { kind: 'text', value: collapsed };
  }

  // ─── Expressions: member/index chains over identifiers and literals ───

  private parseExpr(): Expr {
    let e = this.parsePrimary();
    for (;;) {
      this.skipWs();
      const c = this.src[this.pos];
      if (c === '.') { this.pos++; this.skipWs(); e = { kind: 'member', obj: e, prop: this.parseName() }; }
      else if (c === '[') { this.pos++; this.skipWs(); const index = this.parseExpr(); this.skipWs(); this.expect(']'); e = { kind: 'index', obj: e, index }; }
      else break;
    }
    return e;
  }

  private parsePrimary(): Expr {
    const c = this.src[this.pos];
    if (c === '"' || c === "'") return { kind: 'lit', value: this.parseString() };
    if (c === '-' || (c !== undefined && c >= '0' && c <= '9')) return { kind: 'lit', value: this.parseNumber() };
    const name = this.parseName();
    if (name === 'true') return { kind: 'lit', value: true };
    if (name === 'false') return { kind: 'lit', value: false };
    if (name === 'null') return { kind: 'lit', value: null };
    if (this.src[this.pos] === '(') return { kind: 'call', name, args: this.parseArgs() };
    return { kind: 'ident', name };
  }

  private parseArgs(): Expr[] {
    this.expect('('); this.skipWs();
    const args: Expr[] = [];
    if (this.src[this.pos] === ')') { this.pos++; return args; }
    args.push(this.parseExpr()); this.skipWs();
    while (this.src[this.pos] === ',') { this.pos++; this.skipWs(); args.push(this.parseExpr()); this.skipWs(); }
    this.expect(')');
    return args;
  }

  // ─── Lexical helpers ───

  private parseName(): string {
    const start = this.pos;
    while (this.pos < this.src.length && NAME_RE.test(this.src[this.pos]!)) this.pos++;
    if (this.pos === start) throw new LayoutError(`Expected a name at ${String(this.pos)}`);
    return this.src.slice(start, this.pos);
  }

  private parseString(): string {
    const quote = this.src[this.pos]!;
    this.pos++;
    let s = '';
    while (this.pos < this.src.length && this.src[this.pos] !== quote) {
      if (this.src[this.pos] === '\\') { this.pos++; }
      s += this.src[this.pos]; this.pos++;
    }
    this.expect(quote);
    return s;
  }

  private parseNumber(): number {
    const start = this.pos;
    if (this.src[this.pos] === '-') this.pos++;
    while (this.pos < this.src.length && /[0-9.]/.test(this.src[this.pos]!)) this.pos++;
    const n = Number(this.src.slice(start, this.pos));
    if (Number.isNaN(n)) throw new LayoutError(`Invalid number at ${String(start)}`);
    return n;
  }

  private skipWs(): void { while (this.pos < this.src.length && WS_RE.test(this.src[this.pos]!)) this.pos++; }

  private expect(ch: string): void {
    if (this.src[this.pos] !== ch) throw new LayoutError(`Expected '${ch}' at ${String(this.pos)}, found '${this.src[this.pos] ?? '<eof>'}'`);
    this.pos++;
  }
}
