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

## Output

- `README.md`: stats, domain list, full relationship map, hub tables, warnings.
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
