import type { BetterAuthOptions } from 'better-auth';
import { getAuthTables, type DBFieldAttribute } from 'better-auth/db';
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig, type AnyPgColumn, type PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { authAccounts, authRateLimits, authSessions, authUsers, authVerifications } from './schema.js';

// Stand-ins for the auth module's options and adapter schema, which the tables must match.
const STAND_IN_AUTH_OPTIONS = {
  emailAndPassword: { enabled: true },
  advanced: { database: { generateId: 'uuid' } },
  rateLimit: { storage: 'database' },
  session: { disableSessionRefresh: true },
} satisfies BetterAuthOptions;

const STAND_IN_ADAPTER_SCHEMA: Record<string, PgTable> = {
  user: authUsers,
  session: authSessions,
  account: authAccounts,
  verification: authVerifications,
  rateLimit: authRateLimits,
};

const declared = getAuthTables(STAND_IN_AUTH_OPTIONS);

/** The Drizzle column type the adapter's own pg generator writes for a field, with uuid ids. */
function adapterColumnType(field: DBFieldAttribute): string {
  if (field.references?.field === 'id') return 'PgUUID';
  switch (field.type) {
    case 'string':
      return 'PgText';
    case 'boolean':
      return 'PgBoolean';
    case 'number':
      return field.bigint ? 'PgBigInt53' : 'PgInteger';
    case 'date':
      return 'PgTimestamp';
    default:
      return `unsupported type ${JSON.stringify(field.type)}`;
  }
}

function indexedAlone(table: PgTable, column: string, unique: boolean): boolean {
  return getTableConfig(table).indexes.some(
    ({ config }) =>
      (unique ? config.unique : true) &&
      config.columns.length === 1 &&
      (config.columns[0] as AnyPgColumn).name === column,
  );
}

describe('the Better Auth tables', () => {
  it('are exactly the models Better Auth declares for these options', () => {
    expect(Object.keys(declared).sort()).toEqual(Object.keys(STAND_IN_ADAPTER_SCHEMA).sort());
    for (const [model, table] of Object.entries(declared)) {
      expect(table.modelName, model).toBe(model);
    }
    expect(new Set(Object.values(STAND_IN_ADAPTER_SCHEMA)).size).toBe(Object.keys(STAND_IN_ADAPTER_SCHEMA).length);
  });

  describe.each(Object.keys(STAND_IN_ADAPTER_SCHEMA))('%s', (model) => {
    const table = STAND_IN_ADAPTER_SCHEMA[model];
    const fields = Object.entries(declared[model].fields);
    const columns = getTableColumns(table);

    it('has an id column and one column per declared field, each named as the field', () => {
      expect(Object.keys(columns).sort()).toEqual(['id', ...fields.map(([key, field]) => field.fieldName ?? key)].sort());
      for (const [key, column] of Object.entries(columns)) {
        expect(column.name, key).toBe(key);
      }
    });

    it('has a uuid primary key the database layer fills', () => {
      expect(columns.id).toMatchObject({ columnType: 'PgUUID', primary: true, notNull: true, hasDefault: true });
    });

    it.each(fields)('maps %s as the adapter does, required and unique as declared', (key, field) => {
      const column = columns[field.fieldName ?? key];
      expect(column.columnType).toBe(adapterColumnType(field));
      if (field.type === 'date') {
        expect(column.dataType).toBe('date');
      }
      expect(column.notNull).toBe(field.required !== false);
      expect(indexedAlone(table, column.name, true)).toBe(field.unique === true);
      if (field.index) {
        expect(indexedAlone(table, column.name, false)).toBe(true);
      }
    });

    it('references each declared table with the declared delete rule', () => {
      const references = fields.flatMap(([key, { fieldName, references: target }]) =>
        target
          ? [
              {
                column: fieldName ?? key,
                table: getTableConfig(STAND_IN_ADAPTER_SCHEMA[target.model]).name,
                foreignColumn: target.field,
                onDelete: target.onDelete ?? 'cascade',
              },
            ]
          : [],
      );
      const foreignKeys = getTableConfig(table).foreignKeys.map((foreignKey) => {
        const { columns: local, foreignColumns, foreignTable } = foreignKey.reference();
        return {
          column: local.map((column) => column.name).join(),
          table: getTableConfig(foreignTable).name,
          foreignColumn: foreignColumns.map((column) => column.name).join(),
          onDelete: foreignKey.onDelete,
        };
      });
      expect(foreignKeys).toEqual(references);
    });
  });
});
