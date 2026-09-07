// Scans TypeScript sources for how the app talks to the database and how it
// guards access: table reads/writes, RPC calls, edge-function invocations,
// role names used in the UI, route guards, and service-role usage in edge
// functions. All of this feeds the "is the new piece wired in?" review.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { CodeRef, RouteRef } from './model.ts';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'ios', 'android', 'coverage']);
const EXT = /\.(ts|tsx|js|jsx|mjs)$/;
const FROM_RE = /\.from\(\s*['"`]([A-Za-z_][A-Za-z0-9_.]*)['"`]\s*\)/g;
const RPC_RE = /\.rpc\(\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]/g;
const INVOKE_RE = /functions\.invoke\(\s*['"`]([A-Za-z0-9_-]+)['"`]|\/functions\/v1\/([A-Za-z0-9_-]+)/g;
const OP_RE = /\.(select|insert|update|delete|upsert)\s*\(/g;
const ROLE_ARRAY_RE = /\[\s*((?:['"][a-z_]+['"]\s*,?\s*){1,8})\]/g;
const ROLE_ARG_RE = /(?:has_role_or_higher|has_role|hasRole|hasRoleOrHigher|isRole|requireRole)\s*\([^)]*?['"]([a-z_]+)['"]/g;
const ROUTE_RE = /<Route\s[^>]*?path=["']([^"']+)["'][^>]*?(?:element=\{([\s\S]*?)\}\s*(?:\/>|>)|\/>)/g;

function walk(dir: string, acc: string[]) {
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, acc);
    else if (EXT.test(e)) acc.push(p);
  }
}

/** Which operation follows a `.from('x')` call in the same chain (best effort: next 300 chars). */
function opsAfter(text: string, idx: number): string[] {
  const window = text.slice(idx, idx + 300).split(/;\n|\n\s*\n/)[0];
  const ops = new Set<string>();
  for (const m of window.matchAll(OP_RE)) ops.add(m[1]);
  return [...ops];
}

function parseRoutes(text: string, roleVocab: Set<string>): RouteRef[] {
  const routes: RouteRef[] = [];
  for (const m of text.matchAll(ROUTE_RE)) {
    const path = m[1];
    const el = m[2] ?? '';
    const rolesMatch = el.match(/allowedRoles=\{\s*\[([^\]]*)\]/);
    const roles = rolesMatch ? [...rolesMatch[1].matchAll(/['"]([a-z_]+)['"]/g)].map((x) => x[1]) : [];
    const guard: RouteRef['guard'] = /<ProtectedRoute\b/.test(el) ? 'roles' : /<PortalProtectedRoute\b|<PortalShell\b/.test(el) ? 'portal' : /<Navigate\b/.test(el) ? 'redirect' : 'none';
    routes.push({ path, guard, roles: roles.filter((r) => roleVocab.size === 0 || roleVocab.has(r) || true) });
  }
  return routes;
}

export function scanCode(root: string, functionsDir: string, srcDir: string, roleVocab: Set<string> = new Set()): CodeRef[] {
  const refs: CodeRef[] = [];
  const scan = (dir: string, kind: CodeRef['kind']) => {
    const files: string[] = [];
    walk(dir, files);
    for (const f of files.sort()) {
      const text = readFileSync(f, 'utf8');
      const tables = new Map<string, Set<string>>();
      const rpcs = new Set<string>();
      const invokes = new Set<string>();
      const roles = new Set<string>();
      for (const m of text.matchAll(FROM_RE)) {
        if (!tables.has(m[1])) tables.set(m[1], new Set());
        for (const op of opsAfter(text, m.index! + m[0].length)) tables.get(m[1])!.add(op);
      }
      for (const m of text.matchAll(RPC_RE)) rpcs.add(m[1]);
      for (const m of text.matchAll(INVOKE_RE)) invokes.add(m[1] ?? m[2]);
      for (const m of text.matchAll(ROLE_ARG_RE)) roles.add(m[1]);
      for (const m of text.matchAll(ROLE_ARRAY_RE)) {
        const items = [...m[1].matchAll(/['"]([a-z_]+)['"]/g)].map((x) => x[1]);
        // Only treat the array as a role list when it overlaps the known vocabulary.
        if (roleVocab.size && items.some((i) => roleVocab.has(i))) for (const i of items) roles.add(i);
      }
      const rel = relative(root, f).split(sep).join('/');
      const isRouteFile = kind === 'frontend' && /<Route\s/.test(text);
      const routes = isRouteFile ? parseRoutes(text, roleVocab) : [];
      if (!tables.size && !rpcs.size && !invokes.size && !roles.size && !routes.length && kind === 'frontend') continue;
      const label = kind === 'edge-function' ? relative(dir, f).split(sep)[0] : rel;
      const ref: CodeRef = {
        file: rel, kind, label,
        tables: [...tables.keys()].sort(),
        ops: Object.fromEntries([...tables].map(([t, ops]) => [t, [...ops].sort()])),
        rpcs: [...rpcs].sort(),
        invokes: [...invokes].sort(),
        roles: [...roles].sort(),
        routes,
      };
      if (kind === 'edge-function') {
        ref.edge = {
          usesServiceRole: /SERVICE_ROLE/.test(text),
          checksCaller: /auth\.getUser\(|getClaims\(|verify_jwt|jwtVerify|\.auth\.getSession\(/.test(text),
          checksRole: /has_role|is_super_admin|user_roles|allowedRoles|\brole\b/.test(text),
        };
      }
      refs.push(ref);
    }
  };
  scan(functionsDir, 'edge-function');
  scan(srcDir, 'frontend');
  // Edge functions are one folder each; collapse multi-file functions into their folder label.
  return refs;
}
