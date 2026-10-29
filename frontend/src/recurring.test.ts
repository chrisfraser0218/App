import { describe, expect, it } from "vitest";
import { recurringTotals, validPaymentDays } from "./recurring";
import type { RecurringRule } from "./api";

const rule = (
  amount: string,
  frequency: RecurringRule["frequency"],
  type: "INCOME" | "EXPENSE" = "EXPENSE",
  status: RecurringRule["status"] = "ACTIVE",
): RecurringRule => ({
  id: amount + frequency,
  requestId: "request",
  description: "Synthetic",
  amount,
  frequency,
  type,
  categoryId: "category",
  startDate: "2026-01-01",
  endDate: null,
  nextDate: "2026-02-01",
  paymentDay: null,
  secondPaymentDay: null,
  enabled: status === "ACTIVE",
  archived: status === "CANCELED",
  version: 0,
  status,
  catchUpPending: false,
});
describe("recurring financial summaries", () => {
  it("keeps daily, weekly, biweekly, twice-monthly, monthly and yearly amounts separate", () => {
    const result = recurringTotals(
      [
        rule("10", "WEEKLY"),
        rule("25", "BIWEEKLY"),
        rule("100", "MONTHLY"),
        rule("50", "TWICE_MONTHLY"),
        rule("1", "DAILY"),
        rule("1200", "YEARLY"),
      ],
      "EXPENSE",
    );
    expect(
      Object.fromEntries(result.map((x) => [x.frequency, x.amount])),
    ).toEqual({
      WEEKLY: 10,
      BIWEEKLY: 25,
      MONTHLY: 100,
      TWICE_MONTHLY: 50,
      DAILY: 1,
      YEARLY: 1200,
    });
  });
  it("sums cents exactly within cadence and excludes inactive schedules and the opposite direction", () => {
    expect(
      recurringTotals(
        [
          rule("0.10", "MONTHLY"),
          rule("0.20", "MONTHLY"),
          rule("500", "MONTHLY", "INCOME"),
          rule("40", "MONTHLY", "EXPENSE", "PAUSED"),
          rule("50", "MONTHLY", "EXPENSE", "CANCELED"),
          rule("60", "MONTHLY", "EXPENSE", "COMPLETED"),
        ],
        "EXPENSE",
      ),
    ).toEqual([{ frequency: "MONTHLY", amount: 0.3 }]);
  });
  it("requires distinct ordered configured days and permits days that later clamp together", () => {
    expect(validPaymentDays("TWICE_MONTHLY", 30, 31)).toBe(true);
    expect(validPaymentDays("TWICE_MONTHLY", 15, 15)).toBe(false);
    expect(validPaymentDays("TWICE_MONTHLY", 20, 15)).toBe(false);
    expect(validPaymentDays("MONTHLY", 32, 15)).toBe(false);
    expect(validPaymentDays("MONTHLY", 1.5, 15)).toBe(false);
  });
});
