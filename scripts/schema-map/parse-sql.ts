// Replays supabase/migrations/*.sql in order and keeps the *current* set of
// policies, triggers, functions, views and table constraints. The generated
// types.ts is the source of truth for tables/columns/FKs; this file adds the
// things the type generator does not know about (RLS, triggers, function
// bodies, cross-schema FKs like auth.users, primary/unique keys).
//
// It is a pragmatic statement classifier, not a full SQL parser. Anything it
// does not recognise is ignored.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Policy, SqlFunction, Trigger } from './model.ts';

export type MigFk = { name: string; fromCols: string[]; toSchema: string; to: string; toCols: string[]; source: string };
export type MigUnique = { name?: string; cols: string[] };
export type MigTable = {
  name: string;
  columns: string[];
  /** column -> declared SQL type (lowercased, schema stripped) */
  columnTypes: Record<string, string>;
  pk: string[];
  uniques: MigUnique[];
  fks: MigFk[];
  rlsEnabled: boolean;
  sources: string[];
};
export type MigView = { name: string; securityInvoker: boolean; source: string };

export type MigrationState = {
  tables: Map<string, MigTable>;
  policies: Map<string, Policy>;
  triggers: Map<string, Trigger>;
  functions: Map<string, SqlFunction>;
  views: Map<string, MigView>;
  files: string[];
};

// ---------------------------------------------------------------- splitting

/** Split SQL into statements on top-level semicolons, stripping comments. */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === '-' && next === '-') { // line comment
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') { // block comment
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === "'") { // string literal ('' escapes)
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") break;
        j++;
      }
      buf += sql.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '"') { // quoted identifier
      const end = sql.indexOf('"', i + 1);
      const j = end === -1 ? n - 1 : end;
      buf += sql.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '$') { // dollar quote
      const m = sql.slice(i, i + 64).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        const j = end === -1 ? n : end + tag.length;
        buf += sql.slice(i, j); i = j; continue;
      }
    }
    if (c === ';') {
      if (buf.trim()) out.push(buf.trim());
      buf = ''; i++; continue;
    }
    buf += c; i++;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

// ---------------------------------------------------------------- helpers

const ws = (s: string) => s.replace(/\s+/g, ' ').trim();
const unq = (s: string) => s.trim().replace(/^"(.*)"$/, '$1');

/** "public.users" -> {schema:'public', name:'users'}; "auth.users" keeps schema. */
function qualified(raw: string): { schema: string; name: string } {
  const parts = raw.trim().split('.').map(unq);
  if (parts.length >= 2) return { schema: parts[parts.length - 2].toLowerCase(), name: parts[parts.length - 1] };
  return { schema: 'public', name: parts[0] };
}
/** Display key: bare name for public, schema-qualified otherwise. */
export function tableKey(raw: string): string {
  const q = qualified(raw);
  return q.schema === 'public' ? q.name : `${q.schema}.${q.name}`;
}

/** Returns the text inside the parenthesis that starts at `start`, and the index after it. */
function balanced(s: string, start: number): { inner: string; end: number } | null {
  if (s[start] !== '(') return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === "'" && s[i + 1] === "'") { i++; continue; } if (c === "'") inStr = false; continue; }
    if (c === "'") { inStr = true; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return { inner: s.slice(start + 1, i), end: i + 1 }; }
  }
  return null;
}

/** Split on commas at paren depth 0. */
function splitTopLevel(s: string): string[] {
  const items: string[] = [];
  let depth = 0, buf = '', inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { buf += c; if (c === "'" && s[i + 1] === "'") { buf += s[++i]; continue; } if (c === "'") inStr = false; continue; }
    if (c === "'") { inStr = true; buf += c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { items.push(buf.trim()); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim()) items.push(buf.trim());
  return items;
}

const colList = (s: string) => splitTopLevel(s).map((c) => unq(c.split(/\s+/)[0])).filter(Boolean);

export const SQL_TABLE_REF = /\b(?:from|join|into|update|delete\s+from)\s+(?:only\s+)?("?[a-z_][a-z0-9_]*"?(?:\."?[a-z_][a-z0-9_]*"?)?)/gi;
export const SQL_CALL = /\b([a-z_][a-z0-9_]*)\s*\(/gi;

export function tableRefs(sql: string): string[] {
  const set = new Set<string>();
  for (const m of sql.matchAll(SQL_TABLE_REF)) set.add(tableKey(m[1]));
  return [...set];
}
export function callRefs(sql: string): string[] {
  const set = new Set<string>();
  for (const m of sql.matchAll(SQL_CALL)) set.add(m[1].toLowerCase());
  return [...set];
}

// ---------------------------------------------------------------- state

function newState(): MigrationState {
  return { tables: new Map(), policies: new Map(), triggers: new Map(), functions: new Map(), views: new Map(), files: [] };
}

function ensureTable(st: MigrationState, key: string, source: string): MigTable {
  let t = st.tables.get(key);
  if (!t) { t = { name: key, columns: [], columnTypes: {}, pk: [], uniques: [], fks: [], rlsEnabled: false, sources: [] }; st.tables.set(key, t); }
  if (!t.sources.includes(source)) t.sources.push(source);
  return t;
}

function renameTable(st: MigrationState, from: string, to: string) {
  const t = st.tables.get(from);
  if (t) { st.tables.delete(from); t.name = to; st.tables.set(to, t); }
  for (const other of st.tables.values()) for (const fk of other.fks) if (fk.to === from) fk.to = to;
  for (const [k, p] of [...st.policies]) if (p.table === from) { st.policies.delete(k); p.table = to; st.policies.set(`${to}::${p.name}`, p); }
  for (const [k, tr] of [...st.triggers]) if (tr.table === from) { st.triggers.delete(k); tr.table = to; st.triggers.set(`${to}::${tr.name}`, tr); }
}

function dropTable(st: MigrationState, key: string) {
  st.tables.delete(key);
  for (const [k, p] of [...st.policies]) if (p.table === key) st.policies.delete(k);
  for (const [k, tr] of [...st.triggers]) if (tr.table === key) st.triggers.delete(k);
}

// ---------------------------------------------------------------- column / constraint defs

function applyConstraintItem(t: MigTable, item: string, source: string, cname?: string) {
  let m: RegExpMatchArray | null;
  if ((m = item.match(/^primary key\s*\(([^)]*)\)/i))) { t.pk = colList(m[1]); return; }
  if ((m = item.match(/^unique\s*(?:nulls\s+(?:not\s+)?distinct\s*)?\(([^)]*)\)/i))) { t.uniques.push({ name: cname, cols: colList(m[1]) }); return; }
  if ((m = item.match(/^foreign key\s*\(([^)]*)\)\s*references\s+([a-z_."]+)\s*(?:\(([^)]*)\))?/i))) {
    const q = qualified(m[2]);
    const fromCols = colList(m[1]);
    t.fks.push({ name: cname ?? `${t.name}_${fromCols.join('_')}_fkey`, fromCols, toSchema: q.schema, to: tableKey(m[2]), toCols: m[3] ? colList(m[3]) : ['id'], source });
  }
}

function applyColumnDef(t: MigTable, item: string, source: string) {
  const m = item.match(/^("[^"]+"|[a-z_][a-z0-9_]*)\s+([\s\S]*)$/i);
  if (!m) return;
  const col = unq(m[1]);
  const rest = m[2];
  if (!t.columns.includes(col)) t.columns.push(col);
  const typeTok = rest.match(/^([a-z_]+(?:\.[a-z_]+)?(?:\s*\([^)]*\))?(?:\[\])?)/i);
  if (typeTok) t.columnTypes[col] = typeTok[1].toLowerCase().replace(/^public\./, '').replace(/\s+/g, '');
  if (/\bunique\b/i.test(rest)) t.uniques.push({ cols: [col] });
  const ref = rest.match(/(?:constraint\s+("[^"]+"|\S+)\s+)?references\s+([a-z_."]+)\s*(?:\(([^)]*)\))?/i);
  if (ref) {
    const q = qualified(ref[2]);
    t.fks.push({ name: ref[1] ? unq(ref[1]) : `${t.name}_${col}_fkey`, fromCols: [col], toSchema: q.schema, to: tableKey(ref[2]), toCols: ref[3] ? colList(ref[3]) : ['id'], source });
  }
}

function applyTableBodyItem(t: MigTable, item: string, source: string) {
  const c = item.match(/^constraint\s+("[^"]+"|\S+)\s+([\s\S]*)$/i);
  if (c) { applyConstraintItem(t, c[2], source, unq(c[1])); return; }
  if (/^(primary key|unique|foreign key)\b/i.test(item)) { applyConstraintItem(t, item, source); return; }
  if (/^(check|exclude|like)\b/i.test(item)) return;
  applyColumnDef(t, item, source);
}

// ---------------------------------------------------------------- statement handlers

function handleCreateTable(st: MigrationState, stmt: string, source: string) {
  const m = stmt.match(/^create\s+(?:unlogged\s+|temp(?:orary)?\s+)?table\s+(?:if not exists\s+)?([a-z_."]+)\s*\(/i);
  if (!m) return;
  const key = tableKey(m[1]);
  if (qualified(m[1]).schema !== 'public') return;
  const b = balanced(stmt, stmt.indexOf('(', m[0].length - 1));
  if (!b) return;
  const t = ensureTable(st, key, source);
  for (const item of splitTopLevel(b.inner)) applyTableBodyItem(t, ws(item), source);
}

function handleAlterTable(st: MigrationState, stmt: string, source: string) {
  const m = stmt.match(/^alter table\s+(?:if exists\s+)?(?:only\s+)?([a-z_."]+)\s+([\s\S]*)$/i);
  if (!m) return;
  if (qualified(m[1]).schema !== 'public') return;
  let key = tableKey(m[1]);
  for (const rawAction of splitTopLevel(m[2])) {
    const action = ws(rawAction);
    let a: RegExpMatchArray | null;
    if ((a = action.match(/^rename to\s+("[^"]+"|\S+)$/i))) { const to = unq(a[1]); renameTable(st, key, to); key = to; continue; }
    const t = ensureTable(st, key, source);
    if (/^enable row level security$/i.test(action)) { t.rlsEnabled = true; continue; }
    if (/^disable row level security$/i.test(action)) { t.rlsEnabled = false; continue; }
    if ((a = action.match(/^rename(?: column)?\s+("[^"]+"|\S+)\s+to\s+("[^"]+"|\S+)$/i))) {
      const from = unq(a[1]), to = unq(a[2]);
      t.columns = t.columns.map((c) => (c === from ? to : c));
      if (t.columnTypes[from]) { t.columnTypes[to] = t.columnTypes[from]; delete t.columnTypes[from]; }
      t.pk = t.pk.map((c) => (c === from ? to : c));
      for (const u of t.uniques) u.cols = u.cols.map((c) => (c === from ? to : c));
      for (const fk of t.fks) fk.fromCols = fk.fromCols.map((c) => (c === from ? to : c));
      continue;
    }
    if ((a = action.match(/^add\s+(?:constraint\s+("[^"]+"|\S+)\s+)?((?:primary key|unique|foreign key)\b[\s\S]*)$/i))) { applyConstraintItem(t, a[2], source, a[1] ? unq(a[1]) : undefined); continue; }
    if ((a = action.match(/^add\s+(?:column\s+)?(?:if not exists\s+)?([\s\S]+)$/i)) && !/^add\s+(?:constraint|check|exclude)\b/i.test(action)) { applyColumnDef(t, a[1], source); continue; }
    if ((a = action.match(/^drop constraint\s+(?:if exists\s+)?("[^"]+"|\S+)/i))) {
      const name = unq(a[1]);
      t.fks = t.fks.filter((fk) => fk.name !== name);
      t.uniques = t.uniques.filter((u) => u.name !== name);
      continue;
    }
    if ((a = action.match(/^drop(?: column)?\s+(?:if exists\s+)?("[^"]+"|\S+)/i))) {
      const col = unq(a[1]);
      t.columns = t.columns.filter((c) => c !== col);
      t.fks = t.fks.filter((fk) => !fk.fromCols.includes(col));
      t.uniques = t.uniques.filter((u) => !u.cols.includes(col));
      continue;
    }
  }
}

function handleCreateIndex(st: MigrationState, stmt: string, source: string) {
  const m = stmt.match(/^create\s+(unique\s+)?index\s+(?:concurrently\s+)?(?:if not exists\s+)?("[^"]+"|\S+)\s+on\s+(?:only\s+)?([a-z_."]+)\s*(?:using\s+\w+\s*)?\(/i);
  if (!m || !m[1]) return;
  if (/\bwhere\b/i.test(stmt.slice(m[0].length))) return; // partial unique index: not a true uniqueness guarantee
  const b = balanced(stmt, m[0].length - 1);
  if (!b || /\(/.test(b.inner)) return; // expression index
  const t = ensureTable(st, tableKey(m[3]), source);
  t.uniques.push({ name: unq(m[2]), cols: colList(b.inner) });
}

function handleCreatePolicy(st: MigrationState, stmt: string, source: string) {
  const m = stmt.match(/^create policy\s+("(?:[^"]|"")+"|[a-z_][a-z0-9_]*)\s+on\s+([a-z_."]+)\s*([\s\S]*)$/i);
  if (!m) return;
  const name = unq(m[1]).replace(/""/g, '"');
  const table = tableKey(m[2]);
  const rest = m[3];
  const usingIdx = rest.search(/\busing\s*\(/i);
  const checkIdx = rest.search(/\bwith\s+check\s*\(/i);
  const cut = [usingIdx, checkIdx].filter((i) => i >= 0);
  const header = ws(cut.length ? rest.slice(0, Math.min(...cut)) : rest);
  const asM = header.match(/\bas\s+(permissive|restrictive)\b/i);
  const forM = header.match(/\bfor\s+(all|select|insert|update|delete)\b/i);
  const toM = header.match(/\bto\s+([\s\S]+?)(?:\s+(?:as|for)\b|$)/i);
  let using: string | undefined, check: string | undefined;
  if (usingIdx >= 0) { const b = balanced(rest, rest.indexOf('(', usingIdx)); if (b) using = ws(b.inner); }
  if (checkIdx >= 0) { const b = balanced(rest, rest.indexOf('(', checkIdx)); if (b) check = ws(b.inner); }
  const exprs = [using, check].filter(Boolean).join(' ');
  const p: Policy = {
    name, table,
    command: (forM ? forM[1].toUpperCase() : 'ALL') as Policy['command'],
    permissive: !asM || asM[1].toLowerCase() === 'permissive',
    roles: toM ? toM[1].split(',').map((r) => unq(r)) : ['public'],
    using, check,
    helpers: callRefs(exprs),
    tables: tableRefs(exprs),
    source,
  };
  st.policies.set(`${table}::${name}`, p);
}

function handleDropPolicy(st: MigrationState, stmt: string) {
  const m = stmt.match(/^drop policy\s+(?:if exists\s+)?("(?:[^"]|"")+"|[a-z_][a-z0-9_]*)\s+on\s+([a-z_."]+)/i);
  if (!m) return;
  st.policies.delete(`${tableKey(m[2])}::${unq(m[1]).replace(/""/g, '"')}`);
}

function handleCreateTrigger(st: MigrationState, stmt: string, source: string) {
  const m = stmt.match(/^create\s+(?:or replace\s+)?(?:constraint\s+)?trigger\s+("[^"]+"|[a-z_][a-z0-9_]*)\s+(before|after|instead of)\s+([\s\S]+?)\s+on\s+([a-z_."]+)([\s\S]*)$/i);
  if (!m) return;
  const rest = m[5];
  const fn = rest.match(/execute\s+(?:function|procedure)\s+([a-z_."]+)\s*\(/i);
  const table = tableKey(m[4]);
  const name = unq(m[1]);
  st.triggers.set(`${table}::${name}`, {
    name, table,
    timing: m[2].toUpperCase(),
    events: m[3].split(/\s+or\s+/i).map((e) => e.trim().split(/\s+/)[0].toUpperCase()),
    forEach: /for each row/i.test(rest) ? 'ROW' : 'STATEMENT',
    fn: fn ? qualified(fn[1]).name : '?',
    source,
  });
}

function handleDropTrigger(st: MigrationState, stmt: string) {
  const m = stmt.match(/^drop trigger\s+(?:if exists\s+)?("[^"]+"|[a-z_][a-z0-9_]*)\s+on\s+([a-z_."]+)/i);
  if (m) st.triggers.delete(`${tableKey(m[2])}::${unq(m[1])}`);
}

function handleCreateFunction(st: MigrationState, stmt: string, source: string) {
  const m = stmt.match(/^create\s+(?:or replace\s+)?function\s+([a-z_."]+)\s*\(/i);
  if (!m) return;
  const name = qualified(m[1]).name;
  const argsB = balanced(stmt, m[0].length - 1);
  const after = argsB ? stmt.slice(argsB.end) : '';
  const returns = after.match(/^\s*returns\s+(setof\s+)?(table\s*\([^)]*\)|[a-z_.\[\]]+(?:\s*\([^)]*\))?)/i);
  const lang = after.match(/\blanguage\s+([a-z_]+)/i);
  const body = stmt.match(/\$([A-Za-z_][A-Za-z0-9_]*)?\$([\s\S]*?)\$\1\$/);
  const bodyText = body ? body[2] : '';
  st.functions.set(name, {
    name,
    args: argsB ? ws(argsB.inner) : '',
    returns: returns ? ws((returns[1] ?? '') + returns[2]) : '',
    language: lang ? lang[1].toLowerCase() : '',
    securityDefiner: /\bsecurity\s+definer\b/i.test(after.replace(body?.[0] ?? '', '')),
    tables: tableRefs(bodyText),
    calls: callRefs(bodyText).filter((c) => c !== name),
    inTypes: false,
    inMigrations: true,
    source,
  });
}

function handleDropFunction(st: MigrationState, stmt: string) {
  const m = stmt.match(/^drop function\s+(?:if exists\s+)?([\s\S]+)$/i);
  if (!m) return;
  for (const part of splitTopLevel(m[1])) {
    const nm = part.match(/^([a-z_."]+)/i);
    if (nm) st.functions.delete(qualified(nm[1]).name);
  }
}

function handleCreateView(st: MigrationState, stmt: string, source: string) {
  const m = stmt.match(/^create\s+(?:or replace\s+)?(?:temp(?:orary)?\s+)?(?:materialized\s+)?view\s+([a-z_."]+)\s*(?:\([^)]*\)\s*)?(?:with\s*\(([^)]*)\)\s*)?as\b/i);
  if (!m) return;
  const name = tableKey(m[1]);
  st.views.set(name, { name, securityInvoker: /security_invoker\s*=?\s*(true|on)?/i.test(m[2] ?? ''), source });
}

function handleDropView(st: MigrationState, stmt: string) {
  const m = stmt.match(/^drop\s+(?:materialized\s+)?view\s+(?:if exists\s+)?([a-z_."]+)/i);
  if (m) st.views.delete(tableKey(m[1]));
}

function handleDropTable(st: MigrationState, stmt: string) {
  const m = stmt.match(/^drop table\s+(?:if exists\s+)?([\s\S]+?)(?:\s+(?:cascade|restrict))?$/i);
  if (!m) return;
  for (const part of splitTopLevel(m[1])) dropTable(st, tableKey(part));
}

export function applyStatement(st: MigrationState, stmt: string, source: string) {
  const head = ws(stmt.slice(0, 80)).toLowerCase();
  if (head.startsWith('create policy')) return handleCreatePolicy(st, stmt, source);
  if (head.startsWith('drop policy')) return handleDropPolicy(st, stmt);
  if (/^create (or replace )?(constraint )?trigger/.test(head)) return handleCreateTrigger(st, stmt, source);
  if (head.startsWith('drop trigger')) return handleDropTrigger(st, stmt);
  if (/^create (or replace )?function/.test(head)) return handleCreateFunction(st, stmt, source);
  if (head.startsWith('drop function')) return handleDropFunction(st, stmt);
  if (/^create (unlogged |temp(orary)? )?table/.test(head)) return handleCreateTable(st, stmt, source);
  if (head.startsWith('alter table')) return handleAlterTable(st, stmt, source);
  if (head.startsWith('drop table')) return handleDropTable(st, stmt);
  if (/^create (unique )?index/.test(head)) return handleCreateIndex(st, stmt, source);
  if (/^create (or replace )?(temp(orary)? )?(materialized )?view/.test(head)) return handleCreateView(st, stmt, source);
  if (/^drop (materialized )?view/.test(head)) return handleDropView(st, stmt);
}

export function replayMigrations(dir: string): MigrationState {
  const st = newState();
  let files: string[] = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort(); } catch { return st; }
  for (const f of files) {
    st.files.push(f);
    const sql = readFileSync(join(dir, f), 'utf8');
    for (const stmt of splitStatements(sql)) applyStatement(st, stmt, f);
  }
  return st;
}
