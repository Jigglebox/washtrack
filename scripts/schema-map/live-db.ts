// Live database source: reads pg_catalog over a read-only connection and
// converts it into the same shapes the static parsers produce, so the rest of
// the pipeline does not care where the schema came from. Also diffs the live
// schema against the static sources to surface drift.
//
// Everything runs inside `BEGIN READ ONLY` with a statement timeout, and the
// client refuses to send anything but SELECT/WITH and transaction control.

import type { Policy, SqlFunction, Trigger } from './model.ts';
import { PgClient, parseConnectionString, type PgConfig } from './pg-client.ts';
import { callRefs, tableRefs, type MigrationState } from './parse-sql.ts';
import type { ParsedEntity, ParsedTypes } from './parse-types.ts';

export type LiveView = { definition: string; tables: string[]; securityInvoker: boolean };
export type LiveSnapshot = {
  host: string;
  database: string;
  serverVersion: string;
  types: ParsedTypes;
  mig: MigrationState;
  rowCounts: Record<string, number>;
  views: Record<string, LiveView>;
  comments: Record<string, string>;
};

const key = (schema: string, name: string) => (schema === 'public' ? name : `${schema}.${name}`);

/** "character varying(120)" -> varchar, "timestamp with time zone" -> timestamptz, "text[]" -> text_array */
export function sqlTypeToken(t: string): string {
  let s = t.toLowerCase().replace(/\([^)]*\)/g, '').trim();
  const isArray = s.endsWith('[]');
  s = s.replace(/\[\]$/, '').trim();
  const map: Record<string, string> = {
    'character varying': 'varchar', character: 'char', 'timestamp with time zone': 'timestamptz', 'timestamp without time zone': 'timestamp',
    'time with time zone': 'timetz', 'time without time zone': 'time', 'double precision': 'float8', integer: 'int4', bigint: 'int8', smallint: 'int2', boolean: 'bool',
  };
  s = map[s] ?? s;
  s = s.replace(/^public\./, '').replace(/[^a-z0-9_]/g, '_');
  return isArray ? `${s}_array` : s;
}

async function connectWithFallback(cfg: PgConfig): Promise<PgClient> {
  try { return await PgClient.connect(cfg); }
  catch (e) {
    // Some poolers reject startup `options`; the READ ONLY transaction still protects us.
    if (/option|startup parameter/i.test((e as Error).message)) return PgClient.connect({ ...cfg, options: [] });
    throw e;
  }
}

export async function fetchLive(url: string): Promise<LiveSnapshot> {
  const cfg = parseConnectionString(url);
  const client = await connectWithFallback(cfg);
  const q = async <T = Record<string, any>>(sql: string): Promise<T[]> => {
    const r = await client.query(`select coalesce(json_agg(t), '[]'::json) as rows from (${sql}) t`);
    return (r.rows[0]?.rows as T[]) ?? [];
  };
  try {
    await client.query('begin read only');
    await client.query("set local statement_timeout = '60s'");
    const [version] = await q<{ v: string }>(`select version() as v`);

    const rels = await q(`
      select n.nspname as schema, c.relname as name, c.relkind as kind, c.relrowsecurity as rls,
             greatest(c.reltuples, 0)::bigint as est_rows,
             (select s.n_live_tup from pg_stat_user_tables s where s.relid = c.oid) as live_rows,
             obj_description(c.oid, 'pg_class') as comment,
             case when c.relkind in ('v','m') then pg_get_viewdef(c.oid, true) end as view_def,
             array_to_string(c.reloptions, ',') as reloptions
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p','v','m')
      order by c.relname`);

    const cols = await q(`
      select c.relname as "table", a.attname as name, format_type(a.atttypid, a.atttypmod) as type, not a.attnotnull as nullable,
             (select t.typname from pg_type t where t.oid = a.atttypid and t.typtype = 'e') as enum_name
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p','v','m') and a.attnum > 0 and not a.attisdropped
      order by c.relname, a.attnum`);

    const cons = await q(`
      select con.conname as name, con.contype as type, n.nspname as schema, c.relname as "table",
             (select json_agg(a.attname order by k.ord) from unnest(con.conkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as cols,
             fn.nspname as ref_schema, fc.relname as ref_table,
             (select json_agg(a.attname order by k.ord) from unnest(con.confkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum) as ref_cols
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_class fc on fc.oid = con.confrelid
      left join pg_namespace fn on fn.oid = fc.relnamespace
      where n.nspname = 'public' and con.contype in ('p','u','f')
      order by c.relname, con.conname`);

    const uidx = await q(`
      select c.relname as "table", i.relname as name,
             (select json_agg(a.attname order by k.ord) from unnest(string_to_array(x.indkey::text, ' ')::int2[]) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = x.indrelid and a.attnum = k.attnum) as cols
      from pg_index x
      join pg_class c on c.oid = x.indrelid
      join pg_class i on i.oid = x.indexrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and x.indisunique and not x.indisprimary and x.indpred is null and x.indexprs is null
        and not exists (select 1 from pg_constraint con where con.conindid = x.indexrelid)`);

    const policies = await q(`
      select schemaname as schema, tablename as "table", policyname as name, permissive, roles, cmd, qual as using, with_check as "check"
      from pg_policies where schemaname in ('public', 'storage') order by tablename, policyname`);

    const triggers = await q(`
      select t.tgname as name, n.nspname as schema, c.relname as "table", p.proname as fn, t.tgtype
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
      where not t.tgisinternal and n.nspname in ('public', 'auth', 'storage')
      order by c.relname, t.tgname`);

    const funcs = await q(`
      select p.proname as name, pg_get_function_arguments(p.oid) as args, pg_get_function_result(p.oid) as returns,
             l.lanname as language, p.prosecdef as security_definer, p.prosrc as body,
             p.prorettype <> 'trigger'::regtype and (
               (exists (select 1 from pg_roles where rolname = 'authenticated') and has_function_privilege('authenticated', p.oid, 'EXECUTE'))
               or (exists (select 1 from pg_roles where rolname = 'anon') and has_function_privilege('anon', p.oid, 'EXECUTE'))) as exposed
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_language l on l.oid = p.prolang
      where n.nspname = 'public' and p.prokind in ('f', 'p')
      order by p.proname`);

    const enums = await q(`
      select t.typname as name, json_agg(e.enumlabel order by e.enumsortorder) as values
      from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' group by t.typname order by t.typname`);

    await client.query('rollback');
    return assemble(cfg, version.v, rels, cols, cons, uidx, policies, triggers, funcs, enums);
  } finally {
    client.end();
  }
}

function assemble(cfg: PgConfig, version: string, rels: any[], cols: any[], cons: any[], uidx: any[], policies: any[], triggers: any[], funcs: any[], enums: any[]): LiveSnapshot {
  const types: ParsedTypes = { entities: [], functions: [], enums: enums.map((e) => ({ name: e.name, values: e.values })) };
  const mig: MigrationState = { tables: new Map(), policies: new Map(), triggers: new Map(), functions: new Map(), views: new Map(), files: [] };
  const rowCounts: Record<string, number> = {};
  const views: Record<string, LiveView> = {};
  const comments: Record<string, string> = {};
  const source = 'live database';

  const entities = new Map<string, ParsedEntity>();
  for (const r of rels) {
    const isView = r.kind === 'v' || r.kind === 'm';
    const e: ParsedEntity = { name: r.name, kind: isView ? 'view' : 'table', columns: [], relationships: [] };
    entities.set(r.name, e);
    types.entities.push(e);
    if (r.comment) comments[r.name] = r.comment;
    if (!isView) {
      rowCounts[r.name] = Number(r.live_rows ?? r.est_rows ?? 0);
      mig.tables.set(r.name, { name: r.name, columns: [], columnTypes: {}, pk: [], uniques: [], fks: [], rlsEnabled: !!r.rls, sources: [source] });
    } else {
      views[r.name] = { definition: String(r.view_def ?? '').trim(), tables: [], securityInvoker: /security_invoker=(true|on)/i.test(r.reloptions ?? '') };
      mig.views.set(r.name, { name: r.name, securityInvoker: views[r.name].securityInvoker, source });
    }
  }
  for (const c of cols) {
    const e = entities.get(c.table);
    if (!e) continue;
    e.columns.push({ name: c.name, type: c.enum_name ?? sqlTypeToken(c.type), nullable: !!c.nullable, enumName: c.enum_name ?? undefined, isPk: false, isFk: false, isUnique: false });
    const mt = mig.tables.get(c.table);
    if (mt) { mt.columns.push(c.name); mt.columnTypes[c.name] = sqlTypeToken(c.type); }
  }
  const keySets = new Map<string, string[][]>(); // table -> pk/unique column sets (for one-to-one detection)
  for (const con of cons) {
    const mt = mig.tables.get(con.table);
    if (!mt) continue;
    const colsArr: string[] = con.cols ?? [];
    if (con.type === 'p') mt.pk = colsArr;
    if (con.type === 'u') mt.uniques.push({ name: con.name, cols: colsArr });
    if (con.type === 'p' || con.type === 'u') { if (!keySets.has(con.table)) keySets.set(con.table, []); keySets.get(con.table)!.push(colsArr); }
  }
  for (const u of uidx) {
    const mt = mig.tables.get(u.table);
    if (!mt || !u.cols) continue;
    mt.uniques.push({ name: u.name, cols: u.cols });
    if (!keySets.has(u.table)) keySets.set(u.table, []);
    keySets.get(u.table)!.push(u.cols);
  }
  const setEq = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  for (const con of cons) {
    if (con.type !== 'f') continue;
    const mt = mig.tables.get(con.table);
    const e = entities.get(con.table);
    if (!mt || !e) continue;
    const colsArr: string[] = con.cols ?? [];
    const target = key(con.ref_schema, con.ref_table);
    mt.fks.push({ name: con.name, fromCols: colsArr, toSchema: con.ref_schema, to: target, toCols: con.ref_cols ?? [], source });
    if (con.ref_schema === 'public') {
      e.relationships.push({ foreignKeyName: con.name, columns: colsArr, isOneToOne: (keySets.get(con.table) ?? []).some((k) => setEq(k, colsArr)), referencedRelation: con.ref_table, referencedColumns: con.ref_cols ?? [] });
    }
  }
  for (const p of policies) {
    const table = key(p.schema, p.table);
    const exprs = [p.using, p.check].filter(Boolean).join(' ');
    const pol: Policy = {
      name: p.name, table,
      command: String(p.cmd).toUpperCase() as Policy['command'],
      permissive: String(p.permissive).toUpperCase() !== 'RESTRICTIVE',
      roles: Array.isArray(p.roles) ? p.roles : String(p.roles ?? '').replace(/[{}]/g, '').split(',').filter(Boolean),
      using: p.using ?? undefined, check: p.check ?? undefined,
      helpers: callRefs(exprs), tables: tableRefs(exprs), source,
    };
    mig.policies.set(`${table}::${pol.name}`, pol);
  }
  for (const t of triggers) {
    const table = key(t.schema, t.table);
    const ty = Number(t.tgtype);
    const events: string[] = [];
    if (ty & 4) events.push('INSERT');
    if (ty & 8) events.push('DELETE');
    if (ty & 16) events.push('UPDATE');
    if (ty & 32) events.push('TRUNCATE');
    const trig: Trigger = { name: t.name, table, timing: ty & 64 ? 'INSTEAD OF' : ty & 2 ? 'BEFORE' : 'AFTER', events, forEach: ty & 1 ? 'ROW' : 'STATEMENT', fn: t.fn, source };
    mig.triggers.set(`${table}::${t.name}`, trig);
  }
  for (const f of funcs) {
    const body = String(f.body ?? '');
    const fn: SqlFunction = {
      name: f.name, args: f.args ?? '', returns: f.returns ?? '', language: f.language ?? '', securityDefiner: !!f.security_definer,
      tables: tableRefs(body), calls: callRefs(body).filter((c) => c !== f.name), inTypes: false, inMigrations: true, source,
    };
    mig.functions.set(f.name, fn);
    if (f.exposed) types.functions.push({ name: f.name, args: f.args ?? '', returns: f.returns ?? '' });
  }
  for (const [name, v] of Object.entries(views)) v.tables = tableRefs(v.definition).filter((t) => t !== name && (entities.has(t) || t.includes('.')));

  return { host: cfg.host, database: cfg.database, serverVersion: version.split(' on ')[0], types, mig, rowCounts, views, comments };
}

/** Differences between what the database has and what the repo says it should have. */
export function diffLive(live: LiveSnapshot, staticTypes: ParsedTypes | null, staticMig: MigrationState): string[] {
  const w: string[] = [];
  const liveTables = new Map(live.types.entities.map((e) => [e.name, e]));
  if (staticTypes) {
    const st = new Map(staticTypes.entities.map((e) => [e.name, e]));
    for (const [n, e] of liveTables) if (!st.has(n)) w.push(`Live ${e.kind} \`${n}\` is not in types.ts. Regenerate the types.`);
    for (const [n, e] of st) if (!liveTables.has(n)) w.push(`types.ts has ${e.kind} \`${n}\` but the live database does not. types.ts is stale.`);
    for (const [n, e] of liveTables) {
      const s = st.get(n);
      if (!s) continue;
      const lc = new Set(e.columns.map((c) => c.name)), sc = new Set(s.columns.map((c) => c.name));
      for (const c of lc) if (!sc.has(c)) w.push(`Live column \`${n}.${c}\` is not in types.ts.`);
      for (const c of sc) if (!lc.has(c)) w.push(`types.ts has column \`${n}.${c}\` but the live database does not.`);
      const lf = new Set(e.relationships.map((r) => r.foreignKeyName)), sf = new Set(s.relationships.map((r) => r.foreignKeyName));
      for (const f of lf) if (!sf.has(f)) w.push(`Live FK \`${f}\` on \`${n}\` is not in types.ts.`);
      for (const f of sf) if (!lf.has(f)) w.push(`types.ts has FK \`${f}\` on \`${n}\` but the live database does not.`);
    }
    const lfn = new Set(live.types.functions.map((f) => f.name)), sfn = new Set(staticTypes.functions.map((f) => f.name));
    for (const f of lfn) if (!sfn.has(f)) w.push(`Live function \`${f}\` is callable through the API but not in types.ts.`);
    for (const f of sfn) if (!lfn.has(f)) w.push(`types.ts exposes function \`${f}\` but the live database has no such callable function.`);
  }
  if (staticMig.files.length) {
    for (const [n, t] of live.mig.tables) {
      const s = staticMig.tables.get(n);
      if (!s) { w.push(`Live table \`${n}\` is not created by any migration.`); continue; }
      if (t.rlsEnabled !== s.rlsEnabled) w.push(`RLS on \`${n}\` is ${t.rlsEnabled ? 'enabled' : 'disabled'} in the database but ${s.rlsEnabled ? 'enabled' : 'disabled'} by the migrations.`);
    }
    for (const n of staticMig.tables.keys()) if (!live.mig.tables.has(n) && !n.includes('.')) w.push(`Migrations create table \`${n}\` but the live database does not have it.`);
    const pairs: [string, Map<string, { table?: string; name: string }>, Map<string, { table?: string; name: string }>][] = [
      ['Policy', live.mig.policies, staticMig.policies], ['Trigger', live.mig.triggers, staticMig.triggers], ['Function', live.mig.functions, staticMig.functions], ['View', live.mig.views, staticMig.views],
    ];
    for (const [label, liveMap, staticMap] of pairs) {
      for (const [k, v] of liveMap) if (!staticMap.has(k)) w.push(`${label} \`${v.name}\`${v.table ? ` on \`${v.table}\`` : ''} exists in the database but no migration creates it.`);
      for (const [k, v] of staticMap) if (!liveMap.has(k)) w.push(`Migrations create ${label.toLowerCase()} \`${v.name}\`${v.table ? ` on \`${v.table}\`` : ''} but the database does not have it.`);
    }
  }
  return w;
}
