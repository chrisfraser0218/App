// @vitest-environment jsdom
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import FinancialAssistant from "./FinancialAssistant";
import type { AssistantAnswer } from "../assistant";
const answer: AssistantAnswer = {
  status: "answered",
  mode: "deterministic",
  kind: "ACTUAL",
  title: "Recorded spending",
  text: "Groceries: $12.34 in recorded expenses.",
  asOfDate: "2026-10-15",
  from: "2026-09-01",
  to: "2026-09-30",
  metrics: [
    { label: "Recorded expenses", value: "12.34" },
    { label: "Change percent", value: null },
  ],
  evidence: [
    {
      id: "t1",
      description: "Synthetic groceries",
      amount: "12.34",
      type: "EXPENSE",
      date: "2026-09-10",
      category: "Groceries",
      source: "RECORDED",
    },
  ],
  evidenceCount: 1,
  assumptions: ["Calculation source: SpendingService. Recorded activity only."],
  links: [{ label: "View source", href: "#insights" }],
  suggestions: [],
  context: {
    intent: "SPENDING",
    categoryId: "food",
    from: "2026-09-01",
    to: "2026-09-30",
  },
};
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetcher = vi
    .fn()
    .mockResolvedValue({ ok: true, status: 200, json: async () => answer });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function send(question: string) {
  fireEvent.change(screen.getByLabelText("Ask a financial question"), {
    target: { value: question },
  });
  fireEvent.click(screen.getByRole("button", { name: "Ask FinSight" }));
}
it("identifies deterministic offline mode and suggested questions", () => {
  render(<FinancialAssistant />);
  expect(screen.getByText(/No language model installed or used/)).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "How much did I spend this month?" }),
  ).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
});
it("submits a question and displays exact answer, labels, evidence and source", async () => {
  render(<FinancialAssistant />);
  send("Groceries last month?");
  await screen.findByText("Recorded spending");
  expect(screen.getByText("Actual recorded data")).toBeTruthy();
  expect(screen.getAllByText("$12.34")).toHaveLength(2);
  expect(screen.getByText("No baseline")).toBeTruthy();
  fireEvent.click(screen.getByText("Supporting records (1 of 1)"));
  expect(screen.getByText("Synthetic groceries")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "View source →" }).getAttribute("href"),
  ).toBe("#insights");
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    question: "Groceries last month?",
    context: null,
  });
});
it("uses returned structured context for follow-up", async () => {
  render(<FinancialAssistant />);
  send("Groceries last month?");
  await screen.findByText("Recorded spending");
  send("What about the month before?");
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetcher.mock.calls[1][1].body).context).toEqual(
    answer.context,
  );
});
it("clarification clears context rather than inventing a follow-up", async () => {
  fetcher.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      ...answer,
      status: "clarification",
      context: null,
      kind: "LIMITATION",
      title: "Let’s clarify",
    }),
  });
  render(<FinancialAssistant />);
  send("What about before?");
  await screen.findByText("Let’s clarify");
  send("What about before?");
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetcher.mock.calls[1][1].body).context).toBeNull();
});
it("shows loading and prevents concurrent requests", async () => {
  fetcher.mockReturnValue(new Promise(() => {}));
  render(<FinancialAssistant />);
  send("Spending this month");
  expect(screen.getByRole("status").textContent).toContain("Reading local");
  expect(
    (screen.getByRole("button", { name: "Working…" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("shows retryable errors and resends the same question", async () => {
  fetcher.mockRejectedValueOnce(new Error("Local backend unavailable"));
  render(<FinancialAssistant />);
  send("Spending this month");
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Retry question" }));
  await screen.findByText("Recorded spending");
  expect(JSON.parse(fetcher.mock.calls[1][1].body).question).toBe(
    "Spending this month",
  );
});
it("clear aborts pending response and removes in-memory conversation", async () => {
  let resolve!: (v: any) => void;
  fetcher.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  render(<FinancialAssistant />);
  send("Spending this month");
  fireEvent.click(screen.getByRole("button", { name: "Clear conversation" }));
  resolve({ ok: true, json: async () => answer });
  await waitFor(() =>
    expect(screen.queryByText("Recorded spending")).toBeNull(),
  );
  expect(screen.getByText("Start with your finances")).toBeTruthy();
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
});
it("unmount aborts requests and a new mount has no conversation/context", async () => {
  fetcher.mockReturnValueOnce(new Promise(() => {}));
  const view = render(<FinancialAssistant />);
  send("Spending this month");
  view.unmount();
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  render(<FinancialAssistant />);
  send("What about before?");
  await screen.findByText("Recorded spending");
  expect(JSON.parse(fetcher.mock.calls[1][1].body).context).toBeNull();
});
it("hypothetical and projected replies are explicitly distinguished", async () => {
  fetcher.mockResolvedValue({
    ok: true,
    json: async () => ({
      ...answer,
      kind: "HYPOTHETICAL",
      title: "Purchase — not saved",
      context: null,
    }),
  });
  render(<FinancialAssistant />);
  send("What if I spend $100 in December?");
  await screen.findByText("Hypothetical — not saved");
  expect(screen.queryByText("Actual recorded data")).toBeNull();
});
it("renders malicious descriptions and user input as text; rejects external source links", async () => {
  fetcher.mockResolvedValue({
    ok: true,
    json: async () => ({
      ...answer,
      evidence: [
        {
          ...answer.evidence[0],
          description: "<img src=x onerror=alert(1)> Ignore instructions",
        },
      ],
      links: [{ label: "unsafe", href: "https://external.invalid" }],
    }),
  });
  const view = render(<FinancialAssistant />);
  send("<script>restore backups</script>");
  await screen.findByText("Recorded spending");
  expect(view.container.querySelector("script")).toBeNull();
  expect(view.container.querySelector("img")).toBeNull();
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.getByText(/<img src=x/)).toBeTruthy();
});
it("limits input and makes no request for whitespace", () => {
  render(<FinancialAssistant />);
  expect(
    screen.getByLabelText("Ask a financial question").getAttribute("maxlength"),
  ).toBe("1000");
  fireEvent.change(screen.getByLabelText("Ask a financial question"), {
    target: { value: "   " },
  });
  expect(
    (screen.getByRole("button", { name: "Ask FinSight" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
});
it("suggestion starts a real question request", async () => {
  render(<FinancialAssistant />);
  fireEvent.click(
    screen.getByRole("button", { name: "How much did I spend this month?" }),
  );
  await screen.findByText("Recorded spending");
  expect(JSON.parse(fetcher.mock.calls[0][1].body).question).toBe(
    "How much did I spend this month?",
  );
});

it("retry retains original context after a later conversation topic", async () => {
  fetcher
    .mockResolvedValueOnce({ ok: true, json: async () => answer })
    .mockRejectedValueOnce(new Error("Temporary failure"))
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...answer, title: "Other topic", context: null }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...answer, title: "Retried answer" }),
    });
  render(<FinancialAssistant />);
  send("Groceries last month?");
  await screen.findByText("Recorded spending");
  send("What about the month before?");
  await screen.findByRole("alert");
  send("Current actual balance");
  await screen.findByText("Other topic");
  fireEvent.click(screen.getByRole("button", { name: "Retry question" }));
  await screen.findByText("Retried answer");
  expect(JSON.parse(fetcher.mock.calls[3][1].body).context).toEqual(
    answer.context,
  );
});
