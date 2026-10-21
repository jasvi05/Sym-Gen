/* Run with:  node tests/test.js
   Loads the browser scripts into one sandbox and checks the results. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'js');
const code = ['lexer.js', 'symbol-table.js', 'analyzer.js']
  .map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(code + '\nthis.tokenize = tokenize; this.analyze = analyze;', ctx);

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name); }
}
function run(src) {
  const lex = ctx.tokenize(src);
  const res = ctx.analyze(lex.tokens);
  return { lex, table: res.table, diags: res.diagnostics, syms: res.table.allSymbols() };
}
const names = r => r.syms.map(s => s.name);
const count = (r, sev) => r.diags.filter(d => d.severity === sev).length;

console.log('Test 1: globals and functions');
let r = run(`int g = 0;
int add(int a, int b) { int s = a + b; return s; }
int main() { int x = 5; x = add(x, g); return 0; }`);
check('symbols found', ['g', 'add', 'a', 'b', 's', 'main', 'x'].every(n => names(r).includes(n)));
check('3 scopes', r.table.scopes.length === 3);
check('no errors', count(r, 'error') === 0);
check('param a is in add() scope', r.syms.find(s => s.name === 'a').scopeLabel === 'add()');

console.log('Test 2: nested scopes, for loop, arrays');
r = run(`int main() {
  int arr[10];
  for (int i = 0; i < 10; i++) { arr[i] = i; }
  if (1) { int f = 1; arr[0] = f; }
  return 0;
}`);
check('array size 40', r.syms.find(s => s.name === 'arr').size === 40);
check('i lives in for scope', r.syms.find(s => s.name === 'i').scopeLabel === 'for');
check('max depth 2', r.table.maxDepth() === 2);
check('no diagnostics', r.diags.length === 0);

console.log('Test 3: errors');
r = run(`int a;
int a;
int main() { int u = 0; return missing; }`);
check('redeclaration reported', r.diags.some(d => /redeclaration of 'a'/.test(d.message)));
check('undeclared reported', r.diags.some(d => /'missing' undeclared/.test(d.message)));
check('unused reported', r.diags.some(d => /'u' is declared but never used/.test(d.message)));

console.log('Test 4: shadowing');
r = run(`int x = 1;
int main() { int x = 2; return x; }`);
check('shadow info', r.diags.some(d => d.severity === 'info' && /shadows/.test(d.message)));

console.log('Test 5: struct, typedef, enum, macro, pointers');
r = run(`#define MAX 10
typedef struct { int x; int y; } Point;
enum Color { RED, GREEN };
struct Node { int val; struct Node *next; };
int main() { Point p; struct Node n; char *s = "hi"; int arr[MAX]; p.x = RED; n.val = 1; return arr[0] + s[0]; }`);
check('typedef Point', names(r).includes('Point'));
check('Point size 8', r.syms.find(s => s.name === 'p').size === 8);
check('enum constants', names(r).includes('RED') && names(r).includes('GREEN'));
check('macro symbol', r.syms.some(s => s.name === 'MAX' && s.kind === 'macro'));
check('pointer size 8', r.syms.find(s => s.name === 's').size === 8);
check('no errors', count(r, 'error') === 0);

console.log('Test 6: braces and lexical errors');
r = run('int main() { int x = 1;');
check('missing } reported', r.diags.some(d => /missing '}'/.test(d.message)));
r = run('int main() { } }');
check('unmatched } reported', r.diags.some(d => /unmatched '}'/.test(d.message)));
check('unterminated string', run('char *s = "abc;').lex.errors.length === 1);
check('bad character', run('int x = 5 @ 3;').lex.errors.length === 1);

console.log('Test 7: prototype then definition, recursion');
r = run(`int f(int n);
int f(int n) { if (n < 1) { return 1; } return n * f(n - 1); }
int main() { return f(3); }`);
check('no errors', count(r, 'error') === 0);
check('f declared once', r.syms.filter(s => s.name === 'f').length === 1);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
