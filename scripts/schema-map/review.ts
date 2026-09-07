// Coherence review: does each piece of the system plug into the conventions
// the rest of the system already uses? The conventions are discovered from the
// graph itself (the role vocabulary, the helper functions most policies call,
// the ownership pattern), so the rules test "is this consistent with the rest
// of WashTrack" rather than a generic checklist.

import type { Conventions, Finding, Policy, SchemaGraph, Severity } from './model.ts';

const OWNERSHIP_RE = /auth\.uid\(\)\s*=\s*[a-z_.]+|[a-z_.]+\s*=\s*auth\.uid\(\)/i;
const TRUE_RE = /^\(?\s*true\s*\)?$/i;
const ROLE_LITERAL_RE = /'([a-z_]+)'\s*::\s*(?:public\.)?([a-z_]+)/g;
const PERMISSION_NAME_RE = /role|admin|permission|allowed|authori[sz]|can_|is_|access/i;
const CORE_UI_ROLES = new Set(['button', 'tab', 'switch', 'option', 'menuitem', 'checkbox', 'dialog', 'link', 'img', 'presentation', 'status', 'alert', 'listbox', 'combobox', 'radio', 'textbox', 'group', 'list', 'listitem', 'navigation', 'region', 'grid', 'row', 'cell', 'tooltip', 'progressbar', 'separator', 'slider', 'tabpanel', 'tablist', 'menu', 'menubar', 'heading', 'none']);

export function detectConventions(g: SchemaGraph): Conventions {
  const helperCounts = new Map<string, number>();
  for (const p of g.policies) for (const h of p.helpers) helperCounts.set(h, (helperCounts.get(h) ?? 0) + 1);
  const policyHelpers = [...helperCounts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([h]) => h);
  // The role enum: the one referenced by the most role helpers / policies, else any enum named *role*.
  const enumsUsed = new Map<string, number>();
  for (const p of g.policies) for (const m of `${p.using ?? ''} ${p.check ?? ''}`.matchAll(ROLE_LITERAL_RE)) enumsUsed.set(m[2], (enumsUsed.get(m[2]) ?? 0) + 1);
  const roleEnumName = [...enumsUsed.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? g.enums.find((e) => /role/i.test(e.name))?.name;
  const roleEnum = g.enums.find((e) => e.name === roleEnumName);
  const roleTables = g.tables.filter((t) => /^(user_roles|roles|role_assignments|user_role)$/.test(t.name)).map((t) => t.name);
  return { roles: roleEnum?.values ?? [], roleEnum: roleEnum?.name, policyHelpers, roleTables };
}

export function reviewGraph(g: SchemaGraph, c: Conventions): Finding[] {
  const F: Finding[] = [];
  const add = (rule: string, severity: Severity, subjectKind: Finding['subjectKind'], subject: string, message: string, evidence?: string, table?: string) =>
    F.push({ rule, severity, subjectKind, subject, table, message, evidence });
  const real = g.tables.filter((t) => t.kind === 'table' && !t.sources.includes('external'));
  const tableNames = new Set(g.tables.map((t) => t.name));
  const fnByName = new Map(g.functions.map((f) => [f.name, f]));
  const helpers = new Set(c.policyHelpers);
  const roles = new Set(c.roles);
  const policiesFor = (t: string) => g.policies.filter((p) => p.table === t);
  const exprOf = (p: Policy) => `${p.using ?? ''} ${p.check ?? ''}`.trim();

  // ------------------------------------------------------------ permissions
  for (const p of g.policies) {
    if (p.table.startsWith('storage.')) continue;
    const expr = exprOf(p);
    const usesHelper = p.helpers.some((h) => helpers.has(h));
    const ownership = OWNERSHIP_RE.test(expr);
    const open = TRUE_RE.test(p.using ?? '') || TRUE_RE.test(p.check ?? '');
    const touchesRoles = c.roleTables.some((t) => new RegExp(`\\b${t}\\b`, 'i').test(expr)) || /\brole\b/i.test(expr);
    if (!usesHelper && touchesRoles) {
      add('permissions/adhoc-role-check', 'high', 'policy', `${p.table}: ${p.name}`,
        `This rule checks roles by hand instead of using the shared helpers (${c.policyHelpers.slice(0, 3).map((h) => h + '()').join(', ')}). If the role model changes, this one will be missed.`,
        expr.slice(0, 200), p.table);
    } else if (!usesHelper && !ownership && !open && p.helpers.length === 0 && expr && !/auth\.uid\(\)/.test(expr)) {
      add('permissions/policy-outside-role-model', 'medium', 'policy', `${p.table}: ${p.name}`,
        'This rule uses neither the shared role helpers nor an "own record" check, so it sits outside the permission system the rest of the app uses.',
        expr.slice(0, 200), p.table);
    }
    if (open) add('permissions/open-policy', 'info', 'policy', `${p.table}: ${p.name}`, `Unconditional ${p.command} access for ${p.roles.join(', ')}. Fine if intended; listed so it is a decision, not an accident.`, undefined, p.table);
    for (const m of expr.matchAll(ROLE_LITERAL_RE)) {
      if (c.roleEnum && m[2] === c.roleEnum && roles.size && !roles.has(m[1])) add('permissions/unknown-role', 'high', 'policy', `${p.table}: ${p.name}`, `Refers to a role "${m[1]}" that does not exist in ${c.roleEnum} (${c.roles.join(', ')}).`, undefined, p.table);
    }
  }

  // Tables whose access rules avoid the role system entirely
  for (const t of real) {
    const ps = policiesFor(t.name);
    if (!ps.length) continue;
    if (!ps.some((p) => p.helpers.some((h) => helpers.has(h))) && !ps.every((p) => OWNERSHIP_RE.test(exprOf(p)) || TRUE_RE.test(p.using ?? '') || TRUE_RE.test(p.check ?? ''))) {
      add('permissions/table-outside-role-model', 'medium', 'table', t.name, `None of this table's ${ps.length} access rules use the shared role helpers. Check that this is deliberate.`, ps.map((p) => p.name).join('; '), t.name);
    }
  }

  // App writes to a table with no rule allowing that write
  for (const r of g.codeRefs.filter((x) => x.kind === 'frontend')) {
    for (const [t, ops] of Object.entries(r.ops)) {
      if (!tableNames.has(t) || g.tables.find((x) => x.name === t)?.kind === 'view') continue;
      const ps = policiesFor(t);
      if (!g.tables.find((x) => x.name === t)?.rlsEnabled) continue;
      for (const op of ops) {
        if (op === 'select') continue;
        const cmd = op === 'upsert' ? ['INSERT', 'UPDATE'] : [op.toUpperCase()];
        const covered = cmd.every((cmdName) => ps.some((p) => p.command === 'ALL' || p.command === cmdName));
        if (!covered) add('permissions/write-without-rule', 'high', 'file', r.file, `Code ${op}s into \`${t}\` but no access rule on \`${t}\` allows ${cmd.join('/')} for app users. Either this write always fails, or it only works through a privileged path.`, `${r.file} → ${t}.${op}()`, t);
      }
    }
  }

  // Role names used in the UI that are not in the vocabulary
  for (const r of g.codeRefs) {
    const unknown = r.roles.filter((x) => !roles.has(x) && !CORE_UI_ROLES.has(x));
    if (roles.size && unknown.length) add('permissions/unknown-role', 'high', 'file', r.file, `Uses role name(s) ${unknown.map((u) => `"${u}"`).join(', ')} that do not exist in ${c.roleEnum ?? 'the role list'} (${c.roles.join(', ')}). A typo here silently locks people out or lets them in.`, undefined);
  }

  // Edge functions holding the service-role key
  for (const r of g.codeRefs.filter((x) => x.kind === 'edge-function' && x.edge)) {
    const e = r.edge!;
    if (e.usesServiceRole && !e.checksCaller) add('permissions/unguarded-edge-function', 'high', 'edge-function', r.label, 'Runs with the service-role key (bypasses every access rule) and never checks who is calling. Anyone with the project URL can call it.', r.file);
    else if (e.usesServiceRole && !e.checksRole) add('permissions/edge-function-no-role-check', 'medium', 'edge-function', r.label, 'Runs with the service-role key and checks that the caller is logged in, but not what role they have. Fine only if every logged-in user may do this.', r.file);
  }

  // Routes without a guard
  for (const r of g.codeRefs) for (const rt of r.routes) {
    if (rt.guard !== 'none') continue;
    if (/^\/(admin|manager|finance|employee|payroll|reports?|settings)\b/.test(rt.path)) add('permissions/unguarded-route', 'high', 'route', rt.path, `Route is not wrapped in a role guard. Other ${rt.path.split('/')[1]} routes are.`, r.file);
    else if (/^\/portal\/(?!login|signup|auth|$)/.test(rt.path)) add('permissions/unguarded-route', 'medium', 'route', rt.path, 'Portal route without the portal guard.', r.file);
  }

  // Possible duplicate permission helpers
  for (const f of g.functions) {
    if (helpers.has(f.name)) continue;
    const readsRoles = c.roleTables.some((t) => f.tables.includes(t));
    if (readsRoles && PERMISSION_NAME_RE.test(f.name) && !/trigger/i.test(f.returns) && !f.calls.some((x) => helpers.has(x))) {
      add('permissions/duplicate-helper', 'medium', 'function', f.name, `Reads ${c.roleTables.join('/')} directly and looks like a permission check, but does not use the shared helpers (${c.policyHelpers.slice(0, 2).map((h) => h + '()').join(', ')}). A second role-checking path drifts from the first.`, f.source);
    }
  }

  // ------------------------------------------------------------ connectedness
  const usedByCode = new Set(g.codeRefs.flatMap((r) => r.tables));
  const usedBySql = new Set([...g.functions.flatMap((f) => f.tables), ...g.policies.flatMap((p) => p.tables), ...g.triggers.map((t) => t.table)]);
  for (const t of real) {
    const rels = g.relationships.filter((r) => r.from === t.name || r.to === t.name);
    if (!rels.length) add('connectedness/isolated-table', 'medium', 'table', t.name, 'Nothing links to this table and it links to nothing. Either it is a standalone log, or a piece that never got connected.', undefined, t.name);
    if (!usedByCode.has(t.name) && !usedBySql.has(t.name)) add('connectedness/unused-table', 'medium', 'table', t.name, 'No page, edge function, database function, rule or automatic action reads or writes this table. It may be dead, or something was built but never wired up.', undefined, t.name);
  }
  const calledRpcs = new Set(g.codeRefs.flatMap((r) => r.rpcs));
  const calledByFns = new Set(g.functions.flatMap((f) => f.calls));
  const calledByPolicies = new Set(g.policies.flatMap((p) => p.helpers));
  const calledByTriggers = new Set(g.triggers.map((t) => t.fn));
  for (const f of g.functions) {
    if (calledRpcs.has(f.name) || calledByFns.has(f.name) || calledByPolicies.has(f.name) || calledByTriggers.has(f.name)) continue;
    if (/^(get_last_|get_next_|purge_|disable_inactive|auto_update)/.test(f.name)) { add('connectedness/unreferenced-function', 'info', 'function', f.name, 'Not called from code, rules, triggers or other functions. Looks like a scheduled or maintenance job; confirm something schedules it.', f.source); continue; }
    add('connectedness/unreferenced-function', 'low', 'function', f.name, 'Not called from any page, edge function, rule, trigger or other function. Possibly left over from an earlier version.', f.source);
  }
  const invoked = new Set(g.codeRefs.flatMap((r) => r.invokes));
  for (const r of g.codeRefs.filter((x) => x.kind === 'edge-function')) {
    if (!invoked.has(r.label)) add('connectedness/uninvoked-edge-function', 'low', 'edge-function', r.label, 'No page calls this edge function. It may be triggered by a schedule or webhook; if not, it is disconnected.', r.file);
  }
  const inferredByTable = new Map<string, string[]>();
  for (const r of g.relationships.filter((x) => x.kind === 'inferred')) inferredByTable.set(r.from, [...(inferredByTable.get(r.from) ?? []), `${r.fromCols.join(',')} → ${r.to}`]);
  for (const [t, links] of inferredByTable) add('connectedness/loose-links', 'low', 'table', t, `${links.length} link${links.length > 1 ? 's' : ''} exist only by column name; the database does not enforce them, so deleting the target leaves dangling references.`, links.join('; '), t);

  // Look-alike tables (same shape, different name): a sign a concept was rebuilt instead of reused
  for (let i = 0; i < real.length; i++) for (let j = i + 1; j < real.length; j++) {
    const a = new Set(real[i].columns.map((c) => c.name)), b = new Set(real[j].columns.map((c) => c.name));
    if (a.size < 5 || b.size < 5) continue;
    const inter = [...a].filter((x) => b.has(x)).length;
    const jac = inter / (a.size + b.size - inter);
    if (jac >= 0.6) add('connectedness/lookalike-tables', 'low', 'table', `${real[i].name} ~ ${real[j].name}`, `These two tables share ${Math.round(jac * 100)}% of their columns. Check whether one duplicates the other's purpose.`, [...a].filter((x) => b.has(x)).join(', '), real[i].name);
  }

  // ------------------------------------------------------------ consistency
  const updatedAtTriggerTables = new Set(g.triggers.filter((t) => t.timing === 'BEFORE' && t.events.includes('UPDATE') && /updated_at|touch|timestamp/i.test(t.fn)).map((t) => t.table));
  if (updatedAtTriggerTables.size) for (const t of real) {
    if (t.columns.some((c) => c.name === 'updated_at') && !updatedAtTriggerTables.has(t.name)) add('consistency/updated-at-not-maintained', 'low', 'table', t.name, `Has an updated_at column but no automatic action keeps it current, unlike ${updatedAtTriggerTables.size} other tables.`, undefined, t.name);
  }
  for (const t of real) {
    const ps = policiesFor(t.name);
    if (!t.rlsEnabled) add('consistency/no-access-rules', 'high', 'table', t.name, 'Access rules are switched off for this table: any logged-in user (and, with the public key, anyone) can read and change every row.', undefined, t.name);
    else if (!ps.length) add('consistency/locked-table', 'medium', 'table', t.name, 'Access rules are on but none exist, so the app cannot read or write it at all. Only privileged functions can.', undefined, t.name);
  }
  for (const w of g.warnings) add('consistency/drift', 'info', 'schema', 'repo vs database', w);

  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
  return F.sort((a, b) => order[a.severity] - order[b.severity] || a.rule.localeCompare(b.rule) || a.subject.localeCompare(b.subject));
}

export const RULE_DOCS: Record<string, string> = {
  'permissions/adhoc-role-check': 'An access rule that checks roles by reading the role table itself instead of calling the shared helper functions. Two ways of answering "is this person an admin?" will eventually disagree.',
  'permissions/policy-outside-role-model': 'An access rule that uses neither the shared role helpers nor an "is this my own record" check. It may be correct, but it is not part of the permission system the rest of the app uses.',
  'permissions/table-outside-role-model': 'A table none of whose rules use the shared role helpers.',
  'permissions/open-policy': 'A rule that allows an action unconditionally. Not a problem by itself; listed so each one is a conscious decision.',
  'permissions/unknown-role': 'A role name that is not in the official list. Usually a typo or a group invented in one place only.',
  'permissions/write-without-rule': 'A page writes to a table, but no rule on that table allows that kind of write for normal users.',
  'permissions/unguarded-edge-function': 'A server-side function that holds the master key and never checks who called it.',
  'permissions/edge-function-no-role-check': 'A server-side function that holds the master key, checks that the caller is logged in, but not what they are allowed to do.',
  'permissions/unguarded-route': 'A page route without the guard the neighbouring routes have.',
  'permissions/duplicate-helper': 'A second function that decides permissions on its own instead of going through the shared helpers.',
  'connectedness/isolated-table': 'A table with no links in or out.',
  'connectedness/unused-table': 'A table nothing reads or writes.',
  'connectedness/unreferenced-function': 'A database function nothing calls.',
  'connectedness/uninvoked-edge-function': 'A server-side function no page calls.',
  'connectedness/loose-links': 'Links that exist only by naming convention, with nothing enforcing them.',
  'connectedness/lookalike-tables': 'Two tables with almost the same columns, which often means a concept was rebuilt instead of reused.',
  'consistency/updated-at-not-maintained': 'A table with an updated_at column that nothing keeps current, unlike its siblings.',
  'consistency/no-access-rules': 'A table with access rules switched off entirely.',
  'consistency/locked-table': 'A table with access rules on but none defined.',
  'consistency/drift': 'Places where the repo and the database disagree about what exists.',
};
