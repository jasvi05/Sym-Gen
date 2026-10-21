/* =====================================================================
   analyzer.js  -  Phase 2: scope tracking and symbol table construction

   A single left-to-right pass over the token list. It recognises
   declarations (variables, arrays, pointers, functions, typedefs,
   struct/union/enum), opens and closes scopes on '{' and '}', and
   resolves every identifier use against the scope chain.

   Diagnostics produced:
     error   - redeclaration, redefinition, undeclared identifier,
               unmatched braces
     warning - unused local variable, implicit function declaration
     info    - a declaration that shadows an outer one
   ===================================================================== */

const TYPE_KEYWORDS = new Set(['int', 'float', 'double', 'char', 'void', 'short', 'long',
                               'unsigned', 'signed', 'const', 'volatile', '_Bool']);
const QUALIFIERS = new Set(['const', 'volatile', 'unsigned', 'signed']);
const STORAGE = new Set(['static', 'extern', 'register', 'auto', 'inline']);
const AGGREGATES = new Set(['struct', 'union', 'enum']);
const CONTROL = new Set(['if', 'else', 'while', 'do', 'switch']);
const OPENERS = new Set(['(', '[', '{']);
const CLOSERS = new Set([')', ']', '}']);

// names that come from the standard headers; we don't parse headers
const PREDEFINED = new Set([
  'printf', 'scanf', 'puts', 'gets', 'fgets', 'fputs', 'getchar', 'putchar', 'sprintf',
  'fprintf', 'fopen', 'fclose', 'malloc', 'calloc', 'realloc', 'free', 'exit', 'abs',
  'sqrt', 'pow', 'rand', 'srand', 'atoi', 'time', 'strlen', 'strcpy', 'strcmp', 'strcat',
  'strncpy', 'memcpy', 'memset', 'NULL', 'EOF', 'stdin', 'stdout', 'stderr',
  'INT_MAX', 'INT_MIN', 'RAND_MAX', 'true', 'false'
]);

function baseSize(type) {
  const words = type.split(' ');
  if (words.includes('char') || words.includes('_Bool')) return 1;
  if (words.includes('short')) return 2;
  if (words.includes('double') || words.includes('long')) return 8;
  if (words.includes('void')) return 0;
  return 4;   // int, float, unsigned, ...
}

class Analyzer {
  constructor(tokens) {
    this.pre = tokens.filter(t => t.type === 'preprocessor');
    this.toks = tokens.filter(t => t.type !== 'preprocessor');
    this.pos = 0;
    this.table = new SymbolTable();
    this.diagnostics = [];
    this.typedefs = new Set();
    this.typeSizes = new Map();     // struct/union/enum/typedef name -> size in bytes
    this.pendingLabel = null;       // control keyword waiting for its '{'
    this.anonCount = 0;
    this.reported = new Set();      // undeclared names already reported
  }

  /* ---------- small helpers ---------- */
  peek(o = 0) { return this.toks[this.pos + o]; }
  next() { return this.toks[this.pos++]; }
  is(v, o = 0) {
    const t = this.peek(o);
    return !!t && t.value === v && t.type !== 'string' && t.type !== 'char';
  }
  report(severity, line, col, message) { this.diagnostics.push({ severity, line, col: col || 1, message }); }
  error(line, col, msg) { this.report('error', line, col, msg); }
  warn(line, col, msg) { this.report('warning', line, col, msg); }
  note(line, col, msg) { this.report('info', line, col, msg); }

  sizeOf(type) {
    if (type.includes('*') || type.includes('[]')) return 8;
    const clean = type.split(' ').filter(w => !(w === 'const' || w === 'volatile')).join(' ');
    if (this.typeSizes.has(clean)) return this.typeSizes.get(clean);
    return baseSize(clean);
  }

  /* ---------- main driver ---------- */
  run() {
    this.declareMacros();
    while (this.pos < this.toks.length) this.statement();

    const last = this.toks.length ? this.toks[this.toks.length - 1].line : 1;
    while (this.table.current !== this.table.root) {
      const s = this.table.current;
      this.error(s.openLine, 1, `missing '}' - ${s.kind} scope '${s.label}' is never closed`);
      this.closeScope(last);
    }
    this.table.root.closeLine = last;
    this.table.root.frameSize = this.table.dataOffset;

    this.diagnostics.sort((a, b) => a.line - b.line || a.col - b.col);
    return { table: this.table, diagnostics: this.diagnostics };
  }

  // "#define NAME ..." puts NAME in the global scope as a macro symbol
  declareMacros() {
    for (const p of this.pre) {
      const m = /^#\s*define\s+([A-Za-z_]\w*)/.exec(p.value);
      if (m) this.declare({ name: m[1], type: '-', kind: 'macro', line: p.line, col: 1, size: 0 });
    }
  }

  closeScope(line) {
    const scope = this.table.current;
    if (scope !== this.table.root) {
      for (const sym of scope.symbols.values()) {
        if ((sym.kind === 'variable' || sym.kind === 'array') && sym.refCount === 0) {
          this.warn(sym.line, sym.col, `variable '${sym.name}' is declared but never used`);
        }
      }
    }
    this.table.exit(line);
  }

  /* ---------- statements ---------- */
  statement() {
    const t = this.peek();

    if (t.type === 'keyword') return this.keywordStatement(t);

    if (t.type === 'identifier') {
      if (this.typedefs.has(t.value) && (this.peek(1)?.type === 'identifier' || this.is('*', 1))) {
        return this.declaration();
      }
      const prev = this.toks[this.pos - 1];
      const atStmtStart = !prev || [';', '{', '}'].includes(prev.value);
      if (this.is(':', 1) && atStmtStart) { this.next(); this.next(); return; }   // goto label
      return this.reference();
    }

    if (t.type === 'punctuation') {
      if (t.value === '{') {
        this.next();
        this.table.enter('block', this.pendingLabel || 'block', t.line);
        this.pendingLabel = null;
        return;
      }
      if (t.value === '}') {
        this.next();
        if (this.table.current === this.table.root) this.error(t.line, t.col, "unmatched '}'");
        else this.closeScope(t.line);
        this.pendingLabel = null;
        return;
      }
      if (t.value === ';') this.pendingLabel = null;
    }
    this.next();
  }

  keywordStatement(t) {
    const v = t.value;
    if (v === 'typedef') return this.typedefDecl();
    if (TYPE_KEYWORDS.has(v) || STORAGE.has(v) || AGGREGATES.has(v)) return this.declaration();
    if (v === 'for') return this.forStatement();
    if (CONTROL.has(v)) { this.next(); this.pendingLabel = v; return; }
    this.next();   // return, break, case, sizeof, ...
  }

  forStatement() {
    const kw = this.next();
    if (!this.is('(')) return;
    this.next();
    this.table.enter('block', 'for', kw.line);

    // init clause: either a declaration (C99) or an expression
    if (this.startsDeclaration()) {
      const spec = this.parseSpecifiers();
      this.declarators(spec.type);
    } else {
      this.scan(t => t.value === ';');
      if (this.is(';')) this.next();
    }
    this.scan(() => false);            // condition and increment, up to ')'
    if (this.is(')')) this.next();

    if (this.is('{')) {
      this.next();                      // body shares the for-scope; '}' will close it
    } else {
      this.scan(t => t.value === ';');  // single-statement body
      if (this.is(';')) this.next();
      this.closeScope(this.toks[this.pos - 1].line);
    }
    this.pendingLabel = null;
  }

  startsDeclaration() {
    const t = this.peek();
    if (!t) return false;
    if (t.type === 'keyword') return TYPE_KEYWORDS.has(t.value) || STORAGE.has(t.value) || AGGREGATES.has(t.value);
    return t.type === 'identifier' && this.typedefs.has(t.value);
  }

  /* ---------- expression scanning ---------- */
  // Walk tokens (resolving identifiers) until stop(token) is true at
  // nesting depth 0, or until an unmatched closing bracket is reached.
  scan(stop) {
    let depth = 0;
    while (this.peek()) {
      const t = this.peek();
      const punct = t.type === 'punctuation';
      if (depth === 0 && stop(t)) return;
      if (punct && OPENERS.has(t.value)) depth++;
      else if (punct && CLOSERS.has(t.value)) {
        if (depth === 0) return;
        depth--;
      }
      if (t.type === 'identifier') this.reference(); else this.next();
    }
  }

  // An identifier used in an expression: look it up in the scope chain.
  reference() {
    const t = this.next();
    const prev = this.toks[this.pos - 2];
    if (prev && prev.type === 'operator' && (prev.value === '.' || prev.value === '->')) return;  // struct member
    if (prev && prev.type === 'keyword' && AGGREGATES.has(prev.value)) return;                    // struct tag
    if (this.typedefs.has(t.value)) return;

    const sym = this.table.lookup(t.value);
    if (sym) { sym.refCount++; sym.refs.push(t.line); return; }
    if (PREDEFINED.has(t.value)) return;

    const isCall = this.is('(');
    if (this.reported.has(t.value)) return;
    this.reported.add(t.value);
    if (isCall) this.warn(t.line, t.col, `implicit declaration of function '${t.value}'`);
    else this.error(t.line, t.col, `'${t.value}' undeclared (first use in this scope)`);
  }

  /* ---------- declarations ---------- */
  declare(info) {
    const key = info.key || info.name;
    const scope = this.table.current;
    const existing = scope.symbols.get(key);

    if (existing) {
      if (existing.kind === 'function' && info.kind === 'function') {
        if (info.isDefinition) {
          if (existing.isDefinition) {
            this.error(info.line, info.col, `redefinition of function '${info.name}' (first defined at line ${existing.line})`);
          } else {
            existing.isDefinition = true;
            existing.params = info.params;
          }
        }
        return existing;
      }
      this.error(info.line, info.col,
        `redeclaration of '${info.name}' in the same scope (previous declaration at line ${existing.line})`);
      return existing;
    }

    if (scope !== this.table.root && !info.key && info.kind !== 'function') {
      const outer = this.table.lookupOuter(info.name);
      if (outer && outer.kind !== 'macro') {
        this.note(info.line, info.col, `'${info.name}' shadows the declaration at line ${outer.line}`);
      }
    }
    return this.table.add(info);
  }

  declaration() {
    const spec = this.parseSpecifiers();
    if (!spec.type) { this.next(); return; }
    this.declarators(spec.type);
  }

  typedefDecl() {
    this.next();   // 'typedef'
    const spec = this.parseSpecifiers();
    if (!spec.type) return;
    this.declarators(spec.type, 'typedef');
  }

  // Reads the leading "int", "unsigned long", "static const char",
  // "struct Point", a typedef name, etc.
  parseSpecifiers() {
    const parts = [];
    let sawBase = false;
    while (this.peek()) {
      const t = this.peek();
      if (t.type === 'keyword') {
        if (TYPE_KEYWORDS.has(t.value)) {
          parts.push(t.value);
          if (t.value !== 'const' && t.value !== 'volatile') sawBase = true;
          this.next();
          continue;
        }
        if (STORAGE.has(t.value)) { this.next(); continue; }
        if (AGGREGATES.has(t.value)) { parts.push(this.aggregate()); sawBase = true; continue; }
        break;
      }
      if (t.type === 'identifier' && !sawBase && this.typedefs.has(t.value)) {
        parts.push(t.value); sawBase = true; this.next(); continue;
      }
      break;
    }
    return { type: parts.join(' ') };
  }

  // struct / union / enum, with or without a body
  aggregate() {
    const kw = this.next();
    let tag = '';
    if (this.peek() && this.peek().type === 'identifier') tag = this.next().value;
    const named = tag !== '';
    if (!named) tag = `<anon${++this.anonCount}>`;
    const typeName = `${kw.value} ${tag}`;

    if (this.is('{')) {
      const size = kw.value === 'enum' ? this.enumBody() : this.structBody(kw.value);
      this.typeSizes.set(typeName, size);
      if (named) {
        this.declare({ key: typeName, name: tag, type: typeName, kind: kw.value,
                       line: kw.line, col: kw.col, size });
      }
    }
    return typeName;
  }

  structBody(kind) {
    this.next();   // '{'
    let total = 0, align = 1;
    while (this.peek() && !this.is('}')) {
      const spec = this.parseSpecifiers();
      if (!spec.type) { this.next(); continue; }
      while (true) {
        let stars = '';
        while (this.is('*')) { stars += '*'; this.next(); }
        if (this.peek()?.type !== 'identifier') break;
        this.next();
        let count = 1;
        while (this.is('[')) {
          this.next();
          const v = this.peek();
          if (v && v.type === 'number') count *= parseInt(v.value) || 1;
          this.scan(() => false);
          if (this.is(']')) this.next();
        }
        const elem = this.sizeOf(spec.type + stars);
        const al = alignOf(elem);
        if (kind === 'union') total = Math.max(total, elem * count);
        else total = roundUp(total, al) + elem * count;
        align = Math.max(align, al);
        if (this.is(',')) { this.next(); continue; }
        break;
      }
      if (this.is(';')) this.next();
    }
    if (this.is('}')) this.next();
    return roundUp(total, align);
  }

  enumBody() {
    this.next();   // '{'
    while (this.peek() && !this.is('}')) {
      const t = this.peek();
      if (t.type === 'identifier') {
        this.next();
        if (this.is('=')) { this.next(); this.scan(x => x.value === ','); }
        this.declare({ name: t.value, type: 'int', kind: 'constant', line: t.line, col: t.col, size: 4 });
      } else {
        this.next();
      }
      if (this.is(',')) this.next();
    }
    if (this.is('}')) this.next();
    return 4;
  }

  // The part after the type: "*p, arr[10], x = 5;" or a function.
  declarators(baseType, mode = 'var') {
    while (true) {
      let stars = '';
      while (this.is('*') || this.is('const')) { if (this.is('*')) stars += '*'; this.next(); }

      const nameTok = this.peek();
      if (!nameTok || nameTok.type !== 'identifier') break;
      this.next();

      if (this.is('(') && mode === 'var') {
        this.functionDeclarator(baseType + stars, nameTok);
        return;
      }

      const dims = [];
      while (this.is('[')) {
        this.next();
        const v = this.peek();
        dims.push(v && v.type === 'number' ? v.value : '');
        this.scan(() => false);
        if (this.is(']')) this.next();
      }

      const full = baseType + stars;
      const elem = this.sizeOf(full);
      const count = dims.reduce((a, d) => a * (parseInt(d) || 1), 1);
      const dimText = dims.map(d => `[${d}]`).join('');

      if (mode === 'typedef') {
        this.typedefs.add(nameTok.value);
        this.typeSizes.set(nameTok.value, elem * count);
        this.declare({ name: nameTok.value, type: full + dimText, kind: 'typedef',
                       line: nameTok.line, col: nameTok.col, size: elem * count });
      } else {
        this.declare({ name: nameTok.value, type: full, dims: dimText,
                       kind: dims.length ? 'array' : 'variable',
                       line: nameTok.line, col: nameTok.col,
                       size: elem * count, elemSize: elem });
      }

      if (this.is('=')) { this.next(); this.scan(t => t.value === ',' || t.value === ';'); }
      if (this.is(',')) { this.next(); continue; }
      break;
    }
    if (this.is(';')) this.next();
  }

  functionDeclarator(retType, nameTok) {
    const params = this.parseParams();
    const signature = params.map(p => (p.name ? `${p.type} ${p.name}` : p.type)).join(', ');
    const info = { name: nameTok.value, type: retType, kind: 'function',
                   line: nameTok.line, col: nameTok.col, size: 0, params: signature };

    if (this.is('{')) {
      this.next();
      this.declare({ ...info, isDefinition: true });
      this.table.enter('function', `${nameTok.value}()`, nameTok.line);
      for (const p of params) {
        if (!p.name) continue;
        this.declare({ name: p.name, type: p.type, kind: 'parameter',
                       line: p.line, col: p.col, size: this.sizeOf(p.type), elemSize: this.sizeOf(p.type) });
      }
    } else {
      this.declare({ ...info, isDefinition: false });   // prototype
      if (this.is(';')) this.next();
    }
  }

  parseParams() {
    this.next();   // '('
    const params = [];
    while (this.peek() && !this.is(')')) {
      if (this.is('...')) { this.next(); params.push({ name: '', type: '...' }); continue; }
      const spec = this.parseSpecifiers();
      if (!spec.type) { this.next(); continue; }     // unknown token, skip it

      let stars = '';
      while (this.is('*') || this.is('const')) { if (this.is('*')) stars += '*'; this.next(); }
      let name = '', line = 0, col = 0;
      if (this.peek()?.type === 'identifier') {
        const nt = this.next();
        name = nt.value; line = nt.line; col = nt.col;
      }
      let isArray = false;
      while (this.is('[')) {
        this.next();
        this.scan(() => false);
        if (this.is(']')) this.next();
        isArray = true;
      }
      if (spec.type === 'void' && !stars && !name && !isArray) {   // f(void)
        if (this.is(',')) this.next();
        continue;
      }
      params.push({ name, type: spec.type + stars + (isArray ? '[]' : ''), line, col });
      if (this.is(',')) this.next();
    }
    if (this.is(')')) this.next();
    return params;
  }
}

function analyze(tokens) {
  return new Analyzer(tokens).run();
}
