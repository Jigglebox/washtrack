// Mermaid emitters. erDiagram for entity/relationship views, flowchart for
// code-to-table coupling.

import type { Relationship, SchemaGraph, Table } from './model.ts';

export type AttrMode = 'none' | 'keys' | 'all';

export type ErOptions = {
  /** Tables to draw as full entities */
  tables: string[];
  /** Attribute detail per table */
  attrsFor: (table: string) => AttrMode;
  /** Draw a junction table as a single M:N edge instead of a node + two FKs */
  collapseJunctions: boolean;
  includeInferred: boolean;
  includeExternal: boolean;
  /** Also draw tables outside `tables` when they are one hop away (as stubs) */
  includeNeighbours: boolean;
};

export const nodeId = (name: string) => name.replace(/[^A-Za-z0-9_]/g, '_');
const q = (s: string) => `"${s.replace(/"/g, "'")}"`;

function attrLines(t: Table, mode: AttrMode, rels: Relationship[]): string[] {
  const cols = mode === 'all' ? t.columns : t.columns.filter((c) => c.isPk || c.isFk || c.isUnique);
  const lines: string[] = [];
  for (const c of cols) {
    const keys: string[] = [];
    if (c.isPk) keys.push('PK');
    if (c.isFk) keys.push('FK');
    if (c.isUnique && !c.isPk) keys.push('UK');
    const comments: string[] = [];
    const target = rels.find((r) => r.from === t.name && r.fromCols.includes(c.name) && r.kind !== 'junction');
    if (target && target.to !== t.name) comments.push(`${target.kind === 'inferred' ? '?-> ' : '-> '}${target.to}`);
    else if (target) comments.push('-> self');
    if (c.nullable) comments.push('null');
    const type = /^[A-Za-z][A-Za-z0-9_]*$/.test(c.type) ? c.type : 'unknown';
    lines.push(`    ${type} ${c.name}${keys.length ? ' ' + keys.join(', ') : ''}${comments.length ? ' ' + q(comments.join(', ')) : ''}`);
  }
  if (!lines.length) lines.push(`    ${t.pk[0] ? 'uuid' : 'string'} ${t.pk[0] ?? 'row'}${t.pk[0] ? ' PK' : ''}`);
  return lines;
}

function cardinality(r: Relationship): string {
  if (r.kind === 'junction') return '}o--o{';
  const line = r.kind === 'inferred' ? '..' : '--';
  const parent = r.optional ? '|o' : '||';
  const child = r.oneToOne ? 'o|' : 'o{';
  return `${parent}${line}${child}`;
}

export function erDiagram(g: SchemaGraph, o: ErOptions): string {
  const byName = new Map(g.tables.map((t) => [t.name, t]));
  const core = new Set(o.tables.filter((n) => byName.has(n)));
  const shown = new Set(core);
  const junctionHidden = (n: string) => o.collapseJunctions && (byName.get(n)?.isJunction ?? false);

  const relOk = (r: Relationship) => {
    if (r.kind === 'inferred' && !o.includeInferred) return false;
    if (r.kind === 'external' && !o.includeExternal) return false;
    if (r.kind === 'junction' && !o.collapseJunctions) return false;
    if (r.kind !== 'junction' && (junctionHidden(r.from) || junctionHidden(r.to))) return false;
    if (byName.get(r.from)?.kind === 'view' || byName.get(r.to)?.kind === 'view') return false;
    return true;
  };

  const rels = g.relationships.filter(relOk).filter((r) => {
    const inFrom = core.has(r.from), inTo = core.has(r.to);
    if (inFrom && inTo) return true;
    if (!o.includeNeighbours || (!inFrom && !inTo)) return false;
    if (!byName.has(r.from) || !byName.has(r.to)) return false;
    shown.add(r.from); shown.add(r.to);
    return true;
  });

  const out: string[] = ['erDiagram'];
  for (const name of [...shown].sort()) {
    if (junctionHidden(name)) continue;
    const t = byName.get(name)!;
    const mode = core.has(name) ? o.attrsFor(name) : 'none';
    const id = nodeId(name);
    const head = id === name ? id : `${id}[${q(name)}]`;
    if (mode === 'none') {
      const isolated = !rels.some((r) => r.from === name || r.to === name);
      if (isolated || id !== name) out.push(`  ${head} {\n${attrLines(t, 'keys', []).slice(0, 1).join('\n')}\n  }`);
      continue;
    }
    out.push(`  ${head} {`, ...attrLines(t, mode, g.relationships), '  }');
  }
  const seen = new Set<string>();
  for (const r of rels) {
    const label = r.kind === 'junction' ? `via ${r.via}` : r.kind === 'inferred' ? `${r.fromCols.join(', ')} (inferred)` : r.fromCols.join(', ');
    const line = `  ${nodeId(r.to)} ${cardinality(r)} ${nodeId(r.from)} : ${q(label)}`;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out.join('\n');
}

/** Edge functions / files -> tables & rpcs. */
export function codeFlowchart(g: SchemaGraph, kind: 'edge-function' | 'frontend', maxNodes = 60): string {
  const refs = g.codeRefs.filter((r) => r.kind === kind);
  const byLabel = new Map<string, { tables: Set<string>; rpcs: Set<string> }>();
  for (const r of refs) {
    if (!byLabel.has(r.label)) byLabel.set(r.label, { tables: new Set(), rpcs: new Set() });
    for (const t of r.tables) byLabel.get(r.label)!.tables.add(t);
    for (const f of r.rpcs) byLabel.get(r.label)!.rpcs.add(f);
  }
  const labels = [...byLabel.keys()].sort().slice(0, maxNodes);
  const out = ['flowchart LR'];
  out.push(`  subgraph code[${q(kind === 'edge-function' ? 'Edge functions' : 'Frontend')}]`);
  for (const l of labels) out.push(`    c_${nodeId(l)}[${q(l)}]`);
  out.push('  end');
  const tables = new Set<string>(), rpcs = new Set<string>();
  for (const l of labels) { for (const t of byLabel.get(l)!.tables) tables.add(t); for (const f of byLabel.get(l)!.rpcs) rpcs.add(f); }
  out.push(`  subgraph db[${q('Database')}]`);
  for (const t of [...tables].sort()) out.push(`    t_${nodeId(t)}[(${q(t)})]`);
  for (const f of [...rpcs].sort()) out.push(`    f_${nodeId(f)}[[${q(f + '()')}]]`);
  out.push('  end');
  for (const l of labels) {
    for (const t of [...byLabel.get(l)!.tables].sort()) out.push(`  c_${nodeId(l)} --> t_${nodeId(t)}`);
    for (const f of [...byLabel.get(l)!.rpcs].sort()) out.push(`  c_${nodeId(l)} -.-> f_${nodeId(f)}`);
  }
  return out.join('\n');
}

/** Triggers and the tables their functions write to. */
export function triggerFlowchart(g: SchemaGraph): string {
  const fns = new Map(g.functions.map((f) => [f.name, f]));
  const out = ['flowchart LR'];
  const nodes = new Set<string>();
  const edges: string[] = [];
  for (const tr of g.triggers) {
    const f = fns.get(tr.fn);
    nodes.add(`  t_${nodeId(tr.table)}[(${q(tr.table)})]`);
    nodes.add(`  f_${nodeId(tr.fn)}[[${q(tr.fn + '()')}]]`);
    edges.push(`  t_${nodeId(tr.table)} -- ${q(`${tr.timing} ${tr.events.join('/')}`)} --> f_${nodeId(tr.fn)}`);
    for (const t of f?.tables ?? []) if (t !== tr.table) { nodes.add(`  t_${nodeId(t)}[(${q(t)})]`); edges.push(`  f_${nodeId(tr.fn)} -.-> t_${nodeId(t)}`); }
  }
  return [...out, ...[...nodes].sort(), ...[...new Set(edges)]].join('\n');
}
