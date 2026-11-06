import { Injectable } from '@nestjs/common';
import { percentToBps } from '../common/money.js';
import type { Transaction } from '../db/database.module.js';
import { toPiaResponse } from './dto/pia.dto.js';
import { PiaRepository } from './pia.repository.js';
import { DEFAULT_PIA_RATE_BPS } from './pia-rate.js';

@Injectable()
export class PiaService {
  constructor(private readonly pia: PiaRepository) {}

  async get() {
    return toPiaResponse(await this.pia.find());
  }

  /** The current regulatory rate in basis points, usable inside a caller transaction. */
  async currentRateBps(tx?: Transaction): Promise<number> {
    return (await this.pia.find(tx))?.piaRateBps ?? DEFAULT_PIA_RATE_BPS;
  }

  async set(piaRatePercentage: number, staffId: string) {
    const saved = await this.pia.transaction(async (tx) => {
      await this.pia.save(tx, percentToBps(piaRatePercentage), staffId);
      return this.pia.find(tx);
    });
    return toPiaResponse(saved);
  }
}
