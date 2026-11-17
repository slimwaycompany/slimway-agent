export function phoneTail(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}
