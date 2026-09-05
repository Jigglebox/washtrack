// Parses the Supabase-generated `types.ts` (src/integrations/supabase/types.ts).
//
// The generator emits a very regular, 2-space-indented literal type, so a
// line-oriented parser is enough and keeps this tool dependency-free. If the
// generator output ever changes shape, this is the file to fix.

import { readFileSync } from 'node:fs';
import type { Column, EnumType } from './model.ts';

export type ParsedRelationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

export type ParsedEntity = {
  name: string;
  kind: 'table' | 'view';
  columns: Column[];
  relationships: ParsedRelationship[];
};

export type ParsedFunction = { name: string; args: string; returns: string };

export type ParsedTypes = {
  entities: ParsedEntity[];
  functions: ParsedFunction[];
  enums: EnumType[];
};

const indentOf = (line: string): number => line.length - line.trimStart().length;

/** Map a TypeScript column type to a short token Mermaid will accept. */
export function simplifyType(tsType: string): { type: string; nullable: boolean; enumName?: string } {
  let t = tsType.trim();
  const nullable = / \| null$/.test(t);
  t = t.replace(/ \| null$/, '');
  const enumMatch = t.match(/Enums"\]\["([a-z_0-9]+)"\]/i);
  if (enumMatch) return { type: enumMatch[1], nullable, enumName: enumMatch[1] };
  if (t === 'Json') return { type: 'json', nullable };
  const arr = t.match(/^([A-Za-z]+)\[\]$/);
  if (arr) return { type: `${arr[1].toLowerCase()}_array`, nullable };
  if (/^"[^"]*"( \| "[^"]*")*$/.test(t)) return { type: 'literal', nullable };
  return { type: t.replace(/[^A-Za-z0-9_]/g, '_').toLowerCase() || 'unknown', nullable };
}

export function parseTypesFile(path: string): ParsedTypes {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const out: ParsedTypes = { entities: [], functions: [], enums: [] };

  // Section state. The public schema block sits at indent 2, its sections at 4.
  let section: 'Tables' | 'Views' | 'Functions' | 'Enums' | null = null;
  let inPublic = false;
  let entity: ParsedEntity | null = null;
  let sub: 'Row' | 'Relationships' | 'other' | null = null;
  let rel: Partial<ParsedRelationship> | null = null;
  let fn: ParsedFunction | null = null;
  let fnDepth = 0;
  let pendingEnum: EnumType | null = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const ind = indentOf(line);
    const text = line.trim();

    if (ind === 2 && /^public: \{$/.test(text)) { inPublic = true; continue; }
    if (ind === 2 && text === '}') { inPublic = false; section = null; continue; }
    if (!inPublic) continue;

    if (ind === 4) {
      const m = text.match(/^(Tables|Views|Functions|Enums|CompositeTypes): \{$/);
      section = m ? (m[1] === 'CompositeTypes' ? null : (m[1] as typeof section)) : null;
      entity = null; sub = null; fn = null; pendingEnum = null;
      continue;
    }

    if (section === 'Tables' || section === 'Views') {
      if (ind === 6) {
        const m = text.match(/^([A-Za-z_0-9]+): \{$/);
        if (m) {
          entity = { name: m[1], kind: section === 'Tables' ? 'table' : 'view', columns: [], relationships: [] };
          out.entities.push(entity);
          sub = null;
        } else if (text === '}') {
          entity = null; sub = null;
        }
        continue;
      }
      if (!entity) continue;
      if (ind === 8) {
        if (text === 'Row: {') sub = 'Row';
        else if (text === 'Relationships: [') sub = 'Relationships';
        else if (text === 'Relationships: []') sub = null;
        else if (/^(Insert|Update): \{$/.test(text)) sub = 'other';
        else if (text === '}' || text === ']') sub = null;
        continue;
      }
      if (sub === 'Row' && ind === 10) {
        const m = text.match(/^([A-Za-z_0-9]+): (.+)$/);
        if (m) {
          const s = simplifyType(m[2]);
          entity.columns.push({ name: m[1], type: s.type, nullable: s.nullable, enumName: s.enumName, isPk: false, isFk: false, isUnique: false });
        }
        continue;
      }
      if (sub === 'Relationships') {
        if (ind === 10 && text === '{') { rel = {}; continue; }
        if (ind === 10 && (text === '},' || text === '}')) {
          if (rel && rel.foreignKeyName && rel.referencedRelation) entity.relationships.push(rel as ParsedRelationship);
          rel = null; continue;
        }
        if (ind === 12 && rel) {
          const m = text.match(/^([A-Za-z]+): (.+)$/);
          if (!m) continue;
          const [, key, val] = m;
          if (key === 'foreignKeyName' || key === 'referencedRelation') (rel as any)[key] = JSON.parse(val);
          else if (key === 'isOneToOne') rel.isOneToOne = val === 'true';
          else if (key === 'columns' || key === 'referencedColumns') (rel as any)[key] = JSON.parse(val);
        }
        continue;
      }
      continue;
    }

    if (section === 'Functions') {
      if (ind === 6) {
        const oneLine = text.match(/^([A-Za-z_0-9]+): \{ Args: (.+?); Returns: (.+) \}$/);
        if (oneLine) { out.functions.push({ name: oneLine[1], args: oneLine[2], returns: oneLine[3] }); continue; }
        const open = text.match(/^([A-Za-z_0-9]+): \{$/);
        if (open) { fn = { name: open[1], args: '', returns: '' }; fnDepth = 0; out.functions.push(fn); continue; }
        if (text === '}') { fn = null; continue; }
      }
      if (fn && ind === 8) {
        const a = text.match(/^Args: (.+)$/);
        const r = text.match(/^Returns: (.+)$/);
        if (a) fn.args = a[1] === '{' ? 'object' : a[1];
        if (r) fn.returns = r[1] === '{' ? 'record' : r[1];
      }
      continue;
    }

    if (section === 'Enums') {
      if (ind === 6) {
        const m = text.match(/^([A-Za-z_0-9]+):(?: (.+))?$/);
        if (m) {
          pendingEnum = { name: m[1], values: [] };
          out.enums.push(pendingEnum);
          if (m[2]) pendingEnum.values.push(...extractStringLiterals(m[2]));
        }
      } else if (ind === 8 && pendingEnum) {
        pendingEnum.values.push(...extractStringLiterals(text));
      }
      continue;
    }
  }
  return out;
}

function extractStringLiterals(s: string): string[] {
  return [...s.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
}
