/* =====================================================================
   symbol-table.js  -  Scope and symbol table data structures

   Every scope owns its own table (a JS Map, i.e. a hash table keyed by
   identifier name). Scopes are linked to their parent so that name
   lookup can walk outwards: innermost scope first, global scope last.
   ===================================================================== */

class Scope {
  constructor(id, parent, kind, label, openLine) {
    this.id = id;
    this.parent = parent;
    this.kind = kind;            // 'global' | 'function' | 'block'
    this.label = label;          // e.g. "main()", "for", "if"
    this.level = parent ? parent.level + 1 : 0;
    this.openLine = openLine;
    this.closeLine = null;
    this.symbols = new Map();
    this.children = [];
    this.frameStart = 0;         // stack offset when the scope was entered
    this.frameSize = 0;          // bytes used (stack frame, or data segment for global)
  }
}

function alignOf(size) {
  if (size >= 8) return 8;
  if (size >= 4) return 4;
  if (size >= 2) return 2;
  return 1;
}
function roundUp(n, a) { return Math.ceil(n / a) * a; }

// only these kinds actually take up storage
const STORED_KINDS = new Set(['variable', 'array', 'parameter']);

class SymbolTable {
  constructor() {
    this.root = new Scope(0, null, 'global', 'Global', 1);
    this.current = this.root;
    this.scopes = [this.root];
    this.dataOffset = 0;                    // next free byte in the data segment
    this.frame = { offset: 0, max: 0 };     // current function's stack frame
  }

  enter(kind, label, line) {
    const scope = new Scope(this.scopes.length, this.current, kind, label, line);
    if (kind === 'function') this.frame = { offset: 0, max: 0 };
    scope.frameStart = this.frame.offset;
    this.current.children.push(scope);
    this.scopes.push(scope);
    this.current = scope;
    return scope;
  }

  exit(line) {
    const scope = this.current;
    if (scope === this.root) return null;
    scope.closeLine = line;
    if (scope.kind === 'function') {
      scope.frameSize = this.frame.max;
    } else {
      // block storage can be reused once the block ends
      scope.frameSize = this.frame.offset - scope.frameStart;
      this.frame.offset = scope.frameStart;
    }
    this.current = scope.parent;
    return scope;
  }

  // Insert a symbol into the current scope and assign it storage.
  add(info) {
    const scope = this.current;
    const sym = Object.assign({ refCount: 0, refs: [] }, info);
    sym.scopeId = scope.id;
    sym.scopeLevel = scope.level;
    sym.scopeLabel = scope.label;
    sym.offset = null;
    sym.segment = '';

    if (STORED_KINDS.has(sym.kind)) {
      const al = alignOf(sym.elemSize || sym.size);
      if (scope === this.root) {
        sym.segment = 'data';
        sym.offset = roundUp(this.dataOffset, al);
        this.dataOffset = sym.offset + sym.size;
      } else {
        sym.segment = 'stack';
        sym.offset = roundUp(this.frame.offset, al);
        this.frame.offset = sym.offset + sym.size;
        this.frame.max = Math.max(this.frame.max, this.frame.offset);
      }
    }
    scope.symbols.set(info.key || info.name, sym);
    return sym;
  }

  // Search current scope, then each enclosing scope.
  lookup(name) {
    for (let s = this.current; s; s = s.parent) {
      const found = s.symbols.get(name);
      if (found) return found;
    }
    return null;
  }

  // Same, but skipping the current scope (used to detect shadowing).
  lookupOuter(name) {
    for (let s = this.current.parent; s; s = s.parent) {
      const found = s.symbols.get(name);
      if (found) return found;
    }
    return null;
  }

  // All symbols, scope by scope (pre-order over the scope tree).
  allSymbols() {
    const out = [];
    (function walk(scope) {
      scope.symbols.forEach(sym => out.push(sym));
      scope.children.forEach(walk);
    })(this.root);
    return out;
  }

  maxDepth() {
    return this.scopes.reduce((m, s) => Math.max(m, s.level), 0);
  }
}
