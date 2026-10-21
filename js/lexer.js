/* =====================================================================
   lexer.js  -  Phase 1: Lexical analysis
   Converts C-like source text into a flat list of tokens.
   Each token: { type, value, line, col }
   Lexical errors (unterminated strings/comments, bad characters) are
   collected and returned instead of stopping the scan.
   ===================================================================== */

const KEYWORDS = new Set([
  'int', 'float', 'double', 'char', 'void', 'short', 'long', 'unsigned', 'signed',
  'const', 'volatile', '_Bool', 'struct', 'union', 'enum', 'typedef',
  'static', 'extern', 'register', 'auto', 'inline',
  'if', 'else', 'while', 'for', 'do', 'switch', 'case', 'default',
  'break', 'continue', 'return', 'goto', 'sizeof'
]);

const THREE_CHAR_OPS = ['<<=', '>>=', '...'];
const TWO_CHAR_OPS = ['==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=',
                      '*=', '/=', '%=', '&=', '|=', '^=', '->', '<<', '>>'];
const SINGLE_OPS = '+-*/%=<>!&|^~?:.';
const PUNCTUATION = '{}()[];,';

const NUMBER_RE = /0[xX][0-9a-fA-F]+[uUlL]*|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[uUlLfF]*/y;
const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/y;

function tokenize(source) {
  const tokens = [];
  const errors = [];
  const n = source.length;
  let i = 0;
  let line = 1;
  let lineStart = 0;   // index where the current line begins (for column numbers)

  const push = (type, value, start) =>
    tokens.push({ type, value, line, col: start - lineStart + 1 });
  const lexError = (message, start) =>
    errors.push({ severity: 'error', line, col: start - lineStart + 1, message });

  while (i < n) {
    const c = source[i];

    // --- whitespace -------------------------------------------------
    if (c === '\n') { line++; i++; lineStart = i; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { i++; continue; }

    // --- preprocessor directive (whole line) ------------------------
    if (c === '#') {
      let j = i;
      while (j < n && source[j] !== '\n') j++;
      push('preprocessor', source.slice(i, j).trim(), i);
      i = j;
      continue;
    }

    // --- comments ----------------------------------------------------
    if (c === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const startLine = line, startCol = i - lineStart + 1;
      let j = i + 2;
      let closed = false;
      while (j < n) {
        if (source[j] === '*' && source[j + 1] === '/') { closed = true; j += 2; break; }
        if (source[j] === '\n') { line++; lineStart = j + 1; }
        j++;
      }
      if (!closed) {
        errors.push({ severity: 'error', line: startLine, col: startCol, message: 'unterminated comment' });
      }
      i = j;
      continue;
    }

    // --- string and character literals -------------------------------
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let val = quote;
      let closed = false;
      while (j < n && source[j] !== '\n') {
        if (source[j] === '\\' && j + 1 < n) { val += source[j] + source[j + 1]; j += 2; continue; }
        if (source[j] === quote) { val += quote; closed = true; j++; break; }
        val += source[j++];
      }
      if (!closed) lexError(quote === '"' ? 'unterminated string literal' : 'unterminated character literal', i);
      push(quote === '"' ? 'string' : 'char', val, i);
      i = j;
      continue;
    }

    // --- numbers -----------------------------------------------------
    if ((c >= '0' && c <= '9') || (c === '.' && source[i + 1] >= '0' && source[i + 1] <= '9')) {
      NUMBER_RE.lastIndex = i;
      const m = NUMBER_RE.exec(source);
      push('number', m[0], i);
      i += m[0].length;
      continue;
    }

    // --- identifiers and keywords ------------------------------------
    if (/[A-Za-z_]/.test(c)) {
      IDENT_RE.lastIndex = i;
      const word = IDENT_RE.exec(source)[0];
      push(KEYWORDS.has(word) ? 'keyword' : 'identifier', word, i);
      i += word.length;
      continue;
    }

    // --- operators and punctuation -----------------------------------
    const three = source.substr(i, 3);
    if (THREE_CHAR_OPS.includes(three)) { push('operator', three, i); i += 3; continue; }
    const two = source.substr(i, 2);
    if (TWO_CHAR_OPS.includes(two)) { push('operator', two, i); i += 2; continue; }
    if (PUNCTUATION.includes(c)) { push('punctuation', c, i); i++; continue; }
    if (SINGLE_OPS.includes(c)) { push('operator', c, i); i++; continue; }

    lexError(`unexpected character '${c}'`, i);
    i++;
  }

  return { tokens, errors };
}
