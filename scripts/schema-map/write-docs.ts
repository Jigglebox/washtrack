// Renders the SchemaGraph to a set of Markdown files (plus schema.json).
// Returns a map of relative path -> content so the CLI can write or diff it.

import type { Policy, Relationship, SchemaGraph, Table } from './model.ts';
import { codeFlowchart, erDiagram, triggerFlowchart } from './mermaid.ts';

const fence = (code: string) => '```mermaid\n' + code + '\n```';
const code = (s: string) => '`' + s + '`';
const slug = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_');
const tableLink = (name: string, from: 'root' | 'sub') => (name.includes('.') ? code(name) : `[${name}](${from === 'root' ? '' : '../'}tables/${slug(name)}.md)`);
const clusterLink = (name: string, from: 'root' | 'sub') => `[${name}](${from === 'root' ? '' : '../'}clusters/${slug(name)}.md)`;
const cell = (s: string | undefined, max = 90) => { const t = (s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' '); return t.length > max ? t.slice(0, max - 1) + '…' : t; };
const mdTable = (headers: string[], rows: string[][]) => [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

export function renderDocs(g: SchemaGraph, projectName: string): Map<string, string> {
  const files = new Map<string, string>();
  const clusterOf = new Map<string, string>();
  for (const c of g.clusters) for (const t of c.tables) clusterOf.set(t, c.name);
  const realTables = g.tables.filter((t) => t.kind === 'table' && !t.sources.includes('external'));
  const views = g.tables.filter((t) => t.kind === 'view');
  const stamp = `_Generated ${g.generatedAt.slice(0, 10)} by ${code('scripts/schema-map')}. Do not edit by hand; run ${code('npm run schema:map')}._`;
  const liveLine = g.live.connected
    ? `Source of truth: **live database** (${code(g.live.host ?? '')}, ${code(g.live.database ?? '')}, ${g.live.serverVersion ?? ''}), read-only, compared against the migrations and types.ts in the repo.`
    : g.live.error
      ? `Source of truth: types.ts and migrations. **Live database connection failed**: ${g.live.error}`
      : `Source of truth: types.ts and migrations in the repo. Set ${code('SUPABASE_DB_URL')} to read the live database instead (adds row counts, live policies, view definitions, and drift against the repo).`;
  const rows = (t: Table) => (t.rowCount === undefined ? '' : t.rowCount.toLocaleString('en-US'));

  // ---------------------------------------------------------------- README
  const declared = g.relationships.filter((r) => r.kind === 'declared').length;
  const inferred = g.relationships.filter((r) => r.kind === 'inferred').length;
  const external = g.relationships.filter((r) => r.kind === 'external').length;
  const readme: string[] = [
    `# ${projectName} schema map`, '', stamp, '', liveLine, '',
    'How this database fits together: every table, how they reference each other, which RLS policies guard them, what triggers and functions touch them, and which code talks to them.', '',
    '## At a glance', '',
    mdTable(['', 'Count'], [
      ['Tables', String(realTables.length)],
      ['Views', String(views.length)],
      ['Declared foreign keys', String(declared)],
      ['Foreign keys into other schemas (auth.users etc.)', String(external)],
      ['Inferred relationships (no constraint, matched by name)', String(inferred)],
      ['Junction tables (many-to-many)', String(g.tables.filter((t) => t.isJunction).length)],
      ['RLS policies', String(g.policies.length)],
      ['Triggers', String(g.triggers.length)],
      ['SQL functions', String(g.functions.length)],
      ['Edge functions', String(new Set(g.codeRefs.filter((r) => r.kind === 'edge-function').map((r) => r.label)).size)],
      ['Frontend files querying the DB', String(g.codeRefs.filter((r) => r.kind === 'frontend').length)],
      ...(g.live.connected ? [['Rows (live estimate, all tables)', realTables.reduce((n, t) => n + (t.rowCount ?? 0), 0).toLocaleString('en-US')]] : []),
    ]), '',
    '## Domains', '',
    'Tables grouped by how densely they reference each other. Hub tables (referenced by many others) get their own domain together with the tables that only reference them, and are drawn as stubs in every other domain diagram.', '',
    mdTable(['Domain', 'Tables', 'Members'], g.clusters.map((c) => [clusterLink(c.name, 'root'), String(c.tables.length), c.tables.map((t) => tableLink(t, 'root')).join(', ')])), '',
    '## Full relationship map', '',
    'Declared foreign keys only. Junction tables are collapsed into many-to-many edges. Views and inferred relationships are left out; see the domain and table pages for those.', '',
    fence(erDiagram(g, { tables: realTables.map((t) => t.name).concat(g.tables.filter((t) => t.sources.includes('external')).map((t) => t.name)), attrsFor: () => 'none', collapseJunctions: true, includeInferred: false, includeExternal: true, includeNeighbours: false })), '',
    '## Hub tables', '',
    mdTable(['Table', 'Referenced by (tables)'], g.tables.filter((t) => t.isHub).map((t) => [tableLink(t.name, 'root'), String(t.inboundDegree)])) || '_none_', '',
    '## Other pages', '',
    `- **[Interactive explorer](explorer.html)**: the same map as a click-around page written for non-developers. Open the file in a browser (GitHub shows its source, not the page).`,
    `- [Functions, triggers and code coupling](functions.md)`,
    `- [RLS policy matrix](policies.md)`,
    `- ${code('schema.json')}: the whole graph as data, for other tooling`, '',
    '## Warnings and drift', '',
    'Things that look inconsistent between the migrations, the generated types, and the code. Each one is either a real problem or a sign that something was changed in the Supabase dashboard without a migration.', '',
    g.warnings.length ? g.warnings.map((w) => `- ${w}`).join('\n') : '_none_', '',
    '## How to read the diagrams', '',
    '- `||--o{` one-to-many, `|o--o{` optional parent (nullable FK), `||--o|` one-to-one, `}o--o{` many-to-many via a junction table.',
    '- Dotted lines (`..`) are inferred from column names; there is no constraint in the database.',
    '- `PK`, `FK`, `UK` mark primary, foreign and unique keys. `null` in the comment means the column is nullable.',
    '- Inputs: `src/integrations/supabase/types.ts` (tables, columns, FKs, views, exposed functions), `supabase/migrations/*.sql` replayed in order (keys, RLS, triggers, function bodies, cross-schema FKs), `supabase/functions/` and `src/` (which code queries what).', '',
  ];
  files.set('README.md', readme.join('\n'));

  // ---------------------------------------------------------------- clusters
  for (const c of g.clusters) {
    const members = c.tables;
    const outside = new Set<string>();
    for (const r of g.relationships) {
      if (r.kind === 'junction') continue;
      if (members.includes(r.from) && !members.includes(r.to)) outside.add(r.to);
      if (members.includes(r.to) && !members.includes(r.from)) outside.add(r.from);
    }
    const lines = [
      `# Domain: ${c.name}`, '', stamp, '', `[Back to overview](../README.md)`, '',
      '## Tables', '',
      mdTable(['Table', 'Columns', ...(g.live.connected ? ['Rows'] : []), 'RLS', 'Policies', 'Notes'], members.map((n) => { const t = g.tables.find((x) => x.name === n)!; return [tableLink(n, 'sub'), String(t.columns.length), ...(g.live.connected ? [rows(t)] : []), t.rlsEnabled ? 'on' : '**off**', String(g.policies.filter((p) => p.table === n).length), [t.isHub ? 'hub' : '', t.isJunction ? 'junction' : ''].filter(Boolean).join(', ')]; })), '',
      '## Relationships', '',
      'Key columns only. Tables from other domains appear as stubs.', '',
      fence(erDiagram(g, { tables: members, attrsFor: () => 'keys', collapseJunctions: false, includeInferred: true, includeExternal: true, includeNeighbours: true })), '',
    ];
    if (outside.size) lines.push('## Connections to other domains', '', [...outside].sort().map((n) => `- ${g.tables.find((t) => t.name === n) ? tableLink(n, 'sub') : n}${clusterOf.has(n) ? ` (${clusterLink(clusterOf.get(n)!, 'sub')})` : ''}`).join('\n'), '');
    files.set(`clusters/${slug(c.name)}.md`, lines.join('\n'));
  }

  // ---------------------------------------------------------------- tables
  for (const t of g.tables) {
    if (t.sources.includes('external')) continue;
    files.set(`tables/${slug(t.name)}.md`, renderTablePage(g, t, clusterOf, stamp));
  }

  // ---------------------------------------------------------------- functions & code
  const fnRows = g.functions.map((f) => [code(f.name), cell(f.args, 60), cell(f.returns, 40), f.language || '?', f.securityDefiner ? 'definer' : 'invoker', f.tables.map((x) => tableLink(x, 'root')).join(', '), f.inTypes ? 'yes' : 'no', f.inMigrations ? 'yes' : '**no**']);
  const funcs = [
    `# Functions, triggers and code coupling`, '', stamp, '', `[Back to overview](README.md)`, '',
    '## Triggers', '',
    'What fires on writes, and which other tables the trigger function touches (dotted).', '',
    g.triggers.length ? fence(triggerFlowchart(g)) : '_none_', '',
    mdTable(['Table', 'Trigger', 'When', 'Function', 'Defined in'], g.triggers.map((tr) => [tableLink(tr.table, 'root'), code(tr.name), `${tr.timing} ${tr.events.join(' OR ')} FOR EACH ${tr.forEach}`, code(tr.fn + '()'), code(tr.source)])), '',
    '## SQL functions', '',
    '"Exposed" means callable through the API (present in types.ts). "In migrations: no" means the function only exists in the live database.', '',
    mdTable(['Function', 'Args', 'Returns', 'Lang', 'Security', 'Touches', 'Exposed', 'In migrations'], fnRows), '',
    '## Edge functions', '',
    fence(codeFlowchart(g, 'edge-function')), '',
    '## Frontend', '',
    'Which source files query which tables. Only files with direct `supabase.from()` / `supabase.rpc()` calls are listed.', '',
    mdTable(['File', 'Tables', 'RPCs'], g.codeRefs.filter((r) => r.kind === 'frontend').map((r) => [code(r.file), r.tables.map((x) => tableLink(x, 'root')).join(', '), r.rpcs.map(code).join(', ')])), '',
  ];
  files.set('functions.md', funcs.join('\n'));

  // ---------------------------------------------------------------- policies
  const cmds: Policy['command'][] = ['ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE'];
  const polRows = realTables.map((t) => {
    const ps = g.policies.filter((p) => p.table === t.name);
    return [tableLink(t.name, 'root'), t.rlsEnabled ? 'on' : '**off**', ...cmds.map((c) => String(ps.filter((p) => p.command === c).length) || '0'), [...new Set(ps.flatMap((p) => p.helpers))].map(code).join(', ')];
  });
  const storagePolicies = g.policies.filter((p) => p.table.startsWith('storage.'));
  files.set('policies.md', [
    `# RLS policy matrix`, '', stamp, '', `[Back to overview](README.md)`, '',
    'Number of policies per command on each table, and the helper functions those policies call. Details are on each table page.', '',
    mdTable(['Table', 'RLS', ...cmds, 'Helpers'], polRows), '',
    '## Storage policies', '',
    storagePolicies.length ? mdTable(['Policy', 'On', 'Command', 'Using', 'With check'], storagePolicies.map((p) => [cell(p.name, 60), code(p.table), p.command, code(cell(p.using, 120)), p.check ? code(cell(p.check, 120)) : ''])) : '_none_', '',
  ].join('\n'));

  files.set('schema.json', JSON.stringify(g, null, 2) + '\n');
  return files;
}

function renderTablePage(g: SchemaGraph, t: Table, clusterOf: Map<string, string>, stamp: string): string {
  const out: string[] = [`# ${t.kind === 'view' ? 'View' : 'Table'}: ${t.name}`, '', stamp, '', `[Back to overview](../README.md)${clusterOf.has(t.name) ? ` · Domain: [${clusterOf.get(t.name)}](../clusters/${slug(clusterOf.get(t.name)!)}.md)` : ''}`, ''];
  const facts: string[] = [];
  if (t.comment) facts.push(`Comment: ${t.comment}`);
  if (t.rowCount !== undefined) facts.push(`Rows: about ${t.rowCount.toLocaleString('en-US')} (live estimate)`);
  if (t.pk.length) facts.push(`Primary key: ${t.pk.map(code).join(', ')}`);
  for (const u of t.uniques) facts.push(`Unique: ${u.map(code).join(', ')}`);
  if (t.kind === 'table') facts.push(`RLS: ${t.rlsEnabled ? 'enabled' : '**not enabled**'}`);
  if (t.isHub) facts.push(`Hub table: referenced by ${t.inboundDegree} other tables`);
  if (t.isJunction) facts.push('Junction table (many-to-many link)');
  facts.push(`Defined in: ${t.sources.map(code).join(', ')}`);
  out.push(facts.map((f) => `- ${f}`).join('\n'), '');

  out.push('## Columns', '');
  const relsFrom = g.relationships.filter((r) => r.from === t.name && r.kind !== 'junction');
  out.push(mdTable(['Column', 'Type', 'Null', 'Keys', 'References'], t.columns.map((c) => {
    const rs = relsFrom.filter((r) => r.fromCols.includes(c.name));
    return [code(c.name), c.enumName ? `enum ${code(c.enumName)}` : c.type, c.nullable ? 'yes' : '', [c.isPk ? 'PK' : '', c.isFk ? 'FK' : '', c.isUnique ? 'UK' : ''].filter(Boolean).join(', '), rs.map((r) => `${g.tables.some((x) => x.name === r.to && !x.sources.includes('external')) ? tableLink(r.to, 'sub') : r.to}.${r.toCols.join(',')}${r.kind === 'inferred' ? ' (inferred)' : ''}`).join('; ')];
  })), '');

  const relsTo = g.relationships.filter((r) => r.to === t.name && r.from !== t.name && r.kind !== 'junction');
  const m2m = g.relationships.filter((r) => r.kind === 'junction' && (r.from === t.name || r.to === t.name));
  const relLine = (r: Relationship, dir: 'out' | 'in') => {
    const other = dir === 'out' ? r.to : r.from;
    const otherLink = g.tables.some((x) => x.name === other && !x.sources.includes('external')) ? tableLink(other, 'sub') : code(other);
    const card = r.kind === 'junction' ? 'many-to-many' : r.oneToOne ? 'one-to-one' : dir === 'out' ? 'many-to-one' : 'one-to-many';
    return `- ${otherLink} via ${code(dir === 'out' ? r.fromCols.join(', ') : `${r.from}.${r.fromCols.join(', ')}`)} (${card}${r.optional ? ', optional' : ''}${r.kind === 'inferred' ? ', **inferred**' : ''}${r.kind === 'external' ? ', other schema' : ''})`;
  };
  out.push('## Relationships', '');
  if (relsFrom.length) out.push('**References**', '', relsFrom.map((r) => relLine(r, 'out')).join('\n'), '');
  if (relsTo.length) out.push('**Referenced by**', '', relsTo.map((r) => relLine(r, 'in')).join('\n'), '');
  if (m2m.length) out.push('**Many-to-many**', '', m2m.map((r) => `- ${tableLink(r.from === t.name ? r.to : r.from, 'sub')} via ${tableLink(r.via!, 'sub')}`).join('\n'), '');
  const poly = g.polymorphic.filter((p) => p.table === t.name);
  if (poly.length) out.push('**Polymorphic**', '', poly.map((p) => `- ${code(p.typeCol)} + ${code(p.idCol)} can point at any table`).join('\n'), '');
  if (!relsFrom.length && !relsTo.length && !m2m.length && !poly.length) out.push('_No relationships found._', '');

  if (t.kind === 'view' && t.viewDefinition) {
    out.push('## Definition', '', '```sql', t.viewDefinition, '```', '');
    if (t.viewTables?.length) out.push('Reads from: ' + t.viewTables.map((x) => (g.tables.some((y) => y.name === x) ? tableLink(x, 'sub') : code(x))).join(', '), '');
  }
  if (t.kind === 'table') {
    out.push('## Neighbourhood', '', fence(erDiagram(g, { tables: [t.name], attrsFor: () => 'all', collapseJunctions: false, includeInferred: true, includeExternal: true, includeNeighbours: true })), '');
  }

  const policies = g.policies.filter((p) => p.table === t.name);
  out.push('## RLS policies', '');
  out.push(policies.length ? mdTable(['Policy', 'Command', 'Roles', 'Using', 'With check', 'Calls', 'Source'], policies.map((p) => [cell(p.name, 60), p.command + (p.permissive ? '' : ' (restrictive)'), p.roles.join(', '), p.using ? code(cell(p.using, 120)) : '', p.check ? code(cell(p.check, 120)) : '', p.helpers.map(code).join(', '), code(p.source)])) : t.rlsEnabled ? '_RLS is enabled but no policies exist: only service-role access._' : '_None. Row level security is not enabled._', '');

  const triggers = g.triggers.filter((tr) => tr.table === t.name);
  if (triggers.length) out.push('## Triggers', '', mdTable(['Trigger', 'When', 'Function', 'Function touches'], triggers.map((tr) => { const f = g.functions.find((x) => x.name === tr.fn); return [code(tr.name), `${tr.timing} ${tr.events.join(' OR ')} FOR EACH ${tr.forEach}`, code(tr.fn + '()'), (f?.tables ?? []).filter((x) => x !== t.name).map((x) => tableLink(x, 'sub')).join(', ')]; })), '');

  const fns = g.functions.filter((f) => f.tables.includes(t.name));
  const polRefs = g.policies.filter((p) => p.tables.includes(t.name));
  if (fns.length || polRefs.length) {
    out.push('## Used by SQL', '');
    if (fns.length) out.push(fns.map((f) => `- function ${code(f.name + '()')}${f.securityDefiner ? ' (security definer)' : ''}`).join('\n'));
    if (polRefs.length) out.push(polRefs.map((p) => `- policy "${p.name}" on ${tableLink(p.table, 'sub')}`).join('\n'));
    out.push('');
  }

  const edge = g.codeRefs.filter((r) => r.kind === 'edge-function' && r.tables.includes(t.name));
  const fe = g.codeRefs.filter((r) => r.kind === 'frontend' && r.tables.includes(t.name));
  out.push('## Used by code', '');
  if (edge.length) out.push('**Edge functions**', '', [...new Set(edge.map((r) => r.label))].map((l) => `- ${code(l)}`).join('\n'), '');
  if (fe.length) out.push('**Frontend**', '', fe.map((r) => `- ${code(r.file)}`).join('\n'), '');
  if (!edge.length && !fe.length) out.push('_No direct queries found in code._', '');
  return out.join('\n');
}
