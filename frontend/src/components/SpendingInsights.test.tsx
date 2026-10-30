// @vitest-environment jsdom
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import SpendingInsights from "./SpendingInsights";
import { InsightsTooltip } from "./SpendingCharts";
import type { SpendingReport } from "../insights";
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  AreaChart: ({ children }: any) => <div>{children}</div>,
  BarChart: ({ children }: any) => <div>{children}</div>,
  PieChart: ({ children }: any) => <div>{children}</div>,
  Pie: ({ children }: any) => <div>{children}</div>,
  Area: () => null,
  Bar: () => null,
  CartesianGrid: () => null,
  Cell: () => null,
  Legend: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));
const baseline: SpendingReport = {
  period: {
    from: "2026-10-01",
    to: "2026-10-15",
    comparisonFrom: "2026-09-16",
    comparisonTo: "2026-09-30",
    asOfDate: "2026-10-15",
  },
  summary: {
    expenses: "100.01",
    income: "500.00",
    net: "399.99",
    currentMonthSpending: "100.01",
    monthToDate: {
      current: "100.01",
      previous: "50.00",
      difference: "50.01",
      percent: "100.02",
    },
    average: {
      amount: null,
      months: [],
      explanation: "Insufficient recorded coverage.",
    },
    largestCategory: "Groceries",
    recurringRecorded: "25.00",
    nonrecurringRecorded: "75.01",
    periodChange: {
      current: "100.01",
      previous: "50.00",
      difference: "50.01",
      percent: "100.02",
    },
  },
  categories: [
    {
      id: "food",
      name: "Groceries",
      expenses: "100.01",
      previous: "50.00",
      change: "50.01",
      percent: "100.02",
      share: "100.00",
      count: 1,
    },
  ],
  months: [
    {
      month: "2026-10",
      from: "2026-10-01",
      to: "2026-10-15",
      income: "500.00",
      expenses: "100.01",
      net: "399.99",
      count: 2,
      partial: true,
    },
  ],
  recurring: {
    recorded: "25.00",
    normalizedMonthlyEstimate: "43.48",
    pendingThisMonth: "30.00",
    upcomingTotal: "50.00",
    upcomingThrough: "2026-11-14",
    schedules: [
      {
        id: "rule",
        description: "Synthetic weekly bill",
        category: "Groceries",
        amount: "10.00",
        frequency: "WEEKLY",
        monthlyEstimate: "43.48",
        startDate: "2026-10-16",
        endDate: null,
      },
    ],
    upcoming: [],
    byCategory: [],
    changes: [],
  },
  detection: {
    status: "insufficient",
    methodVersion: "robust-mad-v1",
    eligible: 0,
    insufficient: 1,
    truncated: false,
    explanation: "At least 8 strictly earlier expenses are required.",
  },
  insights: [
    {
      id: "fact",
      kind: "HISTORICAL_FACT",
      severity: "info",
      title: "Groceries share",
      explanation: "Groceries represent 100.00% of recorded spending.",
      from: "2026-10-01",
      to: "2026-10-15",
      amount: "100.01",
      percentage: "100.00",
      calculations: [
        { label: "Category total", value: "100.01" },
        { label: "All expenses", value: "100.01" },
      ],
      evidenceIds: ["tx"],
      evidenceCount: 1,
    },
  ],
  evidence: [
    {
      id: "tx",
      description: "Synthetic groceries",
      amount: "100.01",
      type: "EXPENSE",
      categoryId: "food",
      category: "Groceries",
      date: "2026-10-05",
      recurringRuleId: null,
    },
  ],
  categoryNames: [{ id: "food", name: "Groceries", type: "EXPENSE" }],
  limitations: ["Recorded gross expenses only; refunds remain income."],
};
let report: SpendingReport, fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  report = structuredClone(baseline);
  for (const method of ["showModal", "close"])
    Object.defineProperty(HTMLDialogElement.prototype, method, {
      configurable: true,
      value: function () {
        if (method === "showModal") this.setAttribute("open", "");
        else this.removeAttribute("open");
      },
    });
  fetcher = vi.fn(async (path: string) =>
    Response.json(
      path.startsWith("/api/insights/transactions")
        ? { transactions: report.evidence, total: 1, truncated: false }
        : report,
    ),
  );
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const setup = () => render(<SpendingInsights />);
it("renders exact server totals, partial month labels and all five chart views", async () => {
  setup();
  const summary = await screen.findByRole("region", {
    name: "Spending summary",
  });
  expect(within(summary).getByText("$399.99")).toBeTruthy();
  expect(screen.getAllByRole("img")).toHaveLength(5);
  expect(screen.getByText("2026-10 · partial")).toBeTruthy();
  expect(fetcher.mock.calls.every(([, i]) => !i?.method)).toBe(true);
});
it.each(["last_month", "last_3", "last_6", "last_12"])(
  "requests the %s filter",
  async (range) => {
    setup();
    await screen.findByRole("region", { name: "Spending summary" });
    fireEvent.change(screen.getByLabelText("Insights date range"), {
      target: { value: range },
    });
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        "/api/insights?range=" + range,
        expect.anything(),
      ),
    );
  },
);
it("supports custom dates and rejects reversed dates locally", async () => {
  setup();
  await screen.findByRole("region", { name: "Spending summary" });
  fireEvent.change(screen.getByLabelText("Insights date range"), {
    target: { value: "custom" },
  });
  fireEvent.change(screen.getByLabelText("Insights end date"), {
    target: { value: "2026-10-05" },
  });
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      "/api/insights?range=custom&from=2026-10-01&to=2026-10-05",
      expect.anything(),
    ),
  );
  fireEvent.change(screen.getByLabelText("Insights start date"), {
    target: { value: "2026-10-10" },
  });
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("chronological order"),
  );
});
it("drills into exact calculations and supporting recorded transactions", async () => {
  setup();
  fireEvent.click(await screen.findByText("See supporting calculations"));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Synthetic groceries")).toBeTruthy();
  expect(within(dialog).getByText("Category total")).toBeTruthy();
  expect(
    within(dialog).getByText(
      "Showing 1 of 1 supporting records. Amounts reflect the current posted ledger.",
    ),
  ).toBeTruthy();
  expect(within(dialog).getByText("Historical fact")).toBeTruthy();
});
it("loads category evidence with read-only scoped dates", async () => {
  setup();
  fireEvent.click(await screen.findByText("View Groceries transactions"));
  expect(
    await within(screen.getByRole("dialog")).findByText("Synthetic groceries"),
  ).toBeTruthy();
  expect(fetcher).toHaveBeenCalledWith(
    "/api/insights/transactions?from=2026-10-01&to=2026-10-15&categoryId=food",
    expect.anything(),
  );
});
it("clearly explains insufficient statistical history instead of inventing alerts", async () => {
  setup();
  expect(
    await screen.findByText(
      "At least 8 strictly earlier expenses are required.",
    ),
  ).toBeTruthy();
  expect(
    screen.getByText("Transaction alerts are withheld rather than guessed."),
  ).toBeTruthy();
  expect(screen.queryByText(/Review an unusually large/)).toBeNull();
});
it("keeps deterministic summaries when the local analyzer is unavailable", async () => {
  report.detection = {
    ...report.detection,
    status: "unavailable",
    explanation:
      "Local statistical service unavailable. Deterministic facts remain available.",
  };
  setup();
  expect(
    await screen.findByText(
      "Local statistical service unavailable. Deterministic facts remain available.",
    ),
  ).toBeTruthy();
  expect(screen.getByRole("region", { name: "Spending summary" })).toBeTruthy();
});
it("distinguishes normalized estimates from exact pending totals and links schedules", async () => {
  setup();
  await screen.findByRole("region", { name: "Spending summary" });
  expect(screen.getAllByText("$43.48")).toHaveLength(2);
  expect(screen.getByText("Exact pending this month")).toBeTruthy();
  expect(screen.getByText("$30.00")).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Synthetic weekly bill" })
      .getAttribute("href"),
  ).toBe("#recurring/rule");
});
it("uses useful empty states and never shows an infinite percentage", async () => {
  report.categories = [];
  report.insights = [];
  report.summary = {
    ...report.summary,
    expenses: "0.00",
    income: "0.00",
    net: "0.00",
    largestCategory: null,
    monthToDate: {
      current: "0.00",
      previous: "0.00",
      difference: "0.00",
      percent: null,
    },
  };
  setup();
  expect(
    await screen.findByText("Not enough recorded evidence yet"),
  ).toBeTruthy();
  expect(screen.queryByText(/Infinity|NaN/)).toBeNull();
  expect(screen.getByText("No baseline")).toBeTruthy();
});
it("renders recommendations as review prompts distinct from historical facts", async () => {
  report.insights[0] = {
    ...report.insights[0],
    kind: "RECOMMENDATION",
    explanation: "Review whether this recorded purchase was optional.",
  };
  setup();
  expect(await screen.findByText("Recommendation")).toBeTruthy();
  expect(
    screen.getByText("Review whether this recorded purchase was optional."),
  ).toBeTruthy();
});
it("shows retryable backend errors", async () => {
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify({ detail: "Synthetic analysis outage" }), {
      status: 503,
    }),
  );
  setup();
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("Synthetic analysis outage"),
  );
  fireEvent.click(screen.getByText("Retry insights"));
  await screen.findByRole("region", { name: "Spending summary" });
});
it("ignores a stale response when a newer date filter finishes first", async () => {
  let resolve!: (r: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>((r) => {
        resolve = r;
      }),
  );
  setup();
  fireEvent.change(screen.getByLabelText("Insights date range"), {
    target: { value: "last_3" },
  });
  await screen.findByRole("region", { name: "Spending summary" });
  resolve(
    Response.json({
      ...baseline,
      summary: { ...baseline.summary, net: "99999.99" },
    }),
  );
  await new Promise((r) => setTimeout(r, 10));
  expect(screen.queryByText("$99,999.99")).toBeNull();
});
it("renders exact chart tooltip values, not recalculated chart numbers", () => {
  render(
    <InsightsTooltip
      active
      payload={[
        {
          payload: {
            label: "Synthetic month",
            details: [
              { label: "Expenses", value: "0.30" },
              { label: "Net", value: "-0.10" },
            ],
          },
        },
      ]}
    />,
  );
  expect(screen.getByText("Expenses: $0.30")).toBeTruthy();
  expect(screen.getByText("Net: -$0.10")).toBeTruthy();
});
