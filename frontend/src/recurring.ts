import type { Frequency, RecurringRule } from "./api";

export const FREQUENCIES: Record<Frequency, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  BIWEEKLY: "Every two weeks",
  TWICE_MONTHLY: "Twice monthly",
  MONTHLY: "Monthly",
  YEARLY: "Yearly",
};

/** Sums integer cents only within the same cadence; no fabricated monthly equivalent. */
export function recurringTotals(
  rules: RecurringRule[],
  type: "INCOME" | "EXPENSE",
) {
  const totals = new Map<Frequency, number>();
  for (const rule of rules.filter(
    (r) => r.status === "ACTIVE" && r.type === type,
  )) {
    totals.set(
      rule.frequency,
      (totals.get(rule.frequency) ?? 0) + Math.round(Number(rule.amount) * 100),
    );
  }
  return [...totals.entries()].map(([frequency, cents]) => ({
    frequency,
    amount: cents / 100,
  }));
}
export function validPaymentDays(
  frequency: Frequency,
  first: number,
  second: number,
) {
  if (frequency !== "MONTHLY" && frequency !== "TWICE_MONTHLY") return true;
  if (!Number.isInteger(first) || first < 1 || first > 31) return false;
  return (
    frequency !== "TWICE_MONTHLY" ||
    (Number.isInteger(second) && second > first && second <= 31)
  );
}
export function shortDate(date: string | null) {
  return date
    ? new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";
}
