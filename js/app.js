/* =====================================================================
   app.js  -  user interface: rendering, tabs, lookup, export
   ===================================================================== */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const sourceEl = $('source');
  const gutterEl = $('gutter');
  const statusEl = $('statusLine');

  let last = null;   // result of the most recent analysis

  const TOKEN_PILL = {
    keyword: 'kw', identifier: 'id', number: 'num', string: 'str',
    char: 'str', operator: 'op', punctuation: 'punc', preprocessor: 'pre'
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /* ---------------- hash function used for the "Hash view" ----------------
     Simple polynomial hash (h = h*31 + c) taken modulo the bucket count. */
  const BUCKETS = 11;
  function hashName(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % BUCKETS;
    return h;
  }

  /* ---------------- rendering ---------------- */
  function renderTokens(tokens, filter) {
    const shown = tokens.filter(t => !filter || t.type === filter);
    const options = ['', 'keyword', 'identifier', 'number', 'string', 'char', 'operator', 'punctuation', 'preprocessor']
      .map(o => `<option value="${o}" ${o === filter ? 'selected' : ''}>${o || 'all token types'}</option>`).join('');
    const rows = shown.map(t => `
      <tr class="jump" data-line="${t.line}">
        <td class="muted">${tokens.indexOf(t) + 1}</td>
        <td><span class="pill ${TOKEN_PILL[t.type]}">${t.type}</span></td>
        <td>${esc(t.value)}</td>
        <td>${t.line}:${t.col}</td>
      </tr>`).join('');
    return `<div class="filter-row"><select id="tokenFilter">${options}</select></div>
      <table><thead><tr><th>#</th><th>Type</th><th>Lexeme</th><th>Line:Col</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" class="muted">No tokens.</td></tr>'}</tbody></table>`;
  }

  function symbolRow(s) {
    const refLines = s.refs.length ? s.refs.join(', ') : '-';
    return `
      <tr class="jump" data-line="${s.line}">
        <td>${esc(s.name)}</td>
        <td>${esc(s.type)}${s.dims ? esc(s.dims) : ''}</td>
        <td><span class="kind kind-${s.kind}">${s.kind}</span></td>
        <td>L${s.scopeLevel} ${esc(s.scopeLabel)}</td>
        <td>${s.line}</td>
        <td>${s.size ? s.size + ' B' : '-'}</td>
        <td>${s.offset === null ? '-' : s.segment + '+' + s.offset}</td>
        <td title="used on lines: ${esc(refLines)}">${s.refCount}</td>
      </tr>`;
  }

  function renderSymbolTable(table, filter) {
    const f = (filter || '').toLowerCase();
    const rows = table.allSymbols().filter(s => !f || s.name.toLowerCase().includes(f));
    return `<div class="filter-row"><input id="symFilter" placeholder="Filter by name..." value="${esc(filter || '')}"></div>
      <table><thead><tr><th>Name</th><th>Type</th><th>Kind</th><th>Scope</th><th>Line</th><th>Size</th><th>Address</th><th>Refs</th></tr></thead>
      <tbody>${rows.map(symbolRow).join('') || '<tr><td colspan="8" class="muted">No matching symbols.</td></tr>'}</tbody></table>`;
  }

  function renderScope(scope) {
    const syms = Array.from(scope.symbols.values()).map(s => `
      <div class="srow jump" data-line="${s.line}">
        <span>${esc(s.name)} <span class="t">: ${esc(s.type)}${s.dims ? esc(s.dims) : ''}</span></span>
        <span class="t">${s.kind} &middot; line ${s.line}</span>
      </div>`).join('');
    const sizeLabel = scope.kind === 'global' ? 'data' : scope.kind === 'function' ? 'frame' : 'locals';
    return `<div class="scope-box">
      <div class="scope-head">
        <span class="lvl">L${scope.level}</span>
        <span class="name">${esc(scope.label)}</span>
        <span class="meta">scope #${scope.id} &middot; lines ${scope.openLine}-${scope.closeLine ?? '?'} &middot; ${sizeLabel} ${scope.frameSize} B</span>
      </div>
      ${syms ? `<div class="scope-symbols">${syms}</div>` : ''}
      ${scope.children.length ? `<div class="children">${scope.children.map(renderScope).join('')}</div>` : ''}
    </div>`;
  }

  function renderHash(table) {
    return table.scopes.map(scope => {
      const buckets = Array.from({ length: BUCKETS }, () => []);
      scope.symbols.forEach(sym => buckets[hashName(sym.key || sym.name)].push(sym.name));
      const n = scope.symbols.size;
      const collisions = buckets.filter(b => b.length > 1).length;
      const rows = buckets.map((b, i) => `<tr>
          <td class="muted">${i}</td>
          <td class="${b.length > 1 ? 'collision' : 'chain'}">${b.length ? esc(b.join(' → ')) : '<span class="muted">empty</span>'}</td>
        </tr>`).join('');
      return `<details class="hash-scope" ${scope.level === 0 ? 'open' : ''}>
        <summary>#${scope.id} ${esc(scope.label)} &mdash; ${n} entries, load factor ${(n / BUCKETS).toFixed(2)}, ${collisions} bucket(s) with collisions</summary>
        <table><thead><tr><th>Bucket</th><th>Chain</th></tr></thead><tbody>${rows}</tbody></table>
      </details>`;
    }).join('') + `<p class="hint">Each scope keeps its own hash table (${BUCKETS} buckets, hash = (h&times;31 + c) mod ${BUCKETS}, collisions chained). Red rows show collisions.</p>`;
  }

  function renderDiagnostics(diags) {
    if (!diags.length) return '<div class="empty-state">No errors or warnings. Clean build.</div>';
    const rows = diags.map(d => `
      <tr class="jump" data-line="${d.line}">
        <td><span class="pill ${d.severity}">${d.severity}</span></td>
        <td>${d.line}:${d.col}</td>
        <td>${esc(d.message)}</td>
      </tr>`).join('');
    return `<table><thead><tr><th>Severity</th><th>Line:Col</th><th>Message</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  /* ---------------- lookup (scope chain resolution) ---------------- */
  function findScopeAt(table, line) {
    let best = table.root;
    (function walk(scope) {
      for (const c of scope.children) {
        const end = c.closeLine === null ? Infinity : c.closeLine;
        if (line >= c.openLine && line <= end) { best = c; walk(c); }
      }
    })(table.root);
    return best;
  }

  function resolveLookup() {
    const box = $('lookupResult');
    if (!last) { box.innerHTML = '<div class="empty-state">Analyze the source first.</div>'; return; }
    const name = $('lookupName').value.trim();
    const line = parseInt($('lookupLine').value, 10) || 1;
    if (!name) { box.innerHTML = '<div class="result-box fail">Enter an identifier name.</div>'; return; }

    let scope = findScopeAt(last.table, line);
    const start = scope;
    const steps = [];
    let hit = null;
    while (scope) {
      const sym = scope.symbols.get(name);
      // a local name only becomes visible after its declaration line
      if (sym && sym.line <= line) {
        steps.push(`<div class="step hit">#${scope.id} ${esc(scope.label)} (L${scope.level}) &rarr; found: ${esc(sym.type)} ${esc(sym.name)}, declared on line ${sym.line}</div>`);
        hit = sym;
        break;
      }
      steps.push(`<div class="step">#${scope.id} ${esc(scope.label)} (L${scope.level}) &rarr; not found</div>`);
      scope = scope.parent;
    }
    const head = `<p>A use of <code>${esc(name)}</code> on line ${line} starts in scope <code>${esc(start.label)}</code>.</p>`;
    box.innerHTML = `<div class="result-box ${hit ? 'ok' : 'fail'}">${head}${steps.join('')}
      <p>${hit ? `Resolved to the ${hit.kind} declared on line ${hit.line}.` : 'Not resolved: this would be an undeclared identifier.'}</p></div>`;
    if (hit) flashLine(hit.line);
  }

  /* ---------------- editor helpers ---------------- */
  function syncGutter() {
    const n = sourceEl.value.split('\n').length;
    let html = '';
    for (let i = 1; i <= n; i++) html += `<div data-line="${i}">${i}</div>`;
    gutterEl.innerHTML = html;
    gutterEl.scrollTop = sourceEl.scrollTop;
  }

  function markGutter(diags) {
    for (const d of diags) {
      const el = gutterEl.querySelector(`div[data-line="${d.line}"]`);
      if (!el) continue;
      if (d.severity === 'error') { el.classList.remove('has-warn'); el.classList.add('has-error'); }
      else if (d.severity === 'warning' && !el.classList.contains('has-error')) el.classList.add('has-warn');
    }
  }

  function flashLine(line) {
    const target = gutterEl.querySelector(`div[data-line="${line}"]`);
    if (!target) return;
    gutterEl.querySelectorAll('.flash').forEach(d => d.classList.remove('flash'));
    target.classList.add('flash');
    sourceEl.scrollTop = Math.max(0, (line - 5) * 20);
    gutterEl.scrollTop = sourceEl.scrollTop;
    setTimeout(() => target.classList.remove('flash'), 1400);
  }

  /* ---------------- main action ---------------- */
  function compile() {
    try {
      const lex = tokenize(sourceEl.value);
      const result = analyze(lex.tokens);
      const diags = lex.errors.concat(result.diagnostics).sort((a, b) => a.line - b.line || a.col - b.col);
      last = { tokens: lex.tokens, table: result.table, diags };

      const table = result.table;
      const symCount = table.allSymbols().length;
      const errors = diags.filter(d => d.severity === 'error').length;
      const warnings = diags.filter(d => d.severity === 'warning').length;

      $('tab-tokens').innerHTML = renderTokens(lex.tokens, '');
      $('tab-table').innerHTML = renderSymbolTable(table, '');
      $('tab-tree').innerHTML = renderScope(table.root);
      $('tab-hash').innerHTML = renderHash(table);
      $('tab-diag').innerHTML = renderDiagnostics(diags);
      if ($('lookupResult').innerHTML) resolveLookup();

      $('statTokens').textContent = lex.tokens.length;
      $('statSymbols').textContent = symCount;
      $('statScopes').textContent = table.scopes.length;
      $('statDepth').textContent = table.maxDepth();
      $('statErrors').textContent = errors;
      $('statWarnings').textContent = warnings;
      const badge = $('diagBadge');
      badge.textContent = errors + warnings;
      badge.classList.toggle('has', errors > 0);

      syncGutter();
      markGutter(diags);

      statusEl.textContent = `${lex.tokens.length} tokens, ${symCount} symbols, ${table.scopes.length} scopes, ${errors} error(s), ${warnings} warning(s).`;
      statusEl.className = 'status ' + (errors ? 'err' : 'ok');
    } catch (err) {
      statusEl.textContent = 'Internal error: ' + err.message;
      statusEl.className = 'status err';
      console.error(err);
    }
  }

  /* ---------------- export ---------------- */
  function download(filename, text, mime) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 500);
  }

  function exportJson() {
    if (!last) return;
    const plain = scope => ({
      id: scope.id, label: scope.label, kind: scope.kind, level: scope.level,
      lines: [scope.openLine, scope.closeLine], sizeBytes: scope.frameSize,
      symbols: Array.from(scope.symbols.values()).map(s => ({
        name: s.name, type: s.type + (s.dims || ''), kind: s.kind, line: s.line,
        size: s.size, segment: s.segment, offset: s.offset, references: s.refs
      })),
      children: scope.children.map(plain)
    });
    download('symbol-table.json', JSON.stringify(plain(last.table.root), null, 2), 'application/json');
  }

  function exportCsv() {
    if (!last) return;
    const q = v => `"${String(v).replace(/"/g, '""')}"`;
    const head = ['name', 'type', 'kind', 'scope', 'level', 'line', 'size', 'segment', 'offset', 'refs'];
    const rows = last.table.allSymbols().map(s => [
      s.name, s.type + (s.dims || ''), s.kind, s.scopeLabel, s.scopeLevel, s.line,
      s.size, s.segment, s.offset === null ? '' : s.offset, s.refCount
    ].map(q).join(','));
    download('symbol-table.csv', [head.join(',')].concat(rows).join('\n'), 'text/csv');
  }

  /* ---------------- event wiring ---------------- */
  function loadExample(key) {
    sourceEl.value = EXAMPLES[key] || '';
    syncGutter();
    compile();
  }

  $('exampleSelect').addEventListener('change', e => loadExample(e.target.value));
  $('compileBtn').addEventListener('click', compile);
  $('exportJson').addEventListener('click', exportJson);
  $('exportCsv').addEventListener('click', exportCsv);
  $('lookupForm').addEventListener('submit', e => { e.preventDefault(); resolveLookup(); });

  $('fileInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { sourceEl.value = reader.result; syncGutter(); compile(); };
    reader.readAsText(file);
  });

  sourceEl.addEventListener('input', () => {
    syncGutter();
    if ($('autoBox').checked) { clearTimeout(compile.timer); compile.timer = setTimeout(compile, 350); }
  });
  sourceEl.addEventListener('scroll', () => { gutterEl.scrollTop = sourceEl.scrollTop; });
  sourceEl.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); compile(); }
    if (e.key === 'Tab') {   // insert 4 spaces instead of leaving the textarea
      e.preventDefault();
      const s = sourceEl.selectionStart;
      sourceEl.value = sourceEl.value.slice(0, s) + '    ' + sourceEl.value.slice(sourceEl.selectionEnd);
      sourceEl.selectionStart = sourceEl.selectionEnd = s + 4;
      syncGutter();
    }
  });

  $('tabs').addEventListener('click', e => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.add('active');
  });

  // one delegated listener handles clicks on any row with a line number
  document.querySelector('.tab-panels').addEventListener('click', e => {
    const row = e.target.closest('.jump');
    if (row) flashLine(parseInt(row.dataset.line, 10));
  });
  document.querySelector('.tab-panels').addEventListener('input', e => {
    if (!last) return;
    if (e.target.id === 'symFilter') {
      const pos = e.target.selectionStart;
      $('tab-table').innerHTML = renderSymbolTable(last.table, e.target.value);
      const box = $('symFilter'); box.focus(); box.setSelectionRange(pos, pos);
    }
  });
  document.querySelector('.tab-panels').addEventListener('change', e => {
    if (e.target.id === 'tokenFilter' && last) $('tab-tokens').innerHTML = renderTokens(last.tokens, e.target.value);
  });

  loadExample('basic');
})();
