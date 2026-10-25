import type { ClientBase } from 'pg';

/**
 * The application catalog of `public` as sorted text records, compared by name and
 * definition, never by OID. `_prisma_migrations` and its parts are left out.
 *
 * Schema level: every object PostgreSQL records as living in `public`, so an object of
 * any kind is seen without this reader knowing the kind. Members are those objects and
 * everything that depends on them internally or automatically (columns, constraints,
 * indexes, defaults, row and array types, owned sequences, TOAST). A dependency from a
 * non-member onto a member is reported, which catches an object in another schema built
 * on `public`. A member in a catalog the table level does not describe, such as a table's
 * publication membership or a statistics object elsewhere, is recorded by identity. Table
 * level: definitions of relations, columns, constraints, indexes, triggers, policies, rules,
 * functions, enums and domains among the members.
 */
const CATALOG_QUERY = `
WITH RECURSIVE
direct AS (
  SELECT d.classid, d.objid
  FROM pg_depend d
  WHERE d.refclassid = 'pg_namespace'::regclass
    AND d.refobjid = to_regnamespace('public')
    AND d.deptype IN ('n', 'a')
    AND NOT (d.classid = 'pg_class'::regclass
             AND d.objid IS NOT DISTINCT FROM to_regclass('public._prisma_migrations'))
),
members (classid, objid) AS (
  SELECT classid, objid FROM direct
  UNION
  SELECT d.classid, d.objid
  FROM pg_depend d
  JOIN members m ON d.refclassid = m.classid AND d.refobjid = m.objid
  WHERE d.deptype IN ('i', 'a')
),
relations AS (
  SELECT c.*
  FROM pg_class c
  JOIN members m ON m.classid = 'pg_class'::regclass AND m.objid = c.oid
  WHERE c.relkind <> 't' AND c.relnamespace <> 'pg_toast'::regnamespace
),
tables AS (
  SELECT * FROM relations WHERE relkind IN ('r', 'p', 'f', 'v', 'm', 'c')
),
records (record) AS (
  SELECT 'object ' || o.type || ' ' || o.identity
  FROM (SELECT DISTINCT classid, objid FROM direct) x,
       LATERAL pg_identify_object(x.classid, x.objid, 0) o
UNION ALL
  SELECT DISTINCT 'member ' || o.type || ' ' || o.identity
  FROM members m
  CROSS JOIN LATERAL pg_identify_object(m.classid, m.objid, 0) o
  WHERE m.classid NOT IN ('pg_class'::regclass, 'pg_constraint'::regclass, 'pg_type'::regclass,
                          'pg_proc'::regclass, 'pg_attrdef'::regclass, 'pg_trigger'::regclass,
                          'pg_policy'::regclass, 'pg_rewrite'::regclass)
    AND NOT EXISTS (SELECT 1 FROM direct x WHERE x.classid = m.classid AND x.objid = m.objid)
UNION ALL
  SELECT DISTINCT 'outside dependant ' || o.type || ' ' || o.identity
  FROM pg_depend d
  JOIN members m ON d.refclassid = m.classid AND d.refobjid = m.objid
  CROSS JOIN LATERAL pg_identify_object(d.classid, d.objid, d.objsubid) o
  WHERE NOT EXISTS (SELECT 1 FROM members x WHERE x.classid = d.classid AND x.objid = d.objid)
UNION ALL
  SELECT format(
    'relation %s kind=%s persistence=%s rls=%s force_rls=%s replica_identity=%s options=%s access_method=%s parents=%s',
    r.oid::regclass, r.relkind, r.relpersistence, r.relrowsecurity, r.relforcerowsecurity,
    r.relreplident, coalesce(array_to_string(r.reloptions, ','), ''), coalesce(am.amname, ''),
    coalesce((SELECT string_agg(i.inhparent::regclass::text, ',' ORDER BY i.inhseqno)
              FROM pg_inherits i WHERE i.inhrelid = r.oid), ''))
  FROM relations r
  LEFT JOIN pg_am am ON am.oid = r.relam
UNION ALL
  SELECT format(
    'column %s.%s type=%s not_null=%s default=%s collation=%s identity=%s generated=%s',
    t.oid::regclass, quote_ident(a.attname), format_type(a.atttypid, a.atttypmod), a.attnotnull,
    coalesce(pg_get_expr(ad.adbin, ad.adrelid), ''),
    coalesce((SELECT quote_ident(n.nspname) || '.' || quote_ident(co.collname)
              FROM pg_collation co JOIN pg_namespace n ON n.oid = co.collnamespace
              WHERE co.oid = a.attcollation), ''),
    a.attidentity, a.attgenerated)
  FROM tables t
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
UNION ALL
  SELECT format('constraint %s on %s type=%s %s', quote_ident(c.conname),
    CASE WHEN c.conrelid <> 0 THEN c.conrelid::regclass::text ELSE c.contypid::regtype::text END,
    c.contype, pg_get_constraintdef(c.oid))
  FROM pg_constraint c
  JOIN members m ON m.classid = 'pg_constraint'::regclass AND m.objid = c.oid
UNION ALL
  SELECT format('index %s valid=%s ready=%s', pg_get_indexdef(i.indexrelid), i.indisvalid, i.indisready)
  FROM pg_index i
  JOIN tables t ON t.oid = i.indrelid
UNION ALL
  SELECT format('trigger %s enabled=%s', pg_get_triggerdef(tg.oid), tg.tgenabled)
  FROM pg_trigger tg
  JOIN tables t ON t.oid = tg.tgrelid
  WHERE NOT tg.tgisinternal
UNION ALL
  SELECT format('internal trigger for %s on %s enabled=%s',
    coalesce((SELECT quote_ident(c.conname) FROM pg_constraint c WHERE c.oid = tg.tgconstraint), ''),
    t.oid::regclass, tg.tgenabled)
  FROM pg_trigger tg
  JOIN tables t ON t.oid = tg.tgrelid
  WHERE tg.tgisinternal AND tg.tgenabled <> 'O'
UNION ALL
  SELECT format('policy %s on %s command=%s permissive=%s roles=%s using=%s check=%s',
    quote_ident(p.polname), p.polrelid::regclass, p.polcmd, p.polpermissive,
    (SELECT string_agg(name, ',' ORDER BY name)
     FROM (SELECT CASE WHEN role = 0 THEN 'public' ELSE role::regrole::text END AS name
           FROM unnest(p.polroles) role) roles),
    coalesce(pg_get_expr(p.polqual, p.polrelid), ''),
    coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''))
  FROM pg_policy p
  JOIN tables t ON t.oid = p.polrelid
UNION ALL
  SELECT format('rule %s on %s %s', quote_ident(rw.rulename), t.oid::regclass, pg_get_ruledef(rw.oid))
  FROM pg_rewrite rw
  JOIN tables t ON t.oid = rw.ev_class
  WHERE NOT (rw.rulename = '_RETURN' AND t.relkind IN ('v', 'm'))
UNION ALL
  SELECT format('function %s kind=%s %s', p.oid::regprocedure, p.prokind,
    CASE WHEN p.prokind = 'a' THEN '' ELSE pg_get_functiondef(p.oid) END)
  FROM pg_proc p
  JOIN members m ON m.classid = 'pg_proc'::regclass AND m.objid = p.oid
UNION ALL
  SELECT format('enum %s values=%s', ty.oid::regtype,
    (SELECT string_agg(quote_literal(e.enumlabel), ',' ORDER BY e.enumsortorder)
     FROM pg_enum e WHERE e.enumtypid = ty.oid))
  FROM pg_type ty
  JOIN members m ON m.classid = 'pg_type'::regclass AND m.objid = ty.oid
  WHERE ty.typtype = 'e'
UNION ALL
  SELECT format('domain %s base=%s not_null=%s default=%s collation=%s', ty.oid::regtype,
    format_type(ty.typbasetype, ty.typtypmod), ty.typnotnull, coalesce(ty.typdefault, ''),
    coalesce((SELECT quote_ident(n.nspname) || '.' || quote_ident(co.collname)
              FROM pg_collation co JOIN pg_namespace n ON n.oid = co.collnamespace
              WHERE co.oid = ty.typcollation), ''))
  FROM pg_type ty
  JOIN members m ON m.classid = 'pg_type'::regclass AND m.objid = ty.oid
  WHERE ty.typtype = 'd'
)
SELECT record FROM records
`;

export type Catalog = string[];

/** Reads the catalog of `public`. Deparses with a fixed search_path and restores the caller's. */
export async function readCatalog(client: ClientBase): Promise<Catalog> {
  const saved = await client.query<{ path: string }>(
    `SELECT pg_catalog.current_setting('search_path') AS path`,
  );
  await client.query(`SELECT pg_catalog.set_config('search_path', 'pg_catalog, pg_temp', false)`);
  try {
    const { rows } = await client.query<{ record: string }>(CATALOG_QUERY);
    return rows.map((row) => row.record).sort(compareText);
  } finally {
    await client.query(`SELECT pg_catalog.set_config('search_path', $1, false)`, [saved.rows[0].path]);
  }
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const NAME = String.raw`(?:"(?:[^"]|"")*"|[^\s".(),]+)`;
const QUALIFIED = String.raw`${NAME}(?:\.${NAME})*`;
const SKIP = String.raw`(?:"(?:[^"]|"")*"|[^"])*?`;
const ARGUMENTS = String.raw`\((?:"(?:[^"]|"")*"|[^")])*\)`;

// What names each record's object; the rest is its definition, which can hold literals.
const IDENTITIES: [RegExp, (match: RegExpExecArray) => string][] = [
  [
    new RegExp(String.raw`^((?:object|member|outside dependant) default acl) for role ${NAME}((?: in schema ${NAME})? on [a-z ]+)$`),
    (match) => `${match[1]}${match[2]}`,
  ],
  [/^((?:object|member|outside dependant) [^\n]*)$/, (match) => match[1]],
  [new RegExp(String.raw`^(relation ${QUALIFIED}) kind=`), (match) => match[1]],
  [new RegExp(String.raw`^(column ${QUALIFIED}) type=`), (match) => match[1]],
  [new RegExp(String.raw`^(constraint ${NAME} on ${QUALIFIED}) type=`), (match) => match[1]],
  [
    new RegExp(String.raw`^index CREATE (?:UNIQUE )?INDEX (${NAME}) ON (?:ONLY )?(${QUALIFIED}) `),
    (match) => `index ${match[1]} on ${match[2]}`,
  ],
  [
    new RegExp(String.raw`^trigger CREATE (?:CONSTRAINT )?TRIGGER (${NAME}) ${SKIP} ON (${QUALIFIED}) `),
    (match) => `trigger ${match[1]} on ${match[2]}`,
  ],
  [new RegExp(String.raw`^(internal trigger for (?:${NAME})? on ${QUALIFIED}) enabled=`), (match) => match[1]],
  [new RegExp(String.raw`^(policy ${NAME} on ${QUALIFIED}) command=`), (match) => match[1]],
  [new RegExp(String.raw`^(rule ${NAME} on ${QUALIFIED}) `), (match) => match[1]],
  [new RegExp(String.raw`^(function ${QUALIFIED}${ARGUMENTS}) kind=`), (match) => match[1]],
  [new RegExp(String.raw`^(enum ${QUALIFIED}) values=`), (match) => match[1]],
  [new RegExp(String.raw`^(domain ${QUALIFIED}) base=`), (match) => match[1]],
];

function identityOf(record: string): string {
  for (const [pattern, identity] of IDENTITIES) {
    const match = pattern.exec(record);
    if (match) return identity(match);
  }
  return 'unrecognised record';
}

export interface CatalogDifference {
  status: 'missing' | 'extra' | 'different';
  identity: string;
}

/** The records that differ, by identity only, so a definition is never printed. */
export function catalogDifferences(actual: Catalog, expected: Catalog): CatalogDifference[] {
  const byIdentity = (catalog: Catalog) => {
    const records = new Map<string, string[]>();
    for (const record of catalog) {
      const identity = identityOf(record);
      records.set(identity, [...(records.get(identity) ?? []), record]);
    }
    return records;
  };
  const actualRecords = byIdentity(actual);
  const expectedRecords = byIdentity(expected);
  const differences: CatalogDifference[] = [];
  for (const identity of [...new Set([...actualRecords.keys(), ...expectedRecords.keys()])].sort(compareText)) {
    const mine = actualRecords.get(identity);
    const theirs = expectedRecords.get(identity);
    if (!theirs) {
      differences.push({ status: 'extra', identity });
    } else if (!mine) {
      differences.push({ status: 'missing', identity });
    } else if (!sameCatalog([...mine].sort(compareText), [...theirs].sort(compareText))) {
      differences.push({ status: 'different', identity });
    }
  }
  return differences;
}

export function sameCatalog(actual: Catalog, expected: Catalog): boolean {
  return (
    actual.length === expected.length && actual.every((record, index) => record === expected[index])
  );
}
