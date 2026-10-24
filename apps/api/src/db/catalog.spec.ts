import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { catalogDifferences, type Catalog } from './catalog.js';

const CATALOGS = new URL('../../drizzle/catalog/', import.meta.url);
const SENTINEL = 'p1sentinel';

describe('catalogDifferences', () => {
  it('names each differing record by kind and qualified name, never by its definition', () => {
    const column = (fallback: string) =>
      `column public.payments."referenceNote" type=text not_null=f default='${fallback}'::text collation= identity= generated=`;
    const actual: Catalog = [
      column(`${SENTINEL}_actual`),
      `index CREATE INDEX extra_idx ON public.payments USING btree (reference) WHERE (reference = '${SENTINEL}'::text)`,
      'object table public.intruder',
    ];
    const expected: Catalog = [
      column(`${SENTINEL}_expected`),
      `constraint "payments_amount_check" on public.payments type=c CHECK ((amount <> '${SENTINEL}'::numeric))`,
    ];

    const differences = catalogDifferences(actual, expected);

    expect(differences).toEqual([
      { status: 'different', identity: 'column public.payments."referenceNote"' },
      { status: 'missing', identity: 'constraint "payments_amount_check" on public.payments' },
      { status: 'extra', identity: 'index extra_idx on public.payments' },
      { status: 'extra', identity: 'object table public.intruder' },
    ]);
    expect(JSON.stringify(differences)).not.toContain(SENTINEL);
  });

  it.each([
    [
      'trigger CREATE TRIGGER "on ON t" BEFORE UPDATE OF "x ON y" ON public.payments FOR EACH ROW WHEN ((new.reference = \'s ON t\'::text)) EXECUTE FUNCTION public.f() enabled=O',
      'trigger "on ON t" on public.payments',
    ],
    [
      'trigger CREATE CONSTRAINT TRIGGER t AFTER INSERT ON public.payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.f() enabled=O',
      'trigger t on public.payments',
    ],
    ['index CREATE UNIQUE INDEX "a b" ON ONLY public.payments USING btree (id) valid=t ready=t', 'index "a b" on public.payments'],
    ['function public.f(character varying, "my type"[]) kind=f CREATE OR REPLACE FUNCTION public.f() RETURNS int', 'function public.f(character varying, "my type"[])'],
    ['internal trigger for  on public.payments enabled=D', 'internal trigger for  on public.payments'],
    ['policy p on public.customers command=* permissive=t roles=public using=true check=', 'policy p on public.customers'],
    ['rule r on public.audit_logs CREATE RULE r AS ON DELETE TO public.audit_logs DO INSTEAD NOTHING;', 'rule r on public.audit_logs'],
    ["enum public.\"PaymentStatus\" values='PENDING'", 'enum public."PaymentStatus"'],
    ["domain public.d base=integer not_null=f default=7 collation=", 'domain public.d'],
    ['relation public.payments kind=r persistence=p rls=t force_rls=f replica_identity=d options= access_method=heap parents=', 'relation public.payments'],
    ['member publication relation public.payments in publication p', 'member publication relation public.payments in publication p'],
    ['outside dependant cast (public."PaymentStatus" AS integer)', 'outside dependant cast (public."PaymentStatus" AS integer)'],
    ['a record of no known kind', 'unrecognised record'],
    [`object default acl for role ${SENTINEL}_role in schema public on tables`, 'object default acl in schema public on tables'],
    [`object default acl for role "${SENTINEL} role" on sequences`, 'object default acl on sequences'],
  ])('reads the identity of %s', (record, identity) => {
    expect(catalogDifferences([record], [])).toEqual([{ status: 'extra', identity }]);
  });

  it('compares default privileges by their whole record, though their identity names no role', () => {
    const defaultAcl = (role: string) => `object default acl for role ${role} in schema public on tables`;

    const differences = catalogDifferences([defaultAcl(`${SENTINEL}_actual`)], [defaultAcl(`${SENTINEL}_expected`)]);

    expect(differences).toEqual([{ status: 'different', identity: 'object default acl in schema public on tables' }]);
  });

  it.each(readdirSync(CATALOGS).filter((file) => file.endsWith('.json')))(
    'recognises every record of the expected catalog %s, and no two share an identity',
    (file) => {
      const catalog = JSON.parse(readFileSync(new URL(file, CATALOGS), 'utf8')) as Catalog;
      const identities = catalogDifferences([], catalog).map((difference) => difference.identity);

      expect(identities).toHaveLength(catalog.length);
      expect(new Set(identities).size).toBe(catalog.length);
      for (const identity of identities) {
        expect(identity).not.toMatch(/unrecognised record| type=| kind=|CREATE | values=| base=| enabled=| command=/);
      }
    },
  );
});
