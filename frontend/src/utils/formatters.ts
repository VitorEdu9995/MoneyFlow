/**
 * Formatadores padronizados conforme o Manual de Marca MoneyFlow.
 */

export function formatCurrency(value: number, isCents = true): string {
  const amount = isCents ? value / 100 : value;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount || 0);
}

export function formatDate(dateString: string): string {
  if (!dateString) return '';
  const parts = dateString.slice(0, 10).split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateString;
}

export function formatPercent(value: number): string {
  return `${Math.round(value || 0)}%`;
}
