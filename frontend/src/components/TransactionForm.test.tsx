// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import TransactionForm from "./TransactionForm";
import type { Category, CategoryPrediction } from "../api";

const categories: Category[] = [
  { id: "dining", name: "Dining", type: "EXPENSE" },
  { id: "groceries", name: "Groceries", type: "EXPENSE" },
  { id: "utilities", name: "Utilities", type: "EXPENSE" },
  { id: "salary", name: "Salary", type: "INCOME" },
];
const prediction: CategoryPrediction = {
  predictionId: "prediction-1",
  category: "Groceries",
  categoryId: "groceries",
  categoryName: "Groceries",
  confidence: 0.7342,
  modelVersion: "1.0",
  status: "suggested",
};
const response = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
function setup(value: CategoryPrediction = prediction) {
  const fetcher = vi.fn().mockImplementation(async () => response(value));
  vi.stubGlobal("fetch", fetcher);
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <TransactionForm categories={categories} onSave={save} onClose={vi.fn()} />,
  );
  return { save, fetcher };
}
function fill(description = "Walmart groceries") {
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: description },
  });
  fireEvent.change(screen.getByLabelText("Amount (USD)"), {
    target: { value: "8.75" },
  });
}
const selectedCategory = () =>
  (screen.getByLabelText("Category") as HTMLSelectElement).value;
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AI category suggestions in the transaction form", () => {
  it("shows model confidence and changes category only on explicit acceptance", async () => {
    const { save, fetcher } = setup();
    fill();
    await screen.findByText("AI suggested: Groceries");
    expect(screen.getByText("73% model confidence")).toBeTruthy();
    expect(selectedCategory()).toBe("dining");
    const init = fetcher.mock.calls[0][1];
    expect(JSON.parse(init.body)).toEqual({
      description: "Walmart groceries",
      amount: "8.75",
    });
    fireEvent.click(screen.getByRole("button", { name: "Use suggestion" }));
    expect(selectedCategory()).toBe("groceries");
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          categoryId: "groceries",
          predictionId: "prediction-1",
        }),
      ),
    );
  });

  it("never overwrites a manual selection when a prediction arrives and submits the correction", async () => {
    const { save } = setup();
    fill();
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "utilities" },
    });
    await screen.findByText("AI suggested: Groceries");
    expect(selectedCategory()).toBe("utilities");
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          categoryId: "utilities",
          predictionId: "prediction-1",
        }),
      ),
    );
  });

  it("allows a manual override after accepting a suggestion", async () => {
    const { save } = setup();
    fill();
    await screen.findByText("AI suggested: Groceries");
    fireEvent.click(screen.getByRole("button", { name: "Use suggestion" }));
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "utilities" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          categoryId: "utilities",
          predictionId: "prediction-1",
        }),
      ),
    );
  });

  it.each(["upstream unavailable", "network failure"])(
    "allows saving during %s",
    async (failure) => {
      const { save, fetcher } = setup({
        ...prediction,
        status: "unavailable",
        predictionId: null,
        categoryId: null,
        category: null,
        categoryName: null,
        confidence: null,
      });
      if (failure === "network failure")
        fetcher.mockRejectedValue(new Error("offline"));
      fill();
      await screen.findByText(/AI suggestions are unavailable/);
      fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
      await waitFor(() => expect(save).toHaveBeenCalled());
      expect(save.mock.calls[0][0].predictionId).toBeUndefined();
    },
  );

  it("does not invent a category or feedback for unknown descriptions", async () => {
    const { save } = setup({
      ...prediction,
      status: "unknown",
      category: null,
      categoryId: null,
      categoryName: null,
    });
    fill("zxqv unknown");
    await screen.findByText(/No reliable AI suggestion/);
    expect(screen.queryByRole("button", { name: "Use suggestion" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0].predictionId).toBeUndefined();
  });

  it("aborts stale requests and ignores their late responses", async () => {
    const { fetcher } = setup();
    let resolveFirst!: (value: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    fill();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Starbucks coffee" },
    });
    fetcher.mockImplementation(async () =>
      response({
        ...prediction,
        predictionId: "new",
        category: "Food & Drinks",
        categoryName: "Dining",
        categoryId: "dining",
      }),
    );
    await screen.findByText("AI suggested: Food & Drinks");
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => {
      resolveFirst(response(prediction));
    });
    expect(screen.queryByText("AI suggested: Groceries")).toBeNull();
  });

  it("does not request suggestions for income", async () => {
    const { fetcher } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Income" }));
    fill("Monthly salary");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("AI category suggestion")).toBeNull();
  });

  it("discards a prediction immediately when the amount changes before saving", async () => {
    const { save } = setup();
    fill();
    await screen.findByText("AI suggested: Groceries");
    fireEvent.change(screen.getByLabelText("Amount (USD)"), {
      target: { value: "9.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0].predictionId).toBeUndefined();
  });
});
