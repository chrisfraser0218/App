// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import RecurringTransactions from "./RecurringTransactions";
import type { Category, RecurringRule, Transaction } from "../api";

const categories: Category[] = [
  { id: "groceries", name: "Groceries", type: "EXPENSE" },
];
const base: RecurringRule = {
  id: "rule",
  requestId: "request",
  description: "Synthetic rent",
  amount: "10",
  type: "EXPENSE",
  categoryId: "groceries",
  frequency: "MONTHLY",
  paymentDay: 1,
  secondPaymentDay: null,
  startDate: "2026-01-01",
  endDate: null,
  nextDate: "2099-01-01",
  enabled: true,
  archived: false,
  status: "ACTIVE",
  version: 4,
  catchUpPending: false,
};
let rules: RecurringRule[];
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function () {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function () {
      this.removeAttribute("open");
    },
  });
  rules = [{ ...base }];
  fetcher = vi
    .fn()
    .mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.endsWith("/stop")) {
        rules = [
          {
            ...rules[0],
            enabled: false,
            archived: true,
            status: "CANCELED",
            version: 5,
          },
        ];
        return new Response(JSON.stringify(rules[0]));
      }
      if (path.endsWith("/state")) {
        rules = [{ ...rules[0], enabled: false, status: "PAUSED", version: 5 }];
        return new Response(JSON.stringify(rules[0]));
      }
      if (path.endsWith("/reconcile"))
        return new Response(
          JSON.stringify({ date: "2099-01-01", resolution: "MANUAL" }),
        );
      if (path === "/api/recurring-transactions" && !init?.method)
        return new Response(JSON.stringify(rules));
      return new Response(JSON.stringify([]));
    });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const setup = (transactions: Transaction[] = []) =>
  render(
    <RecurringTransactions
      categories={categories}
      transactions={transactions}
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );
describe("recurring workspace actions", () => {
  it("requires explicit cancellation confirmation and sends the current version", async () => {
    setup();
    await screen.findByText("Your recurring schedules");
    await screen.findByRole("button", { name: "Cancel schedule" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel schedule" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(/recorded transactions stay unchanged/),
    ).toBeTruthy();
    expect(fetcher.mock.calls.some(([path]) => path.endsWith("/stop"))).toBe(
      false,
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm cancellation" }),
    );
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(
          ([path, init]) =>
            path.endsWith("/stop") && JSON.parse(init.body).version === 4,
        ),
      ).toBe(true),
    );
    await screen.findByText("canceled");
    expect(
      screen.queryByRole("button", { name: "Cancel schedule" }),
    ).toBeNull();
  });
  it("pause uses the state endpoint and updates the action to resume", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
    await screen.findByRole("button", { name: "Resume" });
    expect(
      fetcher.mock.calls.some(
        ([path, init]) =>
          path.endsWith("/state") && JSON.parse(init.body).enabled === false,
      ),
    ).toBe(true);
  });
  it("explicit manual reconciliation links an existing payment without creating another transaction", async () => {
    setup([
      {
        id: "manual",
        description: "Already recorded rent",
        amount: 10,
        type: "EXPENSE",
        categoryId: "groceries",
        date: "2026-01-01",
      },
    ]);
    fireEvent.click(
      await screen.findByRole("button", { name: "Reconcile payment" }),
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Existing payment"), {
      target: { value: "manual" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Confirm handled occurrence",
      }),
    );
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(
          ([path, init]) =>
            path.endsWith("/reconcile") &&
            JSON.parse(init.body).transactionId === "manual",
        ),
      ).toBe(true),
    );
    expect(
      fetcher.mock.calls.some(
        ([path, init]) =>
          path === "/api/transactions" && init?.method === "POST",
      ),
    ).toBe(false);
  });
  it("shows the empty state without fabricated totals", async () => {
    rules = [];
    setup();
    await screen.findByText("No recurring schedules yet");
    expect(screen.getAllByText("No active schedules")).toHaveLength(2);
  });
});
