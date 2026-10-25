import { toContract } from '../../common/contract.js';
import { ngweeToKwacha } from '../../common/money.js';
import type { ReceiptRow } from '../payments.repository.js';

export interface ReceiptResponse {
  transactionId: string;
  status: string;
  method: string;
  amount: number;
  currency: string;
  confirmedAt: string | null;
  quoteRequestId: string;
  policyNumber: string | null;
}

export function toReceipt(row: ReceiptRow): ReceiptResponse {
  return {
    transactionId: row.transactionId,
    status: toContract.paymentStatus(row.status),
    method: toContract.paymentMethod(row.method),
    amount: ngweeToKwacha(row.amountMinor),
    currency: row.currency,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    quoteRequestId: row.quoteRequestId,
    policyNumber: row.policyNumber,
  };
}
