import type { TransactionType } from "./api";
import { localDate, validMoney } from "./finance";
export interface ForecastEvent {
  id: string;
  source: "RECURRING" | "PLANNED" | "HYPOTHETICAL";
  sourceId: string;
  description: string;
  type: TransactionType;
  amount: string;
  category: string | null;
  scheduledDate: string;
  effectiveDate: string;
  overdue: boolean;
}
export interface ForecastDay {
  date: string;
  startingBalance: string;
  income: string;
  expenses: string;
  netChange: string;
  endingBalance: string;
  transactions: ForecastEvent[];
}
export interface ForecastMonth {
  month: string;
  periodStart: string;
  periodEnd: string;
  startingBalance: string;
  income: string;
  expenses: string;
  netChange: string;
  endingBalance: string;
}
export interface ForecastSummary {
  asOfDate: string;
  endDate: string;
  timeZone: string;
  currentActualBalance: string;
  projectedBalance: string;
  totalIncome: string;
  totalExpenses: string;
  lowestBalance: string;
  lowestDate: string;
  netChange: string;
  recurringIncome: string;
  recurringExpenses: string;
  plannedIncome: string;
  plannedExpenses: string;
  hypotheticalIncome: string;
  hypotheticalExpenses: string;
  overdueOccurrences: number;
  overduePlans: number;
}
export interface ForecastResult {
  summary: ForecastSummary;
  lowBalanceThreshold: string;
  days: ForecastDay[];
  months: ForecastMonth[];
  warnings: {
    date: string;
    balance: string;
    severity: "NEGATIVE" | "LOW";
    kind: "CURRENT" | "PROJECTED";
    transactions: ForecastEvent[];
  }[];
}
export interface ForecastComparison {
  baseline: ForecastResult;
  scenario: ForecastResult;
  projectedDifference: string;
}
export interface ForecastPreferences {
  lowBalanceThreshold: string;
  version: number;
  asOfDate: string;
  timeZone: string;
  maxDate: string;
}
export interface Hypothetical {
  id: string;
  description: string;
  amount: string;
  type: TransactionType;
  date: string;
}
export interface PlanInput {
  description: string;
  amount: string;
  type: TransactionType;
  categoryId: string;
  date: string;
  requestId: string;
}
export interface Plan extends PlanInput {
  id: string;
  status: "PLANNED" | "COMPLETED" | "CANCELED";
  version: number;
  transactionId: string | null;
  completionMode: "RECORD" | "LINK" | "HANDLED" | null;
  overdue: boolean;
}
export function addMonthsClamped(date: string, months: number) {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(y, m - 1 + months, 1, 12);
  return localDate(
    new Date(
      target.getFullYear(),
      target.getMonth(),
      Math.min(
        d,
        new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate(),
      ),
      12,
    ),
  );
}
export function nextDate(date: string) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return localDate(d);
}
export function hypotheticalError(
  value: Omit<Hypothetical, "id">,
  today: string,
  end: string,
) {
  if (!value.description.trim()) return "Enter a description.";
  if (!validMoney(value.amount))
    return "Enter a positive amount with at most two decimals.";
  if (value.date <= today || value.date > end)
    return "Choose a future date within the forecast range.";
}
