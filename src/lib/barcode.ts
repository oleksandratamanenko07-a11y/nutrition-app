/** Перевірка контрольної цифри штрихкоду (EAN-8, UPC-A, EAN-13, GTIN-14). */
export function isValidBarcode(code: string): boolean {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  // Ваги 3 і 1, починаючи з 3 для цифри, що стоїть найближче до контрольної
  let sum = 0;
  digits.reverse().forEach((d, i) => {
    sum += d * (i % 2 === 0 ? 3 : 1);
  });
  return (10 - (sum % 10)) % 10 === check;
}
