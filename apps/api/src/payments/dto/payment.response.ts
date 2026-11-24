import { toContract } from '../../common/contract.js';
import { ngweeToKwacha } from '../../common/money.js';
import { FAILURE_WORDING, isOpenPayment } from '../domain/payment.js';
import type { PaymentView } from '../payments.repository.js';

export interface PaymentLineResponse {
  kind: 'PREMIUM' | 'ADD_ON' | 'CHARGE';
  code: string;
  label: string;
  amount: number;
}

/**
 * A payment attempt as its customer follows it. It is a status, never a
 * receipt until the provider has confirmed the money.
 */
export interface PaymentResponse {
  transactionId: string;
  status: string;
  method: string;
  amount: number;
  rtsaAnniversaryFee: number;
  breakdown: PaymentLineResponse[];
  currency: string;
  /** The masked wallet the approval prompt went to. */
  payer: string | null;
  initiatedAt: string | null;
  /** Until then the price is held; after it, an attempt still waiting is stopped. */
  pendingUntil: string | null;
  confirmedAt: string | null;
  /** Card only, and only while the attempt is open. */
  checkoutUrl: string | null;
  failure: string | null;
  quoteRequestId: string;
  insurerQuoteId: string;
  insurer: string;
  policyNumber: string | null;
  policyStatus: string | null;
}

export function toPaymentResponse(view: PaymentView): PaymentResponse {
  const open = isOpenPayment(view.status);
  return {
    transactionId: view.transactionId,
    status: toContract.paymentStatus(view.status),
    method: toContract.paymentMethod(view.method),
    amount: ngweeToKwacha(view.amountMinor),
    rtsaAnniversaryFee: ngweeToKwacha(view.rtsaAnniversaryFeeMinor),
    breakdown: view.amountBreakdown.map((line) => ({ kind: line.kind, code: line.code, label: line.label, amount: ngweeToKwacha(line.amountMinor) })),
    currency: view.currency,
    payer: view.payerMsisdnMasked,
    initiatedAt: view.initiatedAt?.toISOString() ?? null,
    pendingUntil: view.pendingUntil?.toISOString() ?? null,
    confirmedAt: view.confirmedAt?.toISOString() ?? null,
    checkoutUrl: open ? view.checkoutUrl : null,
    failure: open || view.status === 'CONFIRMED' ? null : failureText(view),
    quoteRequestId: view.quoteRequestId,
    insurerQuoteId: view.insurerQuoteId,
    insurer: view.insurerName,
    policyNumber: view.policyNumber,
    policyStatus: view.policyStatus ? toContract.policyStatus(view.policyStatus) : null,
  };
}

function failureText(view: PaymentView): string {
  if (view.status === 'REVERSED') return 'The payment was reversed by the provider. Our team will contact you.';
  if (view.status === 'CANCELLED') return FAILURE_WORDING.CANCELLED;
  if (view.status === 'EXPIRED') return FAILURE_WORDING[view.failureCode ?? 'EXPIRED'] ?? FAILURE_WORDING.EXPIRED;
  return FAILURE_WORDING[view.failureCode ?? 'DECLINED'] ?? FAILURE_WORDING.DECLINED;
}
