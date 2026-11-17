export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return '7' + digits.slice(-10);
}
