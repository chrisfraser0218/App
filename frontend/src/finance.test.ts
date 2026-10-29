import { describe, expect, it } from "vitest";
import { cashFlow, localDate, validMoney } from "./finance";
import type { Transaction } from "./api";
describe("financial presentation", () => {
  it("groups daily cash flow without cent rounding errors and excludes other months", () => {
    const entry = (amount: string, date = "2026-02-03"): Transaction => ({
      id: amount,
      description: "Test",
      amount,
      type: "EXPENSE",
      categoryId: "category",
      date,
    });
    const points = cashFlow(
      [entry("0.10"), entry("0.20"), entry("400", "2026-01-03")],
      "2026-02",
    );
    expect(points).toHaveLength(28);
    expect(points[2].Expenses).toBe(0.3);
    expect(points[2].Income).toBe(0);
  });
  it("formats dates in local time", () => {
    expect(localDate(new Date(2026, 0, 2))).toBe("2026-01-02");
  });
  it("validates money without accepting exponents, excess decimals, zero expenses or overflows", () => {
    for (const input of ["0", "-1", "1e3", "1.001", "1000000000000", "NaN", ""])
      expect(validMoney(input)).toBe(false);
    expect(validMoney("0.01")).toBe(true);
    expect(validMoney("-20.50", true)).toBe(true);
    expect(validMoney("0", true)).toBe(true);
  });
});
