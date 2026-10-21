# Interactive Compiler Symbol Table Generator

**Course:** Compiler Design  
**Team / Author(s):** Jasvi Desai  
**Roll No. / Section:** 049  
**Guide:** Neha Minocha

---

## 1. Abstract

A symbol table is the data structure a compiler uses to remember every name in a program (variables, functions, parameters, types) together with its attributes. This project is a browser-based tool that takes C source code, performs lexical analysis, tracks scopes while scanning, and builds and displays the symbol table interactively. It also reports semantic problems found along the way, such as redeclarations and undeclared identifiers.

## 2. Objectives

1. Implement a lexical analyzer that splits C source into tokens.
2. Implement a scope-aware analyzer that builds a symbol table with one table per scope.
3. Show name resolution through the scope chain (inner to outer).
4. Detect common semantic errors using the symbol table.
5. Present everything in an interactive interface.

## 3. Features

| Feature | Description |
|---|---|
| Lexer | Keywords, identifiers, numbers (decimal, float, hex), strings, chars, operators, punctuation, comments, preprocessor lines. Reports unterminated strings/comments and invalid characters. |
| Symbol table | Name, type, kind, scope, declaration line, size, storage address, reference count. |
| Scopes | Global, function, and block scopes (`if`, `else`, `while`, `for`, `do`, `switch`, bare `{ }`). |
| Types | Variables, arrays, pointers, functions and prototypes, parameters, `struct`, `union`, `enum`, `typedef`, `#define` names. |
| Storage layout | Sizes and aligned offsets in the data segment (globals) or stack frame (locals). |
| Scope tree | Nested view of every scope and its symbols. |
| Hash view | Per-scope hash table with chaining and collision display. |
| Lookup | Pick an identifier and a line to see how it resolves through the scope chain. |
| Diagnostics | Errors, warnings and info messages, highlighted in the editor gutter. |
| Export | Download the table as JSON or CSV. |

## 4. How to run

No installation is needed.

1. Open `index.html` in any modern browser (Chrome, Edge, Firefox).
2. Pick an example from the dropdown, or type/paste/open your own `.c` file.
3. Press **Analyze** (or Ctrl+Enter). Tick *Auto-analyze* to update while typing.

To run the automated tests (needs Node.js):

```
node tests/test.js
```

## 5. Project structure

```
symbol-table-generator/
├── index.html            page layout
├── css/style.css         styling
├── js/
│   ├── lexer.js          phase 1: tokenizer
│   ├── symbol-table.js   Scope and SymbolTable classes
│   ├── analyzer.js       phase 2: declarations, scopes, name resolution
│   ├── examples.js       sample programs
│   └── app.js            user interface, lookup, export
├── tests/test.js         automated tests
└── README.md
```

## 6. System design

```
 C source ──► Lexer ──► tokens ──► Analyzer ──► SymbolTable (scope tree)
                │                      │                │
         lexical errors        semantic diagnostics     ▼
                └──────────────┬───────┘          UI tabs / export
                               ▼
                         Diagnostics tab
```

### 6.1 Lexical analysis (`lexer.js`)

The lexer scans the text once from left to right. At each position it decides the token class from the first character:

- whitespace is skipped (newlines update the line counter),
- `#` starts a preprocessor token that runs to end of line,
- `//` and `/* */` comments are discarded,
- quotes start a string or character literal,
- digits start a number (matched with a regular expression),
- letters or `_` start an identifier, which becomes a keyword if it is in the keyword set,
- otherwise the longest matching operator (3, 2, then 1 characters) or punctuation mark is taken.

Each token stores `type`, `value`, `line` and `col`.

### 6.2 Symbol table (`symbol-table.js`)

- Each `Scope` holds a `Map` (a hash table keyed by name), a pointer to its parent scope, its child scopes, and the line range it covers.
- `SymbolTable.enter()` opens a new scope; `exit()` closes it.
- `lookup(name)` searches the current scope, then each parent until the global scope. This is how **static (lexical) scoping** works: the innermost declaration wins.
- Storage is assigned when a symbol is added. Globals go in the *data* segment. Locals and parameters go in the function's *stack frame*. Offsets are aligned to the size of the type (1, 2, 4 or 8 bytes). When a block ends its storage is reused, so the frame size is the maximum used at any time.

Type sizes used: `char` 1, `short` 2, `int`/`float` 4, `long`/`double` 8, any pointer 8, arrays = element size × count, structs = aligned sum of members, unions = largest member.

### 6.3 Analyzer (`analyzer.js`)

A single pass over the tokens:

1. A type keyword (or `struct`, `typedef` name, etc.) starts a **declaration**. The specifiers are read, then each declarator (`*p`, `arr[10]`, `x = 5`) is added to the current scope. A `(` after the name means a function: with `{` it is a definition (a function scope is opened and the parameters are inserted); otherwise it is a prototype.
2. `{` opens a block scope, labelled by the control keyword that preceded it (`if`, `while`, ...). `}` closes the current scope.
3. `for (` opens its own scope so a loop variable `int i` is visible only inside the loop.
4. Any other identifier is a **use**. It is looked up through the scope chain; the reference count of the found symbol is increased, or a diagnostic is raised if nothing is found.

Diagnostics:

| Severity | Condition |
|---|---|
| error | redeclaration in the same scope; redefinition of a function; undeclared identifier; missing or unmatched `}` |
| warning | local variable never used; call to an undeclared function (implicit declaration) |
| info | a declaration hides one from an outer scope (shadowing) |

### 6.4 Interface (`app.js`)

Renders the token stream, symbol table, scope tree, hash view, lookup result and diagnostics from the data structures. Clicking any row highlights the matching line in the editor.

## 7. Sample output

For this input:

```c
int globalCount = 0;

int add(int a, int b) {
    int sum = a + b;
    return sum;
}

int main() {
    int x = 5;
    x = add(x, globalCount);
    return 0;
}
```

| Name | Type | Kind | Scope | Line | Size | Address |
|---|---|---|---|---|---|---|
| globalCount | int | variable | Global | 1 | 4 B | data+0 |
| add | int | function | Global | 3 | - | - |
| main | int | function | Global | 8 | - | - |
| a | int | parameter | add() | 3 | 4 B | stack+0 |
| b | int | parameter | add() | 3 | 4 B | stack+4 |
| sum | int | variable | add() | 4 | 4 B | stack+8 |
| x | int | variable | main() | 9 | 4 B | stack+0 |

## 8. Testing

`tests/test.js` runs 24 checks covering: globals and functions, nested scopes and `for` loops, arrays and sizes, redeclaration, undeclared identifiers, unused variables, shadowing, structs / typedefs / enums / macros, pointers, unbalanced braces, lexical errors, prototypes and recursion. All pass.

## 9. Limitations

- It is a teaching tool, not a full C compiler: no macro expansion, function pointers, or full expression type checking.
- Parsing is single-pass and heuristic. Unusual declaration syntax may be skipped.
- Standard library names (such as `printf`) are recognised from a built-in list rather than from header files.
- A variable that is only assigned counts as "used".

## 10. Future scope

- Type checking of expressions and function calls.
- A real recursive-descent parser building an abstract syntax tree.
- Function pointers and multi-file projects.
- Visualising the scope stack step by step as the source is scanned.

## 11. References

1. A. V. Aho, M. S. Lam, R. Sethi, J. D. Ullman, *Compilers: Principles, Techniques, and Tools* (2nd ed.), Pearson, 2006. Chapters 2 (symbol tables), 3 (lexical analysis), 6 (intermediate code and storage).
2. B. W. Kernighan, D. M. Ritchie, *The C Programming Language* (2nd ed.), Prentice Hall, 1988.
3. K. D. Cooper, L. Torczon, *Engineering a Compiler*, Morgan Kaufmann.
