import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { DATABASE, type Transaction } from '../db/database.module.js';
import { AccountRepository } from './account.repository.js';

describe('account policy end dates', () => {
  it('keeps cover through the Lusaka end day and protects an unknown end date', async () => {
    const rows = [
      { status: 'ACTIVE', policyNumber: 'ending', endDate: new Date('2026-11-25T00:00:00Z') },
      { status: 'ACTIVE', policyNumber: 'unknown', endDate: null },
      { status: 'ACTIVE', policyNumber: 'ended', endDate: new Date('2026-11-24T00:00:00Z') },
      { status: 'AWAITING_INSURER_CERTIFICATE', policyNumber: 'pending', endDate: new Date('2026-11-24T00:00:00Z') },
      { status: 'AWAITING_INSURER_CERTIFICATE', policyNumber: 'pending-unknown', endDate: null },
    ];
    const query = {
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn().mockResolvedValue(rows),
    };
    query.from.mockReturnValue(query);
    query.where.mockReturnValue(query);
    const database = {
      select: vi.fn().mockReturnValue(query),
      transaction: (work: (tx: object) => Promise<unknown>) => work(database),
    };
    const module = await Test.createTestingModule({
      providers: [AccountRepository, { provide: DATABASE, useValue: database }],
    }).compile();
    const repository = module.get(AccountRepository);
    const at = (time: string) => repository.transaction((tx: Transaction) => repository.policiesInForce(tx, 'customer', new Date(time)));
    expect(await at('2026-11-25T21:59:59.999Z')).toEqual(['ending', 'unknown', 'pending', 'pending-unknown']);
    expect(await at('2026-11-25T22:00:00.000Z')).toEqual(['unknown', 'pending', 'pending-unknown']);
  });
});
