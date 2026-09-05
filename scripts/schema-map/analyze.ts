// Turns the raw parser output into one SchemaGraph: merges sources, dedupes
// FKs, detects junction tables, infers undeclared relationships, finds hub
// tables, clusters the graph into domains, and collects drift warnings.

import type { Cluster, CodeRef, LiveInfo, PolymorphicRef, Relationship, SchemaGraph, SqlFunction, Table } from './model.ts';
import type { LiveSnapshot } from './live-db.ts';
import type { ParsedTypes } from './parse-types.ts';
import type { MigrationState } from './parse-sql.ts';

export type AnalyzeContext = {
  /** Migrations from the repo, for "is this defined in a migration?" when the primary source is the live database */
  staticMig: MigrationState;
  live: LiveInfo;
  liveSnapshot?: LiveSnapshot;
  extraWarnings?: string[];
};

export type AnalyzeOptions = {
  /** A table is a hub when at least this fraction of other tables reference it */
  hubRatio: number;
  /** ...and at least this many tables reference it */
  minHubDegree: number;
};

const META_COLS = new Set(['id', 'created_at', 'updated_at', 'created_by', 'updated_by']);
const PEOPLE_WORDS = new Set([
  'user', 'employee', 'manager', 'owner', 'author', 'reviewer', 'approver', 'assignee', 'requester', 'creator',
  'created', 'updated', 'changed', 'approved', 'rejected', 'assigned', 'requested', 'reviewed', 'deleted', 'submitted',
  'performed', 'resolved', 'completed', 'verified', 'invited', 'uploaded', 'processed', 'reported', 'cancelled', 'canceled',
]);

const setEq = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const uniq = <T>(xs: T[]) => [...new Set(xs)];

export function buildGraph(types: ParsedTypes, mig: MigrationState, codeRefs: CodeRef[], opts: AnalyzeOptions, ctx: AnalyzeContext): SchemaGraph {
  const warnings: string[] = [...(ctx.extraWarnings ?? [])];
  const isLive = !!ctx.liveSnapshot;
  const primary = isLive ? 'live database' : 'types.ts';
  const tables = new Map<string, Table>();

  // ---- tables & views (types.ts is the source of truth for what exists)
  for (const e of types.entities) {
    const m = mig.tables.get(e.name);
    const colNames = e.columns.map((c) => c.name);
    let pk = m?.pk.filter((c) => colNames.includes(c)) ?? [];
    if (!pk.length && colNames.includes('id')) pk = ['id'];
    tables.set(e.name, {
      name: e.name,
      kind: e.kind,
      columns: e.columns.map((c) => ({ ...c })),
      pk,
      uniques: (m?.uniques ?? []).map((u) => u.cols).filter((cols) => cols.every((c) => colNames.includes(c))),
      rlsEnabled: m?.rlsEnabled ?? false,
      isJunction: false,
      isHub: false,
      inboundDegree: 0,
      sources: uniq([primary, ...(ctx.staticMig.tables.get(e.name)?.sources ?? [])]),
      rowCount: ctx.liveSnapshot?.rowCounts[e.name],
      viewDefinition: ctx.liveSnapshot?.views[e.name]?.definition,
      viewTables: ctx.liveSnapshot?.views[e.name]?.tables,
      comment: ctx.liveSnapshot?.comments[e.name],
    });
    if (!isLive) {
      if (e.kind === 'table' && !m) warnings.push(`Table \`${e.name}\` is in types.ts but no migration creates it (created via the dashboard, or a migration was skipped).`);
      if (e.kind === 'view' && !mig.views.has(e.name)) warnings.push(`View \`${e.name}\` is in types.ts but no migration defines it (defined via the dashboard).`);
    }
  }
  if (!isLive) for (const [name] of mig.tables) {
    if (!tables.has(name) && !name.includes('.')) warnings.push(`Migrations create table \`${name}\` but it is missing from types.ts (types.ts is stale, or the table was dropped via the dashboard).`);
  }

  // ---- declared relationships (dedupe: the generator repeats each FK for every view over the target)
  const relationships: Relationship[] = [];
  const declaredKeys = new Set<string>();
  const fkCols = new Map<string, Set<string>>(); // table -> columns covered by a declared/external FK
  const markFk = (t: string, cols: string[]) => { if (!fkCols.has(t)) fkCols.set(t, new Set()); for (const c of cols) fkCols.get(t)!.add(c); };

  for (const e of types.entities) {
    if (e.kind !== 'table') continue;
    const byName = new Map<string, typeof e.relationships>();
    for (const r of e.relationships) { if (!byName.has(r.foreignKeyName)) byName.set(r.foreignKeyName, []); byName.get(r.foreignKeyName)!.push(r); }
    for (const [name, variants] of byName) {
      const pick = variants.find((v) => tables.get(v.referencedRelation)?.kind === 'table') ?? variants[0];
      const cols = pick.columns;
      const optional = cols.every((c) => e.columns.find((x) => x.name === c)?.nullable ?? false);
      relationships.push({ name, from: e.name, fromCols: cols, to: pick.referencedRelation, toCols: pick.referencedColumns, oneToOne: pick.isOneToOne, optional, kind: 'declared' });
      declaredKeys.add(`${e.name}|${cols.join(',')}|${pick.referencedRelation}`);
      markFk(e.name, cols);
    }
  }

  // ---- FKs the generator cannot see: cross-schema targets (auth.users) + drift check
  for (const mt of mig.tables.values()) {
    if (!tables.has(mt.name)) continue;
    for (const fk of mt.fks) {
      if (fk.toSchema !== 'public') {
        if (!tables.has(fk.to)) {
          tables.set(fk.to, { name: fk.to, kind: 'table', columns: fk.toCols.map((c) => ({ name: c, type: 'uuid', nullable: false, isPk: true, isFk: false, isUnique: false })), pk: fk.toCols, uniques: [], rlsEnabled: true, isJunction: false, isHub: false, inboundDegree: 0, sources: ['external'] });
        }
        const src = tables.get(mt.name)!;
        const optional = fk.fromCols.every((c) => src.columns.find((x) => x.name === c)?.nullable ?? false);
        relationships.push({ name: fk.name, from: mt.name, fromCols: fk.fromCols, to: fk.to, toCols: fk.toCols, oneToOne: false, optional, kind: 'external', note: `defined in ${fk.source}` });
        markFk(mt.name, fk.fromCols);
      } else if (!isLive && tables.has(fk.to) && !declaredKeys.has(`${mt.name}|${fk.fromCols.join(',')}|${fk.to}`)) {
        warnings.push(`FK \`${fk.name}\` (${mt.name}.${fk.fromCols.join(',')} -> ${fk.to}) is in migrations but not in types.ts. It may have been dropped, or types.ts is stale.`);
      }
    }
  }

  // ---- mark key columns
  for (const t of tables.values()) {
    for (const c of t.columns) {
      c.isPk = t.pk.includes(c.name);
      c.isFk = fkCols.get(t.name)?.has(c.name) ?? false;
      c.isUnique = t.uniques.some((u) => u.length === 1 && u[0] === c.name);
    }
  }

  // ---- junction tables -> M:N relationships
  for (const t of tables.values()) {
    if (t.kind !== 'table') continue;
    const fks = relationships.filter((r) => r.from === t.name && (r.kind === 'declared' || r.kind === 'external'));
    if (fks.length < 2) continue;
    for (let i = 0; i < fks.length; i++) for (let j = i + 1; j < fks.length; j++) {
      const pair = uniq([...fks[i].fromCols, ...fks[j].fromCols]);
      const keyed = setEq(t.pk, pair) || t.uniques.some((u) => setEq(u, pair));
      const extra = t.columns.filter((c) => !pair.includes(c.name) && !META_COLS.has(c.name));
      if (keyed && extra.length <= 2) {
        t.isJunction = true;
        relationships.push({ name: `${t.name}_m2m`, from: fks[i].to, fromCols: fks[i].fromCols, to: fks[j].to, toCols: fks[j].fromCols, oneToOne: false, optional: false, kind: 'junction', via: t.name });
      }
    }
  }

  // ---- inferred relationships from column names
  const tableNames = [...tables.keys()];
  const people = ['users', 'profiles', 'employees', 'user_profiles'].find((n) => tables.get(n)?.kind === 'table');
  const resolve = (base: string, self: string): string | undefined => {
    const cands = [base, `${base}s`, `${base}es`, base.replace(/y$/, 'ies'), base.replace(/_id$/, '')];
    for (const c of cands) if (tables.get(c)?.kind === 'table') return c;
    if (base === 'parent') return self;
    const last = base.split('_').pop()!;
    if (people && (PEOPLE_WORDS.has(base) || PEOPLE_WORDS.has(last))) return people;
    return undefined;
  };
  const polymorphic: PolymorphicRef[] = [];
  for (const t of tables.values()) {
    if (t.kind !== 'table' || t.sources.includes('external')) continue;
    const covered = fkCols.get(t.name) ?? new Set();
    const names = new Set(t.columns.map((c) => c.name));
    const sqlTypes = mig.tables.get(t.name)?.columnTypes ?? {};
    for (const c of t.columns) {
      if (covered.has(c.name)) continue;
      if (c.type !== 'string' && c.type !== 'uuid') continue;
      if (sqlTypes[c.name] && sqlTypes[c.name] !== 'uuid') continue;
      const m = c.name.match(/^(.+?)_(id|uuid)$/) ?? c.name.match(/^(.+?)_(by)$/);
      if (!m) continue;
      const base = m[1];
      // polymorphic: <x>_type + <x>_id, or table_name + record_id
      if (names.has(`${base}_type`) || (c.name === 'record_id' && names.has('table_name'))) {
        polymorphic.push({ table: t.name, typeCol: names.has(`${base}_type`) ? `${base}_type` : 'table_name', idCol: c.name });
        continue;
      }
      const target = resolve(m[2] === 'by' ? `${base}_by` : base, t.name) ?? (m[2] === 'by' ? resolve(base, t.name) : undefined);
      if (!target) continue;
      const tt = tables.get(target)!;
      if (!tt.pk.length) continue;
      relationships.push({ name: `${t.name}_${c.name}_inferred`, from: t.name, fromCols: [c.name], to: target, toCols: [tt.pk[0]], oneToOne: false, optional: c.nullable, kind: 'inferred', note: 'no FK constraint; matched by column name' });
    }
  }

  // ---- degrees & hubs
  const nonExternalTables = [...tables.values()].filter((t) => t.kind === 'table' && !t.sources.includes('external'));
  for (const t of tables.values()) {
    t.inboundDegree = uniq(relationships.filter((r) => r.to === t.name && r.from !== t.name && (r.kind === 'declared' || r.kind === 'external')).map((r) => r.from)).length;
  }
  const hubThreshold = Math.max(opts.minHubDegree, Math.ceil(opts.hubRatio * nonExternalTables.length));
  for (const t of tables.values()) t.isHub = t.inboundDegree >= hubThreshold;

  // ---- clustering (label propagation over non-hub tables)
  const clusters = clusterTables(tables, relationships);

  // ---- functions: merge migrations + types.ts
  const functions = new Map<string, SqlFunction>();
  for (const f of mig.functions.values()) functions.set(f.name, { ...f, tables: f.tables.filter((x) => tables.has(x)), inMigrations: ctx.staticMig.functions.has(f.name) });
  for (const f of types.functions) {
    const existing = functions.get(f.name);
    if (existing) { existing.inTypes = true; if (!existing.returns) existing.returns = f.returns; continue; }
    functions.set(f.name, { name: f.name, args: f.args, returns: f.returns, language: '', securityDefiner: false, tables: [], calls: [], inTypes: true, inMigrations: ctx.staticMig.functions.has(f.name) });
    if (!isLive) warnings.push(`Function \`${f.name}\` is exposed in types.ts but no migration defines it (created via the dashboard).`);
  }
  for (const f of functions.values()) f.calls = f.calls.filter((c) => functions.has(c) && c !== f.name);

  // ---- policies & triggers (only for tables that still exist)
  const policies = [...mig.policies.values()].filter((p) => {
    if (tables.has(p.table) || p.table.startsWith('storage.')) return true;
    warnings.push(`Policy "${p.name}" targets \`${p.table}\`, which is not in types.ts.`);
    return false;
  }).map((p) => ({ ...p, helpers: p.helpers.filter((h) => functions.has(h)), tables: p.tables.filter((t) => tables.has(t) && t !== p.table) }));
  const triggers = [...mig.triggers.values()].filter((t) => {
    if (tables.has(t.table) || t.table.includes('.')) return true;
    warnings.push(`Trigger \`${t.name}\` targets \`${t.table}\`, which is not in types.ts.`);
    return false;
  });
  for (const t of nonExternalTables) {
    const n = policies.filter((p) => p.table === t.name).length;
    if (!t.rlsEnabled) warnings.push(isLive ? `Table \`${t.name}\` has RLS disabled: every API role can read and write it.` : `Table \`${t.name}\` has no RLS enabled in migrations: every API role can read and write it (unless enabled via the dashboard).`);
    else if (n === 0) warnings.push(`Table \`${t.name}\` has RLS enabled but no policies: only service-role and SECURITY DEFINER functions can reach it.`);
  }

  // ---- code refs (only known tables/rpcs; unknown ones are worth a warning)
  const refs = codeRefs.map((r) => {
    const where = isLive ? 'the live database' : 'types.ts';
    for (const t of r.tables) if (!tables.has(t)) warnings.push(`\`${r.file}\` queries \`${t}\`, which is not in ${where}.`);
    for (const f of r.rpcs) if (!functions.has(f)) warnings.push(`\`${r.file}\` calls rpc \`${f}\`, which is not in ${where}.`);
    return { ...r, tables: r.tables.filter((t) => tables.has(t)), rpcs: r.rpcs.filter((f) => functions.has(f)) };
  });

  const sortByName = <T extends { name: string }>(xs: T[]) => xs.sort((a, b) => a.name.localeCompare(b.name));
  return {
    generatedAt: new Date().toISOString(),
    live: ctx.live,
    tables: sortByName([...tables.values()]),
    relationships: relationships.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.name.localeCompare(b.name)),
    policies: policies.sort((a, b) => a.table.localeCompare(b.table) || a.name.localeCompare(b.name)),
    triggers: triggers.sort((a, b) => a.table.localeCompare(b.table) || a.name.localeCompare(b.name)),
    functions: sortByName([...functions.values()]),
    enums: types.enums,
    codeRefs: refs,
    clusters,
    polymorphic,
    warnings: uniq(warnings),
  };
}

// ---------------------------------------------------------------- clustering

function clusterTables(tables: Map<string, Table>, rels: Relationship[]): Cluster[] {
  const nodes = [...tables.values()].filter((t) => t.kind === 'table' && !t.isHub && !t.sources.includes('external')).map((t) => t.name).sort();
  const nodeSet = new Set(nodes);
  const weight: Record<Relationship['kind'], number> = { declared: 1, junction: 1, inferred: 0.5, external: 0 };
  const adj = new Map<string, Map<string, number>>();
  for (const n of nodes) adj.set(n, new Map());
  for (const r of rels) {
    if (!nodeSet.has(r.from) || !nodeSet.has(r.to) || r.from === r.to || !weight[r.kind]) continue;
    adj.get(r.from)!.set(r.to, (adj.get(r.from)!.get(r.to) ?? 0) + weight[r.kind]);
    adj.get(r.to)!.set(r.from, (adj.get(r.to)!.get(r.from) ?? 0) + weight[r.kind]);
  }
  const label = new Map(nodes.map((n) => [n, n]));
  for (let round = 0; round < 100; round++) {
    let changed = false;
    for (const n of nodes) {
      const score = new Map<string, number>();
      for (const [nb, w] of adj.get(n)!) score.set(label.get(nb)!, (score.get(label.get(nb)!) ?? 0) + w);
      if (!score.size) continue;
      const best = [...score.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
      if (best !== label.get(n)) { label.set(n, best); changed = true; }
    }
    if (!changed) break;
  }
  const groups = new Map<string, string[]>();
  for (const n of nodes) { const l = label.get(n)!; if (!groups.has(l)) groups.set(l, []); groups.get(l)!.push(n); }

  // Fold singleton clusters into the neighbour they are most connected to.
  for (const [l, members] of [...groups]) {
    if (members.length !== 1) continue;
    const n = members[0];
    const best = [...adj.get(n)!.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (!best) continue;
    const target = label.get(best[0])!;
    if (target === l) continue;
    groups.get(target)!.push(n); label.set(n, target); groups.delete(l);
  }

  const degree = (n: string) => tables.get(n)!.inboundDegree;
  const clusters: Cluster[] = [];
  const used = new Set<string>();
  const hubs = [...tables.values()].filter((t) => t.isHub).map((t) => t.name).sort();
  // Tables that only reference hubs become satellites of the hub they touch most.
  const hubSatellites = new Map<string, string[]>(hubs.map((h) => [h, [h]]));
  const standalone: string[] = [];
  for (const [l, members] of [...groups]) {
    if (members.length !== 1 || adj.get(members[0])!.size) continue;
    const n = members[0];
    const score = new Map<string, number>();
    for (const r of rels) {
      if (r.from === r.to) continue;
      const other = r.from === n ? r.to : r.to === n ? r.from : null;
      if (!other) continue;
      // Hubs first; tables that only hang off another schema (auth.users) group under that name.
      const w = hubs.includes(other) ? weight[r.kind] : r.kind === 'external' ? 0.1 : 0;
      if (w) score.set(other, (score.get(other) ?? 0) + w);
    }
    groups.delete(l);
    const best = [...score.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (!best) { standalone.push(n); continue; }
    if (!hubSatellites.has(best[0])) hubSatellites.set(best[0], []);
    hubSatellites.get(best[0])!.push(n);
  }
  for (const [h, members] of hubSatellites) { clusters.push({ name: h, tables: members.sort() }); used.add(h); }
  for (const members of [...groups.values()].sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]))) {
    const sorted = members.sort((a, b) => degree(b) - degree(a) || a.localeCompare(b));
    let name = sorted[0];
    for (let i = 2; used.has(name); i++) name = `${sorted[0]}-${i}`;
    used.add(name);
    clusters.push({ name, tables: [...members].sort() });
  }
  if (standalone.length) clusters.push({ name: 'standalone', tables: standalone.sort() });
  return clusters;
}
