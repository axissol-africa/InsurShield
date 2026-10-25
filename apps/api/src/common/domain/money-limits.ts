// The database CHECK constraints on money and rate columns use these bounds.
export const MIN_NGWEE = 0n;
export const MAX_NGWEE = 99999999999999n;
export const MAX_KWACHA = Number(MAX_NGWEE) / 100;
export const MIN_RATE_BPS = 0;
export const MAX_RATE_BPS = 10000;
