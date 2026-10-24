import { Injectable } from '@nestjs/common';
import { percentToBps } from '../common/money.js';
import { toPiaResponse } from './dto/pia.dto.js';
import { PiaRepository } from './pia.repository.js';

@Injectable()
export class PiaService {
  constructor(private readonly pia: PiaRepository) {}

  async get() {
    return toPiaResponse(await this.pia.find());
  }

  async set(piaRatePercentage: number, staffId: string) {
    const saved = await this.pia.transaction(async (tx) => {
      await this.pia.save(tx, percentToBps(piaRatePercentage), staffId);
      return this.pia.find(tx);
    });
    return toPiaResponse(saved);
  }
}
