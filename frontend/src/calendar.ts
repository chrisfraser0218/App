import type { TransactionType } from "./api";
import type { ForecastDay, ForecastResult } from "./forecast";
export interface CalendarEntry {
  id: string;
  description: string;
  amount: string | null;
  type: TransactionType | null;
  category: string | null;
  source: "RECURRING" | "PLANNED" | "RECORDED";
  status: string;
  scheduledDate: string | null;
  recurringRuleId: string | null;
  plannedTransactionId: string | null;
  transactionId: string | null;
  projected: boolean;
  note: string;
}
export interface CalendarDay {
  date: string;
  today: boolean;
  projection: ForecastDay | null;
  flows: {
    scheduledIncome: string;
    scheduledExpenses: string;
    plannedIncome: string;
    plannedExpenses: string;
  } | null;
  warnings: ForecastResult["warnings"];
  entries: CalendarEntry[];
}
export interface CalendarMonth {
  month: string;
  asOfDate: string;
  timeZone: string;
  minMonth: string;
  maxMonth: string;
  lowBalanceThreshold: string;
  historicalExplanation: string;
  summary: {
    upcomingExpenses: string;
    expectedIncome: string;
    nextBill: CalendarEntry | null;
    monthEndBalance: string | null;
    lowestBalance: string | null;
    lowestDate: string | null;
  };
  days: CalendarDay[];
}
export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1, 12);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
export function shiftDate(date: string, delta: number) {
  const d = new Date(date + "T12:00:00");
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function calendarCells(days: CalendarDay[]) {
  if (!days.length) return [];
  const offset = new Date(days[0].date + "T12:00:00").getDay();
  const cells: (CalendarDay | null)[] = [...Array(offset).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  return cells;
}
