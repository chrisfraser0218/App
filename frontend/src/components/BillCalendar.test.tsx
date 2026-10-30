// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from "@testing-library/react";
import BillCalendar from "./BillCalendar";
import PlanForm from "./PlanForm";
import {
  calendarCells,
  shiftMonth,
  shiftDate,
  type CalendarMonth,
  type CalendarEntry,
} from "../calendar";
import { localDate } from "../finance";
vi.mock("./PlannedTransactions", () => ({
  default: ({ createRequest, onlyPlanId, onChanged }: any) => (
    <aside data-testid="plan-manager">
      {createRequest?.date} {createRequest?.type} {onlyPlanId}
      <button onClick={onChanged}>Refresh calendar data</button>
    </aside>
  ),
}));
const today = localDate(),
  current = today.slice(0, 7),
  future = shiftMonth(current, 1);
const categories = [
  { id: "food", name: "Groceries", type: "EXPENSE" as const },
  { id: "salary", name: "Salary", type: "INCOME" as const },
];
const entry: CalendarEntry = {
  id: "entry",
  description: "Synthetic rent",
  amount: "500.00",
  type: "EXPENSE",
  category: "Groceries",
  source: "RECURRING",
  status: "UPCOMING",
  scheduledDate: future + "-15",
  recurringRuleId: "rule",
  plannedTransactionId: null,
  transactionId: null,
  projected: true,
  note: "Projection only.",
};
function fixture(month: string): CalendarMonth {
  const count = new Date(
    Number(month.slice(0, 4)),
    Number(month.slice(5)),
    0,
  ).getDate();
  return {
    month,
    asOfDate: today,
    timeZone: "America/New_York",
    minMonth: "1900-01",
    maxMonth: shiftMonth(current, 119),
    lowBalanceThreshold: "100.00",
    historicalExplanation:
      "Historical balances are unavailable: opening balance has no effective date.",
    summary: {
      upcomingExpenses: "500.00",
      expectedIncome: "2500.00",
      nextBill: entry,
      monthEndBalance: "3000.00",
      lowestBalance: "500.00",
      lowestDate: month + "-15",
    },
    days: Array.from({ length: count }, (_, i) => {
      const date = month + "-" + String(i + 1).padStart(2, "0");
      return {
        date,
        today: date === today,
        projection:
          date < today
            ? null
            : {
                date,
                startingBalance: "1000.00",
                income: "0.00",
                expenses: "500.00",
                netChange: "-500.00",
                endingBalance: "500.00",
                transactions: [],
              },
        flows:
          date < today
            ? null
            : {
                scheduledIncome: "0.00",
                scheduledExpenses: "500.00",
                plannedIncome: "0.00",
                plannedExpenses: "0.00",
              },
        warnings:
          i === 15
            ? [
                {
                  date,
                  balance: "-10.01",
                  severity: "NEGATIVE" as const,
                  kind: "PROJECTED" as const,
                  transactions: [],
                },
              ]
            : [],
        entries: i === 14 ? [{ ...entry, scheduledDate: date }] : [],
      };
    }),
  };
}
let fetcher: ReturnType<typeof vi.fn>;
let transform: (data: CalendarMonth) => CalendarMonth;
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  transform = (d) => d;
  fetcher = vi.fn(async (path: string) => {
    const month = new URL("http://local" + path).searchParams.get("month")!;
    return Response.json(transform(fixture(month)));
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const setup = () =>
  render(
    <BillCalendar
      categories={categories}
      transactions={[]}
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );
const day = (date: string) =>
  screen.getByRole("button", { name: new RegExp("^" + date + ",") });
async function next() {
  fireEvent.click(screen.getByRole("button", { name: "Next month" }));
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      "/api/calendar?month=" + future,
      expect.anything(),
    ),
  );
  await screen.findByRole("button", {
    name: new RegExp("^" + future + "-15,"),
  });
}
describe("calendar date helpers", () => {
  it.each([
    ["2026-12", 1, "2027-01"],
    ["2027-01", -1, "2026-12"],
    ["2024-02", 12, "2025-02"],
  ])("moves month/year %s", (m, n, want) =>
    expect(shiftMonth(String(m), Number(n))).toBe(want),
  );
  it("navigates leap day as calendar dates", () => {
    expect(shiftDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDate("2028-02-29", 1)).toBe("2028-03-01");
  });
  it("pads the month to complete Sunday-first weeks", () => {
    const d = fixture("2028-02").days;
    const cells = calendarCells(d);
    expect(cells.length % 7).toBe(0);
    expect(cells.filter(Boolean)).toHaveLength(29);
    expect(cells[2]?.date).toBe("2028-02-01");
  });
});
describe("bill calendar interface", () => {
  it("renders the full month, today and five summary cards using one read", async () => {
    setup();
    await screen.findByRole("region", { name: "Monthly bill calendar" });
    expect(
      screen
        .getByRole("region", { name: "Calendar summary" })
        .querySelectorAll("article"),
    ).toHaveLength(5);
    expect(
      screen.getByRole("button", { name: new RegExp("^" + today + ", today") }),
    ).toHaveProperty("ariaCurrent", "date");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.method).toBeUndefined();
  });
  it("navigates forward, backward and back to current month", async () => {
    setup();
    await screen.findByRole("region", { name: "Monthly bill calendar" });
    await next();
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Calendar month") as HTMLSelectElement).value,
      ).toBe(current.slice(5)),
    );
    await next();
    fireEvent.click(screen.getByText("Current month"));
    await waitFor(() =>
      expect(fetcher).toHaveBeenLastCalledWith(
        "/api/calendar?month=" + current,
        expect.anything(),
      ),
    );
  });
  it("supports month and year selectors", async () => {
    setup();
    await screen.findByRole("region", { name: "Monthly bill calendar" });
    fireEvent.change(screen.getByLabelText("Calendar year"), {
      target: { value: "2028" },
    });
    fireEvent.change(screen.getByLabelText("Calendar month"), {
      target: { value: "02" },
    });
    await waitFor(() =>
      expect(fetcher).toHaveBeenLastCalledWith(
        "/api/calendar?month=2028-02",
        expect.anything(),
      ),
    );
    await screen.findByRole("button", { name: /^2028-02-29,/ });
  });
  it("limits cell entries and exposes all activity in selected-day details", async () => {
    transform = (d) => ({
      ...d,
      days: d.days.map((x) =>
        x.date.endsWith("-15")
          ? {
              ...x,
              entries: [
                entry,
                { ...entry, id: "two", description: "Second bill" },
                { ...entry, id: "three", description: "Third bill" },
              ],
            }
          : x,
      ),
    });
    setup();
    await screen.findByRole("region", { name: "Monthly bill calendar" });
    await next();
    expect(within(day(future + "-15")).getByText("+1 more")).toBeTruthy();
    fireEvent.click(day(future + "-15"));
    expect(
      within(
        screen.getByRole("region", { name: "Selected day details" }),
      ).getByText("Third bill"),
    ).toBeTruthy();
  });
  it("shows recurring source links and projected daily totals", async () => {
    setup();
    await screen.findByRole("region", { name: "Monthly bill calendar" });
    await next();
    fireEvent.click(day(future + "-15"));
    const panel = screen.getByRole("region", { name: "Selected day details" });
    expect(
      within(panel)
        .getByRole("link", { name: "Open recurring schedule" })
        .getAttribute("href"),
    ).toBe("#recurring/rule");
    expect(within(panel).getByText("Starting projected balance")).toBeTruthy();
    expect(within(panel).getByText("Ending projected balance")).toBeTruthy();
    expect(within(panel).getByText("Scheduled expenses")).toBeTruthy();
  });
  it.each(["EXPENSE", "INCOME"])(
    "adds a %s plan using the selected future date",
    async (type) => {
      setup();
      await screen.findByRole("region", { name: "Monthly bill calendar" });
      await next();
      fireEvent.click(day(future + "-15"));
      fireEvent.click(
        screen.getByText(
          type === "INCOME" ? "Add planned income" : "Add planned expense",
        ),
      );
      expect(screen.getByTestId("plan-manager").textContent).toContain(
        future + "-15 " + type,
      );
      expect(fetcher.mock.calls.every(([, init]) => !init.method)).toBe(true);
    },
  );
  it("opens an existing plan without creating a duplicate", async () => {
    transform = (d) => ({
      ...d,
      days: d.days.map((x) =>
        x.date.endsWith("-15")
          ? {
              ...x,
              entries: [
                {
                  ...entry,
                  source: "PLANNED",
                  recurringRuleId: null,
                  plannedTransactionId: "plan-id",
                },
              ],
            }
          : x,
      ),
    });
    setup();
    await screen.findByRole("region", { name: "Monthly bill calendar" });
    await next();
    fireEvent.click(day(future + "-15"));
    fireEvent.click(screen.getByText("Manage planned transaction"));
    expect(screen.getByTestId("plan-manager").textContent).toContain("plan-id");
    expect(fetcher.mock.calls.every(([, init]) => !init.method)).toBe(true);
  });
  it("indicates negative balance and exposes warning details when clicked", async () => {
    setup();
    await screen.findByRole("region", { name: "Monthly bill calendar" });
    await next();
    const warning = day(future + "-16");
    expect(warning.className).toContain("balance-negative");
    fireEvent.click(warning);
    expect(
      screen.getByText(/Below zero: −?\$?-?10.01|Below zero: -\$10.01/),
    ).toBeTruthy();
  });
  it("shows an explanation rather than inventing historical balances", async () => {
    setup();
    await screen.findByRole("region", { name: "Monthly bill calendar" });
    fireEvent.change(screen.getByLabelText("Calendar year"), {
      target: { value: "1900" },
    });
    await screen.findByRole("button", {
      name: new RegExp("^1900-" + current.slice(5) + "-01,"),
    });
    expect(
      screen.getAllByText(/Historical balances are unavailable/).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Add planned expense" }),
    ).toHaveProperty("disabled", true);
    expect(screen.queryByText("Starting projected balance")).toBeNull();
  });
  it("handles empty months explicitly", async () => {
    transform = (d) => ({
      ...d,
      days: d.days.map((x) => ({ ...x, entries: [] })),
    });
    setup();
    expect(
      await screen.findByText(/No financial activity in this month/),
    ).toBeTruthy();
  });
  it("supports arrow navigation across month boundaries", async () => {
    setup();
    await screen.findByRole("region", { name: "Monthly bill calendar" });
    const last = fixture(current).days.at(-1)!.date;
    fireEvent.keyDown(day(last), { key: "ArrowRight" });
    await screen.findByRole("button", {
      name: new RegExp("^" + future + "-01,"),
    });
    await waitFor(() =>
      expect(document.activeElement?.id).toBe("calendar-" + future + "-01"),
    );
  });
  it("shows request errors and retries", async () => {
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Synthetic outage" }), {
        status: 503,
      }),
    );
    setup();
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("Synthetic outage"),
    );
    fireEvent.click(screen.getByText("Retry calendar"));
    await screen.findByRole("region", { name: "Monthly bill calendar" });
  });
  it("ignores a stale month response that arrives after navigation", async () => {
    let resolve!: (r: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    await screen.findByRole("button", {
      name: new RegExp("^" + future + "-01,"),
    });
    resolve(Response.json(fixture(current)));
    await new Promise((r) => setTimeout(r, 10));
    expect(
      screen.getByRole("button", { name: new RegExp("^" + future + "-01,") }),
    ).toBeTruthy();
  });
  it("preserves the calendar plan date and type in the existing form", () => {
    render(
      <PlanForm
        categories={categories}
        today={today}
        initialDate={future + "-15"}
        initialType="INCOME"
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Planned date")).toHaveProperty(
      "value",
      future + "-15",
    );
    expect(screen.getByLabelText("Type")).toHaveProperty("value", "INCOME");
    expect(screen.getByLabelText("Category")).toHaveProperty("value", "salary");
  });
});
