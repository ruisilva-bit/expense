export const eur = new Intl.NumberFormat("pt-PT", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

const axisNumber = new Intl.NumberFormat("pt-PT", {
  maximumFractionDigits: 1,
});

export function formatEur(amount: number | string) {
  const num = typeof amount === "string" ? Number(amount) : amount;
  return eur.format(num || 0);
}

export function formatEurAxis(amount: number | string) {
  const num = typeof amount === "string" ? Number(amount) : amount;
  const safe = Number.isFinite(num) ? num : 0;
  const absolute = Math.abs(safe);
  if (absolute >= 1_000_000) {
    return `${axisNumber.format(safe / 1_000_000)}M€`;
  }
  if (absolute >= 1_000) {
    return `${axisNumber.format(safe / 1_000)}k€`;
  }
  return `${axisNumber.format(safe)}€`;
}
