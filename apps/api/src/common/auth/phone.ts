/** Customers created before registration collected a phone hold this placeholder, which is not a number. */
export function shownPhone(phone: string): string | null {
  return phone.startsWith('pending:') ? null : phone;
}
