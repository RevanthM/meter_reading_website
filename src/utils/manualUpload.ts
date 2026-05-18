/** Exactly four digits (leading zeros allowed). */
export function normalizeFourDigitReading(raw: string | null | undefined): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length !== 4) return null;
  return digits;
}
