// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import RecurringForm from "./RecurringForm";
import { localDate } from "../finance";
import type { Category, RecurringRule } from "../api";

const categories: Category[] = [
  { id: "groceries", name: "Groceries", type: "EXPENSE" },
  { id: "dining", name: "Dining", type: "EXPENSE" },
  { id: "salary", name: "Salary", type: "INCOME" },
];
const existing: RecurringRule = {
  id: "rule",
  requestId: "original-request",
  description: "Rent",
  amount: "10.00",
  type: "EXPENSE",
  categoryId: "groceries",
  frequency: "MONTHLY",
  paymentDay: 1,
  secondPaymentDay: null,
  startDate: "2026-01-01",
  endDate: null,
  nextDate: "2026-11-01",
  enabled: true,
  archived: false,
  status: "ACTIVE",
  version: 4,
  catchUpPending: false,
};
function setup(rule?: RecurringRule) {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("AI offline")));
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <RecurringForm
      categories={categories}
      existing={rule}
      onSave={save}
      onClose={vi.fn()}
    />,
  );
  return save;
}
function fill() {
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "Synthetic rent" },
  });
  fireEvent.change(screen.getByLabelText("Amount (USD)"), {
    target: { value: "15.25" },
  });
}
function submit() {
  fireEvent.submit(
    screen
      .getByRole("button", {
        name: /Create recurring schedule|Save schedule changes/,
      })
      .closest("form")!,
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("recurring schedule form", () => {
  it("creates twice-monthly schedules with configurable days and an optional end date", async () => {
    const save = setup();
    fill();
    fireEvent.change(screen.getByLabelText("Frequency"), {
      target: { value: "TWICE_MONTHLY" },
    });
    fireEvent.change(screen.getByLabelText("First payment day"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByLabelText("Second payment day"), {
      target: { value: "20" },
    });
    fireEvent.change(screen.getByLabelText("End date (optional)"), {
      target: { value: "2099-12-31" },
    });
    submit();
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          frequency: "TWICE_MONTHLY",
          paymentDay: 5,
          secondPaymentDay: 20,
          endDate: "2099-12-31",
          amount: "15.25",
          enabled: true,
          requestId: expect.any(String),
        }),
      ),
    );
  });
  it("rejects duplicate days and invalid ranges without submitting", () => {
    const save = setup();
    fill();
    fireEvent.change(screen.getByLabelText("Frequency"), {
      target: { value: "TWICE_MONTHLY" },
    });
    fireEvent.change(screen.getByLabelText("First payment day"), {
      target: { value: "15" },
    });
    submit();
    expect(screen.getByRole("alert").textContent).toMatch(/valid payment days/);
    expect(save).not.toHaveBeenCalled();
  });
  it("rejects an end date before the start", () => {
    const save = setup();
    fill();
    fireEvent.change(screen.getByLabelText("End date (optional)"), {
      target: { value: "2000-01-01" },
    });
    submit();
    expect(screen.getByRole("alert").textContent).toMatch(/End date/);
    expect(save).not.toHaveBeenCalled();
  });
  it("requires explicit authorization before posting a past schedule", async () => {
    const save = setup();
    fill();
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2020-01-01" },
    });
    submit();
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(
      /Confirm the catch-up/,
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /I authorize posting all due/ }),
    );
    submit();
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          backfillConfirmed: true,
          startDate: "2020-01-01",
        }),
      ),
    );
  });
  it("allows paused schedules without authorizing backfill", async () => {
    const save = setup();
    fill();
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2020-01-01" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Start active" }));
    submit();
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false, backfillConfirmed: false }),
      ),
    );
  });
  it("retains the request ID during edits and does not change an existing category", async () => {
    const save = setup(existing);
    fireEvent.change(screen.getByLabelText("Frequency"), {
      target: { value: "WEEKLY" },
    });
    submit();
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "original-request",
          categoryId: "groceries",
          frequency: "WEEKLY",
          paymentDay: null,
          secondPaymentDay: null,
        }),
      ),
    );
  });
  it("does not overwrite manually chosen categories when AI completes", async () => {
    const save = setup();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(
          async () =>
            new Response(
              JSON.stringify({
                predictionId: "prediction",
                category: "Food & Drinks",
                categoryId: "dining",
                categoryName: "Dining",
                confidence: 0.81,
                modelVersion: "1.0",
                status: "suggested",
              }),
              { status: 200 },
            ),
        ),
    );
    fill();
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "groceries" },
    });
    await screen.findByText("AI suggested: Food & Drinks");
    expect((screen.getByLabelText("Category") as HTMLSelectElement).value).toBe(
      "groceries",
    );
    submit();
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          categoryId: "groceries",
          predictionId: "prediction",
        }),
      ),
    );
  });
  it("allows future starts without posting authorization and omits monthly days for yearly schedules", async () => {
    const save = setup();
    fill();
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2099-02-01" },
    });
    fireEvent.change(screen.getByLabelText("Frequency"), {
      target: { value: "YEARLY" },
    });
    submit();
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          startDate: "2099-02-01",
          frequency: "YEARLY",
          paymentDay: null,
          secondPaymentDay: null,
          backfillConfirmed: false,
        }),
      ),
    );
    expect(localDate()).toHaveLength(10);
  });
});
