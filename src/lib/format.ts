export const eur = new Intl.NumberFormat("pt-PT", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

export function formatEur(amount: number | string) {
  const num = typeof amount === "string" ? Number(amount) : amount;
  return eur.format(num || 0);
}
