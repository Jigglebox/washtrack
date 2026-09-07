// Builds the interactive explorer page (explorer.html): the schema graph plus
// hand-written plain-English descriptions, embedded into a static template.

import { readFileSync } from 'node:fs';
import type { SchemaGraph, Table } from './model.ts';

export type Descriptions = {
  intro?: string;
  tables?: Record<string, { label?: string; what?: string; who?: string }>;
  groups?: Record<string, { label?: string; what?: string }>;
  flows?: { title: string; steps: { tables: string[]; text: string }[] }[];
  terms?: Record<string, string>;
  /** Optional overrides for how a specific link reads, keyed by constraint name */
  phrases?: Record<string, string>;
};

const human = (s: string) => s.replace(/^auth\./, 'login ').replace(/_/g, ' ');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const singular = (s: string) => { s = human(s); if (/ies$/.test(s)) return s.replace(/ies$/, 'y'); if (/(ss|us|is|map|log|data|info)$/.test(s)) return s; if (/ses$/.test(s)) return s.replace(/es$/, ''); if (/s$/.test(s)) return s.slice(0, -1); return s; };

const TYPE_WORDS: Record<string, string> = {
  string: 'text', text: 'text', varchar: 'text', char: 'text', uuid: 'identifier', number: 'number', int2: 'whole number', int4: 'whole number', int8: 'whole number',
  numeric: 'number', float4: 'number', float8: 'number', boolean: 'yes / no', bool: 'yes / no', json: 'structured data', jsonb: 'structured data',
  timestamptz: 'date and time', timestamp: 'date and time', date: 'date', time: 'time of day', string_array: 'list of text', text_array: 'list of text', bytea: 'file data', inet: 'network address',
};
function typeWords(t: Table['columns'][number], enums: SchemaGraph['enums']): string {
  if (t.enumName) { const e = enums.find((x) => x.name === t.enumName); return e ? `one of: ${e.values.join(', ')}` : 'one of a fixed list'; }
  if (/_array$/.test(t.type)) return `list of ${TYPE_WORDS[t.type.replace(/_array$/, '')] ?? 'values'}`;
  return TYPE_WORDS[t.type] ?? t.type.replace(/_/g, ' ');
}

const pageName = (file: string) => {
  const base = file.replace(/^src\//, '').replace(/\.(tsx?|jsx?)$/, '');
  const parts = base.split('/');
  const leaf = parts[parts.length - 1].replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ');
  const kind = parts[0] === 'pages' ? '' : parts[0] === 'components' ? 'component: ' : parts[0] === 'hooks' ? 'behind the scenes: ' : `${parts[0]}: `;
  const scope = parts.length > 2 && parts[0] === 'pages' ? `${cap(parts[1])} › ` : '';
  return `${kind}${scope}${leaf}`;
};

export function renderExplorer(g: SchemaGraph, d: Descriptions, projectName: string, templatePath: string): string {
  const tpl = readFileSync(templatePath, 'utf8');
  const clusterOf = new Map<string, string>();
  for (const c of g.clusters) for (const t of c.tables) clusterOf.set(t, c.name);
  const byName = new Map(g.tables.map((t) => [t.name, t]));

  // Views sit with the table they read from; external tables sit in the cluster named after them.
  const groupFor = (t: Table): string | undefined => {
    if (clusterOf.has(t.name)) return clusterOf.get(t.name);
    if (t.kind === 'view') { const src = t.viewTables?.[0] ?? t.name.replace(/_safe_view$|_view$/, ''); return clusterOf.get(src) ?? clusterOf.get(t.name); }
    if (g.clusters.some((c) => c.name === t.name)) return t.name;
    return undefined;
  };

  const groups = g.clusters.map((c) => ({
    name: c.name,
    label: d.groups?.[c.name]?.label ?? cap(human(c.name)),
    what: d.groups?.[c.name]?.what ?? '',
    tables: [] as string[],
  }));
  const tables = g.tables.map((t) => {
    const group = groupFor(t);
    const desc = d.tables?.[t.name] ?? {};
    const rels = g.relationships.filter((r) => r.from === t.name && r.kind !== 'junction');
    const pages = [...new Set(g.codeRefs.filter((r) => r.kind === 'frontend' && r.tables.includes(t.name)).map((r) => pageName(r.file)))].sort();
    const edge = [...new Set(g.codeRefs.filter((r) => r.kind === 'edge-function' && r.tables.includes(t.name)).map((r) => r.label.replace(/-/g, ' ')))].sort();
    const triggers = g.triggers.filter((tr) => tr.table === t.name).map((tr) => {
      const fn = g.functions.find((f) => f.name === tr.fn);
      const ev = tr.events.map((e) => ({ INSERT: 'added', UPDATE: 'changed', DELETE: 'removed', TRUNCATE: 'cleared' }[e] ?? e.toLowerCase())).join(' or ');
      return { text: `When a ${singular(t.name)} is ${ev}, “${human(tr.fn)}” runs ${tr.timing === 'BEFORE' ? 'first' : 'right after'}.`, touches: (fn?.tables ?? []).filter((x) => x !== t.name && byName.has(x)) };
    });
    return {
      name: t.name, kind: t.kind, group,
      label: desc.label ?? cap(human(t.name)), what: desc.what ?? '', who: desc.who ?? '',
      cols: t.columns.map((c) => ({ n: c.name, t: typeWords(c, g.enums), null: c.nullable, pk: c.isPk, ref: rels.find((r) => r.fromCols.includes(c.name))?.to })),
      rows: t.rowCount ?? null,
      policies: g.policies.filter((p) => p.table === t.name).length,
      pages, edge, triggers, isHub: t.isHub, isJunction: t.isJunction,
      notes: g.findings.filter((f) => f.severity !== 'info' && (f.table === t.name || (f.subjectKind === 'table' && f.subject === t.name))).map((f) => ({ sev: f.severity, rule: f.rule, msg: f.message, ev: f.evidence ?? '' })),
    };
  });
  for (const t of tables) { const gr = groups.find((x) => x.name === t.group); if (gr && !gr.tables.includes(t.name)) gr.tables.push(t.name); }
  for (const gr of groups) gr.tables.sort((a, b) => { const ta = byName.get(a)!, tb = byName.get(b)!; return (tb.inboundDegree - ta.inboundDegree) || a.localeCompare(b); });

  const links: any[] = g.relationships.filter((r) => byName.get(r.from)?.kind !== 'view' && byName.get(r.to)?.kind !== 'view').map((r) => ({
    name: r.name, from: r.from, to: r.to, kind: r.kind, cols: r.fromCols, optional: r.optional, one: r.oneToOne, via: r.via, phrase: d.phrases?.[r.name],
  }));
  // Access rules that look at another table to decide (RLS policy on A references B)
  const policyPairs = new Map<string, { from: string; to: string; rules: string[]; commands: string[] }>();
  for (const pol of g.policies) for (const t of pol.tables) {
    if (t === pol.table || !byName.has(t) || byName.get(t)!.kind === 'view' || !byName.has(pol.table)) continue;
    const k = `${pol.table}→${t}`;
    if (!policyPairs.has(k)) policyPairs.set(k, { from: pol.table, to: t, rules: [], commands: [] });
    policyPairs.get(k)!.rules.push(pol.name); policyPairs.get(k)!.commands.push(pol.command);
  }
  for (const [k, v] of policyPairs) links.push({ name: `policy:${k}`, from: v.from, to: v.to, kind: 'policy', cols: [], rules: v.rules, commands: [...new Set(v.commands)] });
  // Automatic actions that write to another table (trigger on A runs a function that touches B)
  const autoPairs = new Map<string, { from: string; to: string; fns: string[]; events: string[] }>();
  for (const tr of g.triggers) {
    const fn = g.functions.find((f) => f.name === tr.fn);
    for (const t of fn?.tables ?? []) {
      if (t === tr.table || !byName.has(t) || byName.get(t)!.kind === 'view' || !byName.has(tr.table)) continue;
      const k = `${tr.table}→${t}`;
      if (!autoPairs.has(k)) autoPairs.set(k, { from: tr.table, to: t, fns: [], events: [] });
      autoPairs.get(k)!.fns.push(tr.fn); autoPairs.get(k)!.events.push(...tr.events);
    }
  }
  for (const [k, v] of autoPairs) links.push({ name: `auto:${k}`, from: v.from, to: v.to, kind: 'trigger', cols: [], fns: [...new Set(v.fns)], events: [...new Set(v.events)] });

  const knownTables = new Set(tables.map((t) => t.name));
  const flows = (d.flows ?? []).map((f) => ({ title: f.title, steps: f.steps.map((s) => ({ text: s.text, tables: s.tables.filter((t) => knownTables.has(t)) })) }));

  const review = {
    counts: { high: g.findings.filter((f) => f.severity === 'high').length, medium: g.findings.filter((f) => f.severity === 'medium').length, low: g.findings.filter((f) => f.severity === 'low').length },
    top: g.findings.filter((f) => f.severity === 'high' || f.severity === 'medium').map((f) => ({ sev: f.severity, rule: f.rule, subject: f.subject, table: f.table && knownTables.has(f.table) ? f.table : (f.subjectKind === 'table' && knownTables.has(f.subject) ? f.subject : null), msg: f.message })),
    changes: g.changes ? { baseline: g.changes.baseline, added: g.changes.added.length, removed: g.changes.removed.length, changed: g.changes.changed.length } : null,
  };
  const data = {
    title: `${projectName} data map`,
    review,
    intro: d.intro ?? 'Click a group, then a table. Hover a line to read the connection in plain words.',
    live: g.live.connected ? `${g.live.host}, ${g.live.database}` : null,
    generatedAt: g.generatedAt.slice(0, 10),
    groups, tables, links, flows, terms: d.terms ?? {},
  };
  const json = JSON.stringify(data).replace(/<\//g, '<\\/');
  return tpl.replace(/__TITLE__/g, `${projectName} data map`).replace(/__SUBTITLE__/g, `How the records connect · generated ${data.generatedAt}`).replace('/*__DATA__*/{}', json);
}
