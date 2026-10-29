import type { Transaction } from "./api";
export const money = (amount: string | number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(amount),
  );
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function cashFlow(transactions: Transaction[], month: string) {
  const days = new Date(
    Number(month.slice(0, 4)),
    Number(month.slice(5, 7)),
    0,
  ).getDate();
  const result = Array.from({ length: days }, (_, i) => ({
    day: i + 1,
    Income: 0,
    Expenses: 0,
  }));
  for (const transaction of transactions) {
    if (transaction.date.startsWith(month)) {
      const point = result[Number(transaction.date.slice(-2)) - 1];
      point[transaction.type === "INCOME" ? "Income" : "Expenses"] +=
        Math.round(Number(transaction.amount) * 100);
    }
  }
  return result.map((point) => ({
    ...point,
    Income: point.Income / 100,
    Expenses: point.Expenses / 100,
  }));
}
export function validMoney(value: string, signed = false) {
  return (
    (signed ? /^-?\d{1,12}(\.\d{1,2})?$/ : /^\d{1,12}(\.\d{1,2})?$/).test(
      value,
    ) &&
    (signed || Number(value) > 0)
  );
}
