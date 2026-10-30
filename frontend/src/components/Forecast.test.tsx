// @vitest-environment jsdom
import { beforeEach as beforeCsrf } from 'vitest';
import { clearCsrf, prepareCsrf } from '../api';
beforeCsrf(async () => {
  const original=globalThis.fetch;
  globalThis.fetch=async () => new Response(JSON.stringify({token:'synthetic-csrf'}),{status:200});
  clearCsrf(); await prepareCsrf(); globalThis.fetch=original;
});
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  addMonthsClamped,
  hypotheticalError,
  nextDate,
  type ForecastResult,
  type Plan,
} from "../forecast";
import PlanForm from "./PlanForm";
import PlannedTransactions from "./PlannedTransactions";
import BalanceForecast from "./BalanceForecast";
import { ForecastTooltip } from "./ForecastChart";
import type { Category, Transaction } from "../api";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  LineChart: ({ children }: any) => <div>{children}</div>,
  Line: ({ name }: any) => <span>{name}</span>,
  CartesianGrid: () => null,
  Legend: () => null,
  Brush: () => null,
  ReferenceLine: () => null,
  ReferenceDot: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));
const categories: Category[] = [
  { id: "food", name: "Groceries", type: "EXPENSE" },
  { id: "salary", name: "Salary", type: "INCOME" },
];
const today = "2026-01-31";
const event = {
  id: "event",
  source: "PLANNED" as const,
  sourceId: "plan",
  description: "Synthetic repair",
  type: "EXPENSE" as const,
  amount: "25.01",
  category: "Groceries",
  scheduledDate: "2026-02-01",
  effectiveDate: "2026-02-01",
  overdue: false,
};
const day = {
  date: "2026-02-01",
  startingBalance: "1000.00",
  income: "0.00",
  expenses: "25.01",
  netChange: "-25.01",
  endingBalance: "974.99",
  transactions: [event],
};
const base: ForecastResult = {
  summary: {
    asOfDate: today,
    endDate: "2026-02-28",
    timeZone: "America/New_York",
    currentActualBalance: "1000.00",
    projectedBalance: "974.99",
    totalIncome: "0.00",
    totalExpenses: "25.01",
    lowestBalance: "974.99",
    lowestDate: day.date,
    netChange: "-25.01",
    recurringIncome: "0.00",
    recurringExpenses: "0.00",
    plannedIncome: "0.00",
    plannedExpenses: "25.01",
    hypotheticalIncome: "0.00",
    hypotheticalExpenses: "0.00",
    overdueOccurrences: 0,
    overduePlans: 0,
  },
  lowBalanceThreshold: "100.00",
  days: [
    day,
    {
      ...day,
      date: "2026-02-28",
      transactions: [],
      income: "0.00",
      expenses: "0.00",
    },
  ],
  months: [
    {
      month: "2026-02",
      periodStart: day.date,
      periodEnd: "2026-02-28",
      startingBalance: "1000.00",
      income: "0.00",
      expenses: "25.01",
      netChange: "-25.01",
      endingBalance: "974.99",
    },
  ],
  warnings: [],
};
const plan: Plan = {
  id: "plan",
  description: "Synthetic repair",
  amount: "25.01",
  type: "EXPENSE",
  categoryId: "food",
  date: day.date,
  requestId: "create-id",
  status: "PLANNED",
  version: 3,
  transactionId: null,
  completionMode: null,
  overdue: false,
};
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  for (const method of ["showModal", "close"])
    Object.defineProperty(HTMLDialogElement.prototype, method, {
      configurable: true,
      value: function () {
        if (method === "showModal") this.setAttribute("open", "");
        else this.removeAttribute("open");
      },
    });
  fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/forecast-preferences")
      return Response.json({
        lowBalanceThreshold: "100.00",
        version: 0,
        asOfDate: today,
        timeZone: "America/New_York",
        maxDate: "2036-02-08",
      });
    if (path.startsWith("/api/forecasts?")) return Response.json(base);
    if (path === "/api/forecasts/scenarios")
      return Response.json({
        baseline: base,
        scenario: {
          ...base,
          summary: { ...base.summary, projectedBalance: "874.99" },
        },
        projectedDifference: "-100.00",
      });
    if (path === "/api/planned-transactions" && !init?.method)
      return Response.json([]);
    return Response.json(plan);
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const setupForecast = () =>
  render(
    <BalanceForecast
      categories={categories}
      transactions={[]}
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );
const fillPlan = () => {
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "Synthetic repair" },
  });
  fireEvent.change(screen.getByLabelText("Amount (USD)"), {
    target: { value: "25.01" },
  });
};

describe("forecast calendar and hypothetical validation", () => {
  it.each([
    ["2026-01-31", 1, "2026-02-28"],
    ["2028-01-31", 1, "2028-02-29"],
    ["2026-01-31", 5, "2026-06-30"],
    ["2028-02-29", 12, "2029-02-28"],
  ])("clamps %s plus %s months", (date, n, want) =>
    expect(addMonthsClamped(String(date), Number(n))).toBe(want),
  );
  it("advances across a year boundary", () =>
    expect(nextDate("2026-12-31")).toBe("2027-01-01"));
  it.each(["0", "-1", "1.001", "Infinity"])(
    "rejects invalid hypothetical amount %s",
    (amount) =>
      expect(
        hypotheticalError(
          {
            description: "Repair",
            amount,
            type: "EXPENSE",
            date: "2026-02-01",
          },
          today,
          "2026-02-28",
        ),
      ).toMatch(/positive amount/),
  );
  it("rejects hypothetical outside the chosen window", () =>
    expect(
      hypotheticalError(
        {
          description: "Repair",
          amount: "1.01",
          type: "EXPENSE",
          date: "2026-03-01",
        },
        today,
        "2026-02-28",
      ),
    ).toMatch(/within/));
});
describe("planned transaction forms", () => {
  it("saves exact decimals and an idempotency key without an actual payment call", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <PlanForm
        categories={categories}
        today={today}
        onSave={save}
        onClose={vi.fn()}
      />,
    );
    fillPlan();
    fireEvent.click(screen.getByText("Save planned transaction"));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: "25.01",
          date: "2026-02-01",
          categoryId: "food",
          requestId: expect.any(String),
        }),
      ),
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects past dates before saving", async () => {
    const save = vi.fn();
    const { container } = render(
      <PlanForm
        categories={categories}
        today={today}
        onSave={save}
        onClose={vi.fn()}
      />,
    );
    fillPlan();
    fireEvent.change(screen.getByLabelText("Planned date"), {
      target: { value: today },
    });
    fireEvent.submit(container.querySelector("form")!);
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("after today"),
    );
    expect(save).not.toHaveBeenCalled();
  });
  it("changes category options when changing direction", () => {
    render(
      <PlanForm
        categories={categories}
        today={today}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "INCOME" },
    });
    expect((screen.getByLabelText("Category") as HTMLSelectElement).value).toBe(
      "salary",
    );
    expect(screen.queryByRole("option", { name: "Groceries" })).toBeNull();
  });
  it("displays save failures and keeps the form", async () => {
    render(
      <PlanForm
        categories={categories}
        today={today}
        onSave={vi.fn().mockRejectedValue(new Error("Offline"))}
        onClose={vi.fn()}
      />,
    );
    fillPlan();
    fireEvent.click(screen.getByText("Save planned transaction"));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Offline",
    );
    expect(screen.getByLabelText("Description")).toHaveProperty(
      "value",
      "Synthetic repair",
    );
  });
  it("requires explicit confirmation to cancel a plan", async () => {
    fetcher.mockImplementation(async () => Response.json([plan]));
    render(
      <PlannedTransactions
        categories={categories}
        transactions={[]}
        today={today}
        onChanged={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.click(await screen.findByText("Cancel plan"));
    expect(fetcher.mock.calls.filter(([, i]) => i?.method)).toHaveLength(0);
    fetcher.mockImplementation(async (_path: string, init?: RequestInit) =>
      Response.json(init?.method ? { ...plan, status: "CANCELED" } : []),
    );
    fireEvent.click(screen.getByText("Confirm plan cancellation"));
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        "/api/planned-transactions/plan/cancel",
        expect.objectContaining({ body: JSON.stringify({ version: 3 }) }),
      ),
    );
  });
  it("defaults future completion to linking and disables recording", async () => {
    fetcher.mockImplementation(async () => Response.json([plan]));
    render(
      <PlannedTransactions
        categories={categories}
        transactions={[]}
        today={today}
        onChanged={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.click(await screen.findByText("Complete / link payment"));
    expect(screen.getByLabelText("Completion action")).toHaveProperty(
      "value",
      "LINK",
    );
    expect(
      screen.getByRole("option", { name: /Record an actual/ }),
    ).toHaveProperty("disabled", true);
    expect(screen.getByText(/No new money is recorded/)).toBeTruthy();
  });
  it("links a mismatched manual payment only with explicit confirmation", async () => {
    const tx = {
      id: "tx",
      type: "EXPENSE",
      amount: "24.00",
      description: "Actual repair",
      date: today,
      categoryId: "food",
    } as Transaction;
    fetcher.mockImplementation(async () => Response.json([plan]));
    render(
      <PlannedTransactions
        categories={categories}
        transactions={[tx]}
        today={today}
        onChanged={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.click(await screen.findByText("Complete / link payment"));
    fireEvent.change(screen.getByLabelText("Recorded payment"), {
      target: { value: "tx" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fetcher.mockImplementation(async (_path: string, init?: RequestInit) =>
      Response.json(init?.method ? { ...plan, status: "COMPLETED" } : []),
    );
    fireEvent.click(screen.getByText("Confirm completion"));
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        "/api/planned-transactions/plan/complete",
        expect.objectContaining({
          body: expect.stringContaining('"confirmAmountDifference":true'),
        }),
      ),
    );
    expect(fetcher.mock.calls.some(([p]) => p === "/api/transactions")).toBe(
      false,
    );
  });
});
describe("forecast interface and chart", () => {
  it("loads a read-only baseline with accurate summary and selectable daily details", async () => {
    setupForecast();
    expect(await screen.findByText("Current Actual Balance")).toBeTruthy();
    expect(
      within(
        screen.getByRole("region", { name: "Forecast summary" }),
      ).getByText("$1,000.00"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "2026-02-01" }));
    expect(screen.getByText("Synthetic repair")).toBeTruthy();
    expect(fetcher.mock.calls.every(([, i]) => !i?.method)).toBe(true);
  });
  it.each([
    ["3", "2026-04-30"],
    ["5", "2026-06-30"],
    ["12", "2027-01-31"],
  ])("requests exact %s month end", async (value, end) => {
    setupForecast();
    await screen.findByText("Current Actual Balance");
    fireEvent.change(screen.getByLabelText("Forecast range"), {
      target: { value },
    });
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        `/api/forecasts?endDate=${end}`,
        expect.anything(),
      ),
    );
  });
  it("uses a custom future date and switches chart granularity", async () => {
    setupForecast();
    await screen.findByText("Current Actual Balance");
    fireEvent.change(screen.getByLabelText("Chart view"), {
      target: { value: "monthly" },
    });
    expect(screen.getByLabelText("Chart view")).toHaveProperty(
      "value",
      "monthly",
    );
    fireEvent.change(screen.getByLabelText("Forecast range"), {
      target: { value: "custom" },
    });
    fireEvent.change(screen.getByLabelText("Forecast end date"), {
      target: { value: "2026-04-17" },
    });
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        "/api/forecasts?endDate=2026-04-17",
        expect.anything(),
      ),
    );
  });
  it("adds and removes an unsaved scenario while preserving the baseline", async () => {
    setupForecast();
    await screen.findByText("Current Actual Balance");
    fireEvent.change(screen.getByLabelText("Hypothetical description"), {
      target: { value: "What if repair" },
    });
    fireEvent.change(screen.getByLabelText("Hypothetical amount (USD)"), {
      target: { value: "100.00" },
    });
    fireEvent.click(screen.getByText("Add hypothetical transaction"));
    expect(
      await screen.findByText(/Unsaved what-if comparison/),
    ).toHaveProperty("textContent", expect.stringContaining("$974.99"));
    expect(screen.getByText("Hypothetical projection")).toBeTruthy();
    fireEvent.click(
      screen.getByLabelText("Remove hypothetical What if repair"),
    );
    await waitFor(() =>
      expect(screen.queryByText(/Unsaved what-if comparison/)).toBeNull(),
    );
    expect(
      fetcher.mock.calls
        .filter(([, i]) => i?.method)
        .every(([p]) => p === "/api/forecasts/scenarios"),
    ).toBe(true);
  });
  it("only persists the threshold after an explicit save", async () => {
    setupForecast();
    await screen.findByText("Current Actual Balance");
    fireEvent.change(screen.getByLabelText("Low-balance threshold (USD)"), {
      target: { value: "50.25" },
    });
    expect(fetcher.mock.calls.filter(([, i]) => i?.method)).toHaveLength(0);
    fireEvent.click(screen.getByText("Save threshold"));
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        "/api/forecast-preferences",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ lowBalanceThreshold: "50.25", version: 0 }),
        }),
      ),
    );
  });
  it("shows failures and allows a retry", async () => {
    fetcher.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ message: "Unavailable" }), {
          status: 503,
        }),
    );
    setupForecast();
    expect(await screen.findByText("Forecast unavailable")).toBeTruthy();
    fireEvent.click(screen.getByText("Retry forecast"));
    expect(await screen.findByText("Current Actual Balance")).toBeTruthy();
  });
  it("renders exact chart tooltip amounts and affecting transactions", () => {
    render(
      <ForecastTooltip
        active
        payload={[
          {
            payload: {
              date: day.date,
              baseline: 974.99,
              scenario: 974.99,
              baselineDay: day,
              scenarioDay: day,
            },
          },
        ]}
      />,
    );
    expect(screen.getByText("Baseline: $974.99")).toBeTruthy();
    expect(screen.getByText("Income: $0.00 · Expenses: $25.01")).toBeTruthy();
    expect(screen.getByText("Synthetic repair · −$25.01")).toBeTruthy();
  });
  it("does not render an inactive tooltip", () => {
    const { container } = render(<ForecastTooltip active={false} />);
    expect(container.textContent).toBe("");
  });
});
