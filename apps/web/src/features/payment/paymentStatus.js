export const isHeldPayment = (payment) => Boolean(
  payment && payment.status !== 'Reversed' && !payment.policyNumber &&
    (payment.status === 'Confirmed' || payment.confirmedAt),
);
