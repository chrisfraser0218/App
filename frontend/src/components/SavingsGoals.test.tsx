// @vitest-environment jsdom
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import SavingsGoals from "./SavingsGoals";
import {
  SavingsGoalForm,
  SavingsEntryForm,
  SavingsScheduleForm,
} from "./SavingsForms";
import { SavingsTooltip } from "./SavingsCharts";
import type { SavingsDetail, SavingsDashboard } from "../savings";
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  ComposedChart: ({ children }: any) => <div>{children}</div>,
  BarChart: ({ children }: any) => <div>{children}</div>,
  Area: () => null,
  Line: () => null,
  Bar: () => null,
  CartesianGrid: () => null,
  Legend: () => null,
  ReferenceLine: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));
const goal = {
  id: "goal",
  name: "Vacation",
  description: "Synthetic purpose",
  targetAmount: "5000.00",
  targetDate: "2027-03-31",
  createdAt: "2026-10-15T12:00:00Z",
  status: "ACTIVE" as const,
  archived: false,
  completed: false,
  saved: "400.00",
  inAccount: "400.00",
  external: "0.00",
  remaining: "4600.00",
  progress: "8.00",
  version: 2,
  requestId: "goal-request",
};
const dashboard: SavingsDashboard = {
  summary: {
    totalGoals: 1,
    activeGoals: 1,
    archivedGoals: 0,
    completedGoals: 0,
    approachingGoals: 0,
    totalTarget: "5000.00",
    totalSaved: "400.00",
    overallProgress: "8.00",
    actualBalance: "5000.00",
    allocatedInAccount: "400.00",
    trackedExternal: "0.00",
    unallocatedBalance: "4600.00",
    asOfDate: "2026-10-15",
  },
  goals: [goal],
};
const detail: SavingsDetail = {
  goal,
  entries: [],
  schedule: null,
  projection: {
    asOfDate: "2026-10-15",
    horizon: "2036-10-22",
    method: "insufficient_history",
    estimatedCompletionDate: null,
    expectedByTarget: "400.00",
    requiredMonthly: "766.67",
    requiredPerOccurrence: null,
    remainingOccurrences: 0,
    bankProjectedBalance: "5000.00",
    bankForecastDate: "2027-10-15",
    points: [{ date: "2026-10-15", actual: "400.00", projected: "400.00" }],
    months: [],
    observations: ["No active schedule; insufficient recorded history."],
  },
};
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = vi.fn();
  fetcher = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => (url === "/api/savings-goals" ? dashboard : detail),
  }));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("shows distinct actual, allocated, external and unallocated totals and goal progress", async () => {
  render(<SavingsGoals />);
  await screen.findByText("Actual account balance");
  expect(screen.getByText("Reserved in this account")).toBeTruthy();
  expect(screen.getByText("Unallocated balance")).toBeTruthy();
  expect(
    screen
      .getByRole("progressbar", { name: "Vacation progress" })
      .getAttribute("aria-valuenow"),
  ).toBe("8");
  await screen.findByText("Allocation outlook");
  expect(
    screen.getByText("No active schedule; insufficient recorded history."),
  ).toBeTruthy();
  expect(screen.getAllByRole("img")).toHaveLength(2);
});
it("empty state and retryable dashboard error are clear", async () => {
  fetcher.mockRejectedValueOnce(new Error("Local database unavailable"));
  render(<SavingsGoals />);
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Retry savings" }));
  await screen.findByText("Actual account balance");
});
it("shows empty goal state", async () => {
  fetcher.mockResolvedValue({
    ok: true,
    json: async () => ({ ...dashboard, goals: [] }),
  });
  render(<SavingsGoals />);
  await screen.findByText("Your first goal starts here");
});
it("create form validates exact money and preserves retry request ID", async () => {
  const save = vi.fn().mockRejectedValue(new Error("Temporary failure"));
  render(<SavingsGoalForm onSave={save} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText("Goal name"), {
    target: { value: "Vacation" },
  });
  fireEvent.change(screen.getByLabelText("Target amount (USD)"), {
    target: { value: "1.001" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create goal" }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Target amount (USD)"), {
    target: { value: "5000.00" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create goal" }));
  await screen.findByText("Temporary failure");
  fireEvent.click(screen.getByRole("button", { name: "Create goal" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[0][0].requestId).toBe(save.mock.calls[1][0].requestId);
  expect(save.mock.calls[0][0].targetAmount).toBe("5000.00");
});
it("entry form records allocation only with explicit bucket and no ledger API", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <SavingsEntryForm
      detail={detail}
      mode="CONTRIBUTION"
      transactions={[]}
      onSave={save}
      onClose={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText("Amount (USD)"), {
    target: { value: "500.00" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add contribution" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0].entry).toMatchObject({
    amount: "500.00",
    bucket: "IN_ACCOUNT",
    transactionId: null,
    type: "CONTRIBUTION",
  });
  expect(fetcher).not.toHaveBeenCalled();
});
it("existing payment link is explicit and copies exact date and amount", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <SavingsEntryForm
      detail={detail}
      mode="CONTRIBUTION"
      transactions={[
        {
          id: "cash",
          description: "Synthetic deposit",
          amount: "100.01",
          date: "2026-10-01",
          type: "INCOME",
          categoryId: "salary",
        },
      ]}
      onSave={save}
      onClose={() => {}}
    />,
  );
  fireEvent.change(
    screen.getByLabelText("Associate existing income transaction (optional)"),
    { target: { value: "cash" } },
  );
  expect(
    (screen.getByLabelText("Amount (USD)") as HTMLInputElement).value,
  ).toBe("100.01");
  fireEvent.click(screen.getByRole("button", { name: "Add contribution" }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][0].entry.transactionId).toBe("cash");
});
it("withdrawals use positive amounts and a separate direction", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <SavingsEntryForm
      detail={detail}
      mode="WITHDRAWAL"
      transactions={[]}
      onSave={save}
      onClose={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText("Amount (USD)"), {
    target: { value: "-100" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Record withdrawal" }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Amount (USD)"), {
    target: { value: "100" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Record withdrawal" }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][0].entry.type).toBe("WITHDRAWAL");
});
it("correction can void with a reason without deleting history", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <SavingsEntryForm
      detail={detail}
      mode="CORRECTION"
      transactions={[]}
      onSave={save}
      onClose={() => {}}
    />,
  );
  fireEvent.click(
    screen.getByLabelText("Void this erroneous entry without a replacement"),
  );
  fireEvent.change(screen.getByLabelText("Correction reason"), {
    target: { value: "Synthetic correction" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][0]).toMatchObject({
    replacement: null,
    reason: "Synthetic correction",
    version: 2,
  });
});
it("allocation schedules distinguish frequency from explicit bank-flow links", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <SavingsScheduleForm
      detail={detail}
      plans={[]}
      rules={[]}
      onSave={save}
      onClose={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText("Planned allocation (USD)"), {
    target: { value: "500.00" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save allocation plan" }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][0]).toMatchObject({
    amount: "500.00",
    frequency: "MONTHLY",
    linkType: "NONE",
    linkId: null,
  });
});
it("archive requires confirmation and warns allocations are retained", async () => {
  render(<SavingsGoals />);
  await screen.findByText("Allocation outlook");
  fireEvent.click(screen.getByRole("button", { name: "Archive goal" }));
  expect(screen.getByText(/Archiving preserves all history/)).toBeTruthy();
  expect(
    fetcher.mock.calls.filter((c) => c[1]?.method === "POST"),
  ).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Confirm archive" }));
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(
        (c) =>
          c[0] === "/api/savings-goals/goal/state" &&
          JSON.parse(c[1].body).action === "ARCHIVE",
      ),
    ).toBe(true),
  );
});
it("tooltip uses exact decimal strings rather than chart coordinates", () => {
  render(
    <SavingsTooltip
      active
      payload={[
        {
          payload: {
            date: "2026-10-15",
            actual: "0.30",
            actualValue: 0.30000000000000004,
            projected: "500.10",
          },
        },
      ]}
    />,
  );
  expect(screen.getByText("actual: $0.30")).toBeTruthy();
  expect(screen.getByText("projected: $500.10")).toBeTruthy();
});
it("request cancellation prevents stale selected goal details", async () => {
  let resolve!: (v: any) => void;
  fetcher.mockImplementation((url: string) =>
    url === "/api/savings-goals"
      ? Promise.resolve({
          ok: true,
          json: async () => ({
            ...dashboard,
            goals: [goal, { ...goal, id: "other", name: "Emergency" }],
          }),
        })
      : url.endsWith("/other")
        ? Promise.resolve({
            ok: true,
            json: async () => ({
              ...detail,
              goal: { ...goal, id: "other", name: "Emergency" },
            }),
          })
        : new Promise((r) => {
            resolve = r;
          }),
  );
  render(<SavingsGoals />);
  await screen.findByRole("button", { name: "View Emergency" });
  fireEvent.click(screen.getByRole("button", { name: "View Emergency" }));
  await screen.findByRole("region", { name: "Emergency details" });
  resolve({ ok: true, json: async () => detail });
  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: "Vacation details" }),
    ).toBeNull(),
  );
});
it("keeps unsaved allocation form values during a background financial refresh", async () => {
  const view = render(<SavingsGoals transactions={[]} />);
  await screen.findByText("Allocation outlook");
  fireEvent.click(
    screen.getByRole("button", { name: "Add contribution" }),
  );
  fireEvent.change(screen.getByLabelText("Amount (USD)"), {
    target: { value: "123.45" },
  });
  view.rerender(<SavingsGoals transactions={[]} />);
  expect(
    (screen.getByLabelText("Amount (USD)") as HTMLInputElement).value,
  ).toBe("123.45");
});
it("frequency control is explicitly accessible and validates duplicate twice-monthly days", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <SavingsScheduleForm
      detail={detail}
      plans={[]}
      rules={[]}
      onSave={save}
      onClose={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText("Planned allocation (USD)"), {
    target: { value: "500" },
  });
  fireEvent.change(screen.getByLabelText("Frequency", { exact: true }), {
    target: { value: "TWICE_MONTHLY" },
  });
  fireEvent.change(screen.getByLabelText("Second payment day"), {
    target: { value: "1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save allocation plan" }));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toBeTruthy();
});
