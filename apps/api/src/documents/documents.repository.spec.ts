import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import type { Transaction } from '../db/database.module.js';
import * as schema from '../db/schema.js';
import { DocumentsRepository } from './documents.repository.js';

function recordingTransaction() {
  const statements: string[] = [];
  const client = {
    query: async (query: { text: string }) => {
      statements.push(query.text);
      return { rows: [], fields: [] };
    },
  };
  const tx = drizzle({ client: client as unknown as Pool, schema }) as unknown as Transaction;
  return { tx, statements };
}

describe('lockForAttach', () => {
  it('locks the rows for update in id order', async () => {
    const { tx, statements } = recordingTransaction();
    const repository = new DocumentsRepository({} as never);

    await repository.lockForAttach(tx, ['b0000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000000']);

    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/ order by "documents"\."id" asc for update$/);
  });
});
