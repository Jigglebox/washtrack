// Shared data model for the schema map. Everything downstream (analysis,
// Mermaid, Markdown, JSON) works from a single SchemaGraph.

export type Column = {
  name: string;
  /** Simplified type token, e.g. string, number, json, string_array, app_role */
  type: string;
  nullable: boolean;
  isPk: boolean;
  isFk: boolean;
  isUnique: boolean;
  enumName?: string;
};

export type Table = {
  name: string;
  kind: 'table' | 'view';
  columns: Column[];
  pk: string[];
  /** Unique constraints / unique indexes, each a column list */
  uniques: string[][];
  rlsEnabled: boolean;
  isJunction: boolean;
  isHub: boolean;
  /** Distinct tables that reference this one (declared FKs only) */
  inboundDegree: number;
  /** Where we learned about it (types.ts, migration file, live database) */
  sources: string[];
  /** Live database only: n_live_tup (or reltuples) estimate */
  rowCount?: number;
  /** Views, live database only */
  viewDefinition?: string;
  viewTables?: string[];
  comment?: string;
};

export type RelationshipKind = 'declared' | 'inferred' | 'junction' | 'external';

export type Relationship = {
  /** Constraint name for declared FKs, synthetic otherwise */
  name: string;
  from: string;
  fromCols: string[];
  to: string;
  toCols: string[];
  oneToOne: boolean;
  /** True when every FK column is nullable */
  optional: boolean;
  kind: RelationshipKind;
  /** For junction (M:N) relationships, the linking table */
  via?: string;
  note?: string;
};

export type Policy = {
  name: string;
  table: string;
  command: 'ALL' | 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
  permissive: boolean;
  roles: string[];
  using?: string;
  check?: string;
  /** SQL functions called from the USING / WITH CHECK expressions */
  helpers: string[];
  /** Other tables referenced by the policy expressions */
  tables: string[];
  source: string;
};

export type Trigger = {
  name: string;
  table: string;
  timing: string;
  events: string[];
  forEach: string;
  fn: string;
  source: string;
};

export type SqlFunction = {
  name: string;
  args: string;
  returns: string;
  language: string;
  securityDefiner: boolean;
  /** Tables referenced in the body */
  tables: string[];
  /** Other SQL functions called from the body */
  calls: string[];
  inTypes: boolean;
  inMigrations: boolean;
  source?: string;
};

export type CodeRef = {
  /** Path relative to repo root */
  file: string;
  kind: 'edge-function' | 'frontend';
  /** Edge function folder name, or the file path for frontend code */
  label: string;
  tables: string[];
  rpcs: string[];
};

export type Cluster = {
  name: string;
  tables: string[];
};

export type EnumType = { name: string; values: string[] };

export type LiveInfo = { connected: boolean; host?: string; database?: string; serverVersion?: string; error?: string };

export type SchemaGraph = {
  generatedAt: string;
  live: LiveInfo;
  tables: Table[];
  relationships: Relationship[];
  policies: Policy[];
  triggers: Trigger[];
  functions: SqlFunction[];
  enums: EnumType[];
  codeRefs: CodeRef[];
  clusters: Cluster[];
  polymorphic: PolymorphicRef[];
  warnings: string[];
};

export const EXTERNAL_TABLE_PREFIX = 'auth.';

/** A `<x>_type` + `<x>_id` (or table_name + record_id) pair that points at any table. */
export type PolymorphicRef = { table: string; typeCol: string; idCol: string };
