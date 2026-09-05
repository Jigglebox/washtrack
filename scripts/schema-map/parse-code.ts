// Scans TypeScript sources for Supabase client calls so the map can show which
// edge functions and frontend files touch which tables and RPCs.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { CodeRef } from './model.ts';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'ios', 'android', 'coverage']);
const EXT = /\.(ts|tsx|js|jsx|mjs)$/;
const FROM_RE = /\.from\(\s*['"`]([A-Za-z_][A-Za-z0-9_.]*)['"`]\s*\)/g;
const RPC_RE = /\.rpc\(\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]/g;

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

export function scanCode(root: string, functionsDir: string, srcDir: string): CodeRef[] {
  const refs: CodeRef[] = [];
  const scan = (dir: string, kind: CodeRef['kind']) => {
    const files: string[] = [];
    walk(dir, files);
    for (const f of files.sort()) {
      const text = readFileSync(f, 'utf8');
      const tables = new Set<string>();
      const rpcs = new Set<string>();
      for (const m of text.matchAll(FROM_RE)) tables.add(m[1]);
      for (const m of text.matchAll(RPC_RE)) rpcs.add(m[1]);
      if (!tables.size && !rpcs.size) continue;
      const rel = relative(root, f).split(sep).join('/');
      const label = kind === 'edge-function' ? relative(dir, f).split(sep)[0] : rel;
      refs.push({ file: rel, kind, label, tables: [...tables].sort(), rpcs: [...rpcs].sort() });
    }
  };
  scan(functionsDir, 'edge-function');
  scan(srcDir, 'frontend');
  return refs;
}
