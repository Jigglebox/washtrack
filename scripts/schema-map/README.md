# schema-map

Crawls this Supabase project and writes a browsable map of the database to
`docs/schema/`: every table, how tables reference each other, RLS policies,
triggers, SQL functions, and which edge functions and frontend files query
what. Diagrams are Mermaid, so GitHub renders them inline.

```bash
npm run schema:map      # regenerate docs/schema/
npm run schema:check    # exit 1 if docs/schema/ is out of date (used in CI)
```

No dependencies. Needs Node 22.6 or newer (it runs the TypeScript directly;
on Node 22 add `--experimental-strip-types`). Works with no database access at
all; optionally reads the live database (see below).

## This tool never changes anything

It is diagnostic only. It reads the repo and, optionally, the database, and
writes Markdown under the output directory (`docs/schema/` by default). It
does not touch source files, migrations, or the database. Against a live
database it is read-only three times over:

1. The client refuses to send any statement that is not `SELECT`, `WITH`,
   `SHOW`, or transaction control.
2. The session is opened with `default_transaction_read_only = on`.
3. Every catalog query runs inside `BEGIN READ ONLY ... ROLLBACK`, so Postgres
   itself rejects writes even from a CTE that slipped through.

It also never logs or writes the connection string.

## Inputs

| Source | What it provides |
| --- | --- |
| `src/integrations/supabase/types.ts` | The truth for what exists: tables, columns, views, foreign keys, exposed functions, enums. Lovable regenerates this on every schema change. |
| `supabase/migrations/*.sql` | Replayed in order to get the current primary/unique keys, RLS enablement and policies, triggers, function bodies, and foreign keys into other schemas such as `auth.users`. |
| `supabase/functions/` and `src/` | `supabase.from('x')` and `supabase.rpc('y')` calls, so each table page lists the code that touches it. |
| Live database (optional) | With `--db <url>` or `SUPABASE_DB_URL` set, `pg_catalog` becomes the source of truth instead of `types.ts` and the migrations: real columns and types, constraints, RLS policies as they actually are, triggers (including the ones on `auth.users`), function bodies, view definitions, and row-count estimates. The repo sources are then diffed against it. |

Because the migrations and the generated types are independent records of the
same database, disagreements between them are reported under "Warnings and
drift" in the README. Those usually mean something was changed in the Supabase
dashboard without a migration.

## Review: is everything wired in?

`docs/schema/review.md` lists places where a piece of the system does not
follow the conventions the rest of the system uses, or is not connected to
anything. The conventions are discovered from the project itself, not assumed:

- the role vocabulary (the `app_role` enum and where it is used),
- the shared permission helpers most access rules call (`has_role_or_higher()` etc.),
- the "own record" pattern (`auth.uid() = column`).

Rules cover three questions. **Permissions**: does a new access rule, page
route, edge function or database function use the existing role system, or
did it grow its own? **Connectedness**: is there a table, function or edge
function nothing uses, or a link that exists only by naming? **Consistency**:
does a table lack the access rules or automatic actions its siblings have?

Findings carry a severity (`high` fix or confirm, `medium` check, `low` tidy,
`info` for the record) and are also shown on each table's page under "Review
notes". They are prompts, not verdicts.

## What changed since the last run

`docs/schema/changes.md` compares the current graph with the last committed
`docs/schema/schema.json` (or `--baseline <file>` / `--baseline-ref <git ref>`)
and lists added, removed and changed tables, columns, links, access rules,
automatic actions, functions, routes and code files. Review findings that touch
the new pieces are listed first, so after Lovable makes a change the workflow
is: pull, run `npm run schema:map`, open `changes.md`.

## Output

- `explorer.html`: an interactive, plain-English map for non-developers. Groups,
  tables, connections read as sentences, "what happens when" walkthroughs, and a
  glossary. Descriptions come from `docs/schema-descriptions.json`, which is
  hand-written and safe to edit; the structure comes from the crawl. Open the
  file in a browser.
- `README.md`: stats, domain list, full relationship map, hub tables, review summary, warnings.
- `explorer.html`: interactive, plain-English map. Click a group, then a table; hover a line.
- `review.md` and `changes.md`: see above.
- `clusters/<domain>.md`: one diagram per domain with key columns.
- `tables/<table>.md`: columns, relationships in both directions, neighbourhood
  diagram, RLS policies, triggers, SQL functions and code that use the table.
- `functions.md`: trigger flow, SQL function table, edge function and frontend coupling.
- `policies.md`: policy count matrix per table and command, plus storage policies.
- `schema.json`: the whole graph as data.

## How relationships are found

- **Declared**: foreign keys from `types.ts`. Cardinality comes from `isOneToOne`
  and column nullability.
- **External**: foreign keys whose target is outside `public` (typically
  `auth.users`). The type generator omits these, so they come from migrations.
- **Junction**: a table whose primary key or a unique constraint is exactly two
  foreign keys, with few other columns, is drawn as a many-to-many edge in the
  overview and as a normal table elsewhere.
- **Inferred**: a uuid column named `<thing>_id`, `<thing>_by`, or a person word
  such as `created_by` that has no constraint but matches a table name. Drawn
  dotted. These are guesses; a wrong one usually means the column name is
  misleading.
- **Polymorphic**: `<x>_type` + `<x>_id` or `table_name` + `record_id` pairs
  are listed on the table page rather than drawn.

## Domains

Tables are grouped with label propagation over the foreign key graph. Tables
referenced by many others (`--hub-ratio`, `--min-hub-degree`) are hubs; each
hub gets its own domain with the tables that only reference it, and appears as
a stub in every other domain diagram so those stay readable.

## Editing the plain-English text

`docs/schema-descriptions.json` holds the label, one-line description and
"who uses it" for every table and group, the walkthrough stories, the glossary,
and optional `phrases` that override how a specific connection is worded
(keyed by the constraint name from `schema.json`). Tables without an entry
still appear, just without a description. Re-run `npm run schema:map` after
editing.

## Options

Run `node scripts/schema-map/index.ts --help`. Paths default to the Lovable
layout; `--root` points it at another project.

## Reading the live database

```bash
export SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'
npm run schema:map
```

Use the **session pooler** string from the Supabase dashboard (Database
settings, port 5432). The direct host is IPv6-only and unreachable from most
laptops and CI runners. TLS is on by default for anything that is not
localhost; add `?sslmode=disable` for a local Postgres, `?sslmode=no-verify`
to skip certificate checks. The client speaks SCRAM-SHA-256, MD5 and cleartext
password auth with no extra packages.

Keep the URL out of the repo. Put it in your shell or a CI secret, not in a
file. `--no-db` ignores the environment variables for a purely static run.

Do not use `--check` against a live database in CI: row-count estimates change
between runs, so the docs will always look stale. Use the static mode for the
check and the live mode for deeper, on-demand diagnostics.

## Limitations

- Statement parsing of migrations is deliberately simple. Unusual DDL is
  ignored, not misread.
- Without a live connection, views defined only in the dashboard have no
  definition to read, so their source tables are unknown.
- The live source reads `public` (plus policies on `storage.objects` and
  triggers on `auth.users`). Other schemas only appear as foreign key targets.
- Row counts are planner estimates (`n_live_tup`), not exact counts.
