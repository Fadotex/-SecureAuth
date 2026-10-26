export type HostelPaymentState = 'UNPAID' | 'INCOMPLETE' | 'COMPLETE';

export function requiredDepositPesewas(pricePesewas: number, depositBps: number) {
  if (!Number.isSafeInteger(pricePesewas) || pricePesewas < 0) throw new RangeError('Price must be a non-negative integer in pesewas.');
  if (!Number.isSafeInteger(depositBps) || depositBps < 0 || depositBps > 10_000) throw new RangeError('Deposit must be between 0 and 10000 basis points.');
  return Math.ceil(pricePesewas * depositBps / 10_000);
}

export function remainingBalancePesewas(pricePesewas: number, paidPesewas: number) {
  if (!Number.isSafeInteger(pricePesewas) || !Number.isSafeInteger(paidPesewas) || pricePesewas < 0 || paidPesewas < 0) {
    throw new RangeError('Money values must be non-negative safe integers in pesewas.');
  }
  return Math.max(0, pricePesewas - paidPesewas);
}

export function hostelPaymentState(pricePesewas: number, paidPesewas: number): HostelPaymentState {
  if (pricePesewas < 0 || paidPesewas < 0) throw new RangeError('Money values cannot be negative.');
  if (paidPesewas >= pricePesewas) return 'COMPLETE';
  return paidPesewas > 0 ? 'INCOMPLETE' : 'UNPAID';
}

export function isPaymentWithinBalance(amountPesewas: number, balancePesewas: number) {
  return Number.isSafeInteger(amountPesewas) && amountPesewas > 0
    && Number.isSafeInteger(balancePesewas) && balancePesewas >= 0
    && amountPesewas <= balancePesewas;
}