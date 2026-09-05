#!/usr/bin/env node
// Schema map: crawl a Supabase/Postgres project and write Mermaid docs.
//
//   node scripts/schema-map/index.ts            # writes docs/schema/
//   node scripts/schema-map/index.ts --check    # exit 1 if docs/schema/ is stale
//
// Needs Node 22.6+ (runs TypeScript directly; on Node < 23.6 add --experimental-strip-types).

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { buildGraph } from './analyze.ts';
import { scanCode } from './parse-code.ts';
import { replayMigrations } from './parse-sql.ts';
import { parseTypesFile } from './parse-types.ts';
import { renderDocs } from './write-docs.ts';

type Args = Record<string, string | boolean>;
function parseArgs(argv: string[]): Args {
  const a: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (!x.startsWith('--')) continue;
    const [k, v] = x.slice(2).split('=');
    if (v !== undefined) a[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) a[k] = argv[++i];
    else a[k] = true;
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`schema-map: build Mermaid docs for a Supabase project

Options:
  --root <dir>         project root (default: cwd)
  --name <name>        project name for the title (default: root folder name)
  --out <dir>          output dir (default: docs/schema)
  --types <file>       generated types (default: src/integrations/supabase/types.ts)
  --migrations <dir>   default: supabase/migrations
  --functions <dir>    default: supabase/functions
  --src <dir>          default: src
  --hub-ratio <0..1>   fraction of tables that must reference a table for it to be a hub (default 0.25)
  --min-hub-degree <n> minimum referencing tables for a hub (default 4)
  --check              do not write; exit 1 if the output dir is out of date
  --quiet              no summary`);
  process.exit(0);
}

const root = resolve(String(args.root ?? process.cwd()));
const outDir = resolve(root, String(args.out ?? 'docs/schema'));
const typesPath = resolve(root, String(args.types ?? 'src/integrations/supabase/types.ts'));
const migDir = resolve(root, String(args.migrations ?? 'supabase/migrations'));
const fnDir = resolve(root, String(args.functions ?? 'supabase/functions'));
const srcDir = resolve(root, String(args.src ?? 'src'));

if (!existsSync(typesPath)) { console.error(`schema-map: types file not found: ${typesPath}`); process.exit(2); }

let projectName = String(args.name ?? basename(root));

const types = parseTypesFile(typesPath);
const mig = replayMigrations(migDir);
const codeRefs = scanCode(root, fnDir, srcDir);
const graph = buildGraph(types, mig, codeRefs, { hubRatio: Number(args['hub-ratio'] ?? 0.25), minHubDegree: Number(args['min-hub-degree'] ?? 4) });
const files = renderDocs(graph, projectName);

// Keep output byte-stable across runs on the same inputs: the timestamp only changes when content changes.
{
  const prev = join(outDir, 'schema.json');
  if (existsSync(prev)) {
    try {
      const old = JSON.parse(readFileSync(prev, 'utf8'));
      const sameExceptTime = JSON.stringify({ ...old, generatedAt: '' }) === JSON.stringify({ ...graph, generatedAt: '' });
      if (sameExceptTime && old.generatedAt) {
        graph.generatedAt = old.generatedAt;
        const again = renderDocs(graph, projectName);
        files.clear(); for (const [k, v] of again) files.set(k, v);
      }
    } catch { /* regenerate */ }
  }
}

function listFiles(dir: string, acc: string[] = [], base = dir): string[] {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) listFiles(p, acc, base);
    else acc.push(p.slice(base.length + 1));
  }
  return acc;
}

if (args.check) {
  const stale: string[] = [];
  for (const [rel, content] of files) {
    const p = join(outDir, rel);
    if (!existsSync(p) || readFileSync(p, 'utf8') !== content) stale.push(rel);
  }
  for (const rel of listFiles(outDir)) if (!files.has(rel)) stale.push(`${rel} (should be deleted)`);
  if (stale.length) { console.error(`schema-map: ${outDir} is out of date:\n  ${stale.join('\n  ')}\nRun: npm run schema:map`); process.exit(1); }
  if (!args.quiet) console.log('schema-map: docs are up to date');
  process.exit(0);
}

for (const rel of listFiles(outDir)) if (!files.has(rel)) rmSync(join(outDir, rel));
for (const [rel, content] of files) {
  const p = join(outDir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

if (!args.quiet) {
  const t = graph.tables.filter((x) => x.kind === 'table' && !x.sources.includes('external')).length;
  console.log(`schema-map: ${t} tables, ${graph.relationships.filter((r) => r.kind === 'declared').length} FKs, ${graph.relationships.filter((r) => r.kind === 'inferred').length} inferred, ${graph.policies.length} policies, ${graph.triggers.length} triggers, ${graph.functions.length} functions, ${graph.clusters.length} domains, ${graph.warnings.length} warnings`);
  console.log(`schema-map: wrote ${files.size} files to ${outDir}`);
}
