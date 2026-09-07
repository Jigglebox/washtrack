// "What changed since last time": diff the current graph against a baseline
// schema.json (by default the last committed one), so that after Lovable makes
// a change you can see exactly which tables, rules, functions and code paths
// appeared, disappeared or changed, and which review findings apply to the new
// pieces.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import type { ChangeSet, SchemaGraph } from './model.ts';

export function loadBaseline(root: string, outSchemaPath: string, opt: { file?: string; ref?: string }): { graph: SchemaGraph; label: string } | null {
  if (opt.file) {
    if (!existsSync(opt.file)) return null;
    return { graph: JSON.parse(readFileSync(opt.file, 'utf8')), label: opt.file };
  }
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim();
    const rel = relative(top, outSchemaPath).split('\\').join('/');
    const ref = opt.ref ?? 'HEAD';
    const text = execFileSync('git', ['show', `${ref}:${rel}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const sha = execFileSync('git', ['rev-parse', '--short', ref], { cwd: root, encoding: 'utf8' }).trim();
    return { graph: JSON.parse(text), label: `git ${ref} (${sha})` };
  } catch {
    return null;
  }
}

export function diffGraphs(before: SchemaGraph, after: SchemaGraph, label: string): ChangeSet {
  const cs: ChangeSet = { baseline: label, added: [], removed: [], changed: [] };
  const byName = <T extends { name: string }>(xs: T[], key: (x: T) => string = (x) => x.name) => new Map(xs.map((x) => [key(x), x]));

  // Tables and columns
  const tb = byName(before.tables ?? []), ta = byName(after.tables ?? []);
  for (const [n, t] of ta) if (!tb.has(n)) cs.added.push({ kind: t.kind, name: n, detail: `${t.columns.length} columns` });
  for (const [n, t] of tb) if (!ta.has(n)) cs.removed.push({ kind: t.kind, name: n });
  for (const [n, t] of ta) {
    const b = tb.get(n);
    if (!b) continue;
    const bc = new Set(b.columns.map((c) => c.name)), ac = new Set(t.columns.map((c) => c.name));
    for (const c of ac) if (!bc.has(c)) cs.added.push({ kind: 'column', name: `${n}.${c}`, table: n });
    for (const c of bc) if (!ac.has(c)) cs.removed.push({ kind: 'column', name: `${n}.${c}`, table: n });
    if (b.rlsEnabled !== t.rlsEnabled) cs.changed.push({ kind: 'table', name: n, table: n, detail: `access rules switched ${t.rlsEnabled ? 'on' : 'off'}` });
  }

  // Relationships (declared/external only; inferred ones follow columns)
  const relKey = (r: SchemaGraph['relationships'][number]) => `${r.kind}|${r.from}.${r.fromCols.join(',')}→${r.to}`;
  const rb = new Set((before.relationships ?? []).filter((r) => r.kind !== 'inferred').map(relKey)), ra = new Set((after.relationships ?? []).filter((r) => r.kind !== 'inferred').map(relKey));
  for (const k of ra) if (!rb.has(k)) cs.added.push({ kind: 'link', name: k.split('|')[1], table: k.split('|')[1].split('.')[0] });
  for (const k of rb) if (!ra.has(k)) cs.removed.push({ kind: 'link', name: k.split('|')[1], table: k.split('|')[1].split('.')[0] });

  // Policies
  const pk = (p: SchemaGraph['policies'][number]) => `${p.table}::${p.name}`;
  const pb = byName(before.policies ?? [], pk), pa = byName(after.policies ?? [], pk);
  for (const [k, p] of pa) if (!pb.has(k)) cs.added.push({ kind: 'access rule', name: p.name, table: p.table, detail: `${p.command} for ${p.roles.join(', ')}${p.helpers.length ? ` via ${p.helpers.join(', ')}` : ''}` });
  for (const [k, p] of pb) if (!pa.has(k)) cs.removed.push({ kind: 'access rule', name: p.name, table: p.table });
  for (const [k, p] of pa) {
    const b = pb.get(k);
    if (b && (b.using !== p.using || b.check !== p.check || b.command !== p.command || b.roles.join() !== p.roles.join())) cs.changed.push({ kind: 'access rule', name: p.name, table: p.table, detail: 'condition, command or roles changed' });
  }

  // Triggers
  const tk = (t: SchemaGraph['triggers'][number]) => `${t.table}::${t.name}`;
  const trb = byName(before.triggers ?? [], tk), tra = byName(after.triggers ?? [], tk);
  for (const [k, t] of tra) if (!trb.has(k)) cs.added.push({ kind: 'automatic action', name: t.name, table: t.table, detail: `${t.timing} ${t.events.join('/')} → ${t.fn}()` });
  for (const [k, t] of trb) if (!tra.has(k)) cs.removed.push({ kind: 'automatic action', name: t.name, table: t.table });

  // Functions
  const fb = byName(before.functions ?? []), fa = byName(after.functions ?? []);
  for (const [n, f] of fa) if (!fb.has(n)) cs.added.push({ kind: 'database function', name: n, detail: `${f.securityDefiner ? 'privileged, ' : ''}touches ${f.tables.join(', ') || 'nothing'}` });
  for (const [n] of fb) if (!fa.has(n)) cs.removed.push({ kind: 'database function', name: n });
  for (const [n, f] of fa) {
    const b = fb.get(n);
    if (b && (b.args !== f.args || b.returns !== f.returns || b.tables.join() !== f.tables.join() || b.securityDefiner !== f.securityDefiner)) cs.changed.push({ kind: 'database function', name: n, detail: 'signature, privilege or tables touched changed' });
  }

  // Code
  const cb = byName(before.codeRefs ?? [], (r) => r.file), ca = byName(after.codeRefs ?? [], (r) => r.file);
  for (const [f, r] of ca) if (!cb.has(f)) cs.added.push({ kind: r.kind === 'edge-function' ? 'edge function' : 'code file', name: f, detail: `uses ${[...r.tables, ...r.rpcs.map((x) => x + '()')].join(', ') || 'no tables'}` });
  for (const [f, r] of cb) if (!ca.has(f)) cs.removed.push({ kind: r.kind === 'edge-function' ? 'edge function' : 'code file', name: f });
  for (const [f, r] of ca) {
    const b = cb.get(f);
    if (!b) continue;
    const added = r.tables.filter((t) => !b.tables.includes(t)), removed = b.tables.filter((t) => !r.tables.includes(t));
    if (added.length || removed.length) cs.changed.push({ kind: 'code file', name: f, detail: [added.length ? `now uses ${added.join(', ')}` : '', removed.length ? `no longer uses ${removed.join(', ')}` : ''].filter(Boolean).join('; ') });
    const ra2 = (r.routes ?? []).map((x) => `${x.path}|${x.guard}|${x.roles.join()}`), rb2 = (b.routes ?? []).map((x) => `${x.path}|${x.guard}|${x.roles.join()}`);
    for (const x of ra2) if (!rb2.includes(x)) cs.added.push({ kind: 'route', name: x.split('|')[0], detail: x.split('|')[1] === 'roles' ? `guarded: ${x.split('|')[2]}` : `guard: ${x.split('|')[1]}` });
    for (const x of rb2) if (!ra2.includes(x)) cs.removed.push({ kind: 'route', name: x.split('|')[0] });
  }

  // Enums
  const eb = byName(before.enums ?? []), ea = byName(after.enums ?? []);
  for (const [n, e] of ea) {
    const b = eb.get(n);
    if (!b) { cs.added.push({ kind: 'value list', name: n, detail: e.values.join(', ') }); continue; }
    for (const v of e.values) if (!b.values.includes(v)) cs.added.push({ kind: 'value', name: `${n}.${v}` });
    for (const v of b.values) if (!e.values.includes(v)) cs.removed.push({ kind: 'value', name: `${n}.${v}` });
  }
  return cs;
}
