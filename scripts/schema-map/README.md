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
on Node 22 add `--experimental-strip-types`). No database credentials needed.

## Inputs

| Source | What it provides |
| --- | --- |
| `src/integrations/supabase/types.ts` | The truth for what exists: tables, columns, views, foreign keys, exposed functions, enums. Lovable regenerates this on every schema change. |
| `supabase/migrations/*.sql` | Replayed in order to get the current primary/unique keys, RLS enablement and policies, triggers, function bodies, and foreign keys into other schemas such as `auth.users`. |
| `supabase/functions/` and `src/` | `supabase.from('x')` and `supabase.rpc('y')` calls, so each table page lists the code that touches it. |

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

## Limitations

- Statement parsing is deliberately simple. Unusual DDL is ignored, not misread.
- Views defined only in the dashboard have no definition to read, so their
  source tables are unknown.
- Nothing here talks to the live database. Adding a `SUPABASE_DB_URL` source
  that reads `pg_catalog` would add row counts, live policies, and view
  definitions, and would catch changes made outside migrations.
