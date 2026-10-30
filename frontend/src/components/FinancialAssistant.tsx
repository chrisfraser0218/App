import { useEffect, useRef, useState, type FormEvent } from "react";
import { request } from "../api";
import { money } from "../finance";
import {
  ASSISTANT_QUESTIONS,
  type AssistantAnswer,
  type AssistantContext,
} from "../assistant";
interface Exchange {
  id: number;
  question: string;
  context: AssistantContext | null;
  answer?: AssistantAnswer;
  error?: string;
}
const kinds: Record<string, string> = {
  ACTUAL_ALLOCATION: "Recorded savings allocation",
  ALLOCATION_ESTIMATE: "Savings allocation estimate",
  ACTUAL: "Actual recorded data",
  PROJECTED: "Forecast",
  HYPOTHETICAL: "Hypothetical — not saved",
  ESTIMATE: "Estimate",
  STATISTICAL_OBSERVATION: "Statistical observation",
  LIMITATION: "Clarification / limitation",
};
function value(label: string, amount: string | null) {
  if (amount === null) return "No baseline";
  if (label === "Change percent" || label.endsWith(" progress percent"))
    return amount + "%";
  return /^-?\d+\.\d{2}$/.test(amount) ? money(amount) : amount;
}
export default function FinancialAssistant() {
  const [messages, setMessages] = useState<Exchange[]>([]),
    [question, setQuestion] = useState(""),
    [busy, setBusy] = useState(false);
  const context = useRef<AssistantContext | null>(null),
    active = useRef<AbortController | null>(null),
    sequence = useRef(0),
    bottom = useRef<HTMLDivElement>(null);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [messages, busy]);
  async function ask(text: string, retryId?: number) {
    if (busy || !text.trim() || text.trim().length > 1000) return;
    const id = retryId ?? ++sequence.current,
      controller = new AbortController();
    const requestContext = retryId
      ? (messages.find((m) => m.id === retryId)?.context ?? null)
      : context.current;
    active.current = controller;
    setBusy(true);
    setQuestion("");
    setMessages((old) =>
      retryId
        ? old.map((m) =>
            m.id === id ? { id, question: text, context: requestContext } : m,
          )
        : [...old.slice(-19), { id, question: text, context: requestContext }],
    );
    try {
      const answer = await request<AssistantAnswer>("/assistant/questions", {
        method: "POST",
        body: JSON.stringify({ question: text, context: requestContext }),
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        context.current = answer.context;
        setMessages((old) =>
          old.map((m) => (m.id === id ? { ...m, answer } : m)),
        );
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setMessages((old) =>
          old.map((m) =>
            m.id === id ? { ...m, error: (e as Error).message } : m,
          ),
        );
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }
  function clear() {
    active.current?.abort();
    active.current = null;
    context.current = null;
    setMessages([]);
    setQuestion("");
    setBusy(false);
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void ask(question.trim());
  }
  return (
    <section
      className="assistant-workspace"
      aria-label="Local financial assistant"
    >
      <div className="panel assistant-intro">
        <div className="panel-heading">
          <div>
            <h2>Your local financial assistant</h2>
            <p>
              Offline deterministic assistant · No language model installed or
              used
            </p>
          </div>
          <button
            className="secondary"
            onClick={clear}
            disabled={!messages.length}
          >
            Clear conversation
          </button>
        </div>
        <p className="muted">
          Ask about recorded finances, scheduled payments or projections.
          Answers use existing financial calculations and show their sources.
          This assistant cannot change records or perform actions.
        </p>
        <p className="muted">
          Conversation stays in this page’s memory, is not saved, and clears
          when you leave or reload. Previous answers are snapshots; ask again
          after changing your records.
        </p>
      </div>
      <div className="assistant-suggestions" aria-label="Suggested questions">
        {ASSISTANT_QUESTIONS.map((q) => (
          <button
            className="secondary"
            key={q}
            disabled={busy}
            onClick={() => void ask(q)}
          >
            {q}
          </button>
        ))}
      </div>
      <div
        className="assistant-conversation"
        role="log"
        aria-label="Conversation"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {!messages.length && (
          <div className="panel assistant-empty">
            <h2>Start with your finances</h2>
            <p>
              Try a suggested question or type your own. Use category names,
              named months or YYYY-MM-DD dates.
            </p>
            <p className="muted">
              Example follow-up: “What about the month before?” after a category
              spending question. For a hypothetical purchase: “What if I spend
              $1,000 in December 2026?”
            </p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className="assistant-exchange">
            <div className="assistant-user">
              <strong>You</strong>
              <p>{m.question}</p>
            </div>
            {m.error && (
              <div className="panel assistant-answer" role="alert">
                <h3>We couldn’t get an answer</h3>
                <p>{m.error}</p>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void ask(m.question, m.id)}
                >
                  Retry question
                </button>
              </div>
            )}
            {m.answer && (
              <article className="panel assistant-answer">
                <div className="assistant-answer-heading">
                  <strong>FinSight</strong>
                  <span className="demo-pill">
                    {kinds[m.answer.kind] ?? m.answer.kind}
                  </span>
                </div>
                <h3>{m.answer.title}</h3>
                <p>{m.answer.text}</p>
                <p className="muted">
                  As of {m.answer.asOfDate}
                  {m.answer.from && m.answer.to
                    ? ` · ${m.answer.from} through ${m.answer.to}`
                    : ""}
                </p>
                {!!m.answer.metrics.length && (
                  <dl className="assistant-metrics">
                    {m.answer.metrics.map((metric, i) => (
                      <div key={i}>
                        <dt>{metric.label}</dt>
                        <dd>{value(metric.label, metric.value)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {!!m.answer.assumptions.length && (
                  <details>
                    <summary>Sources, assumptions and limitations</summary>
                    <ul>
                      {m.answer.assumptions.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {!!m.answer.evidence.length && (
                  <details>
                    <summary>
                      Supporting records ({m.answer.evidence.length} of{" "}
                      {m.answer.evidenceCount})
                    </summary>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Scheduled / recorded date</th>
                            <th>Description</th>
                            <th>Category</th>
                            <th>Type / source</th>
                            <th>Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {m.answer.evidence.map((e, i) => (
                            <tr key={e.id + "-" + i}>
                              <td>{e.date}</td>
                              <td>{e.description}</td>
                              <td>{e.category ?? "—"}</td>
                              <td>
                                {e.type} · {e.source}
                              </td>
                              <td>{money(e.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
                <div className="assistant-links">
                  {m.answer.links
                    .filter((l) =>
                      [
                        "#dashboard",
                        "#transactions",
                        "#insights",
                        "#forecast",
                        "#calendar",
                        "#recurring",
                        "#savings",
                      ].includes(l.href),
                    )
                    .map((l) => (
                      <a key={l.href} href={l.href} className="text-button">
                        {l.label} →
                      </a>
                    ))}
                </div>
              </article>
            )}
          </div>
        ))}
        {busy && (
          <div className="panel assistant-answer" role="status">
            Reading local financial data…
          </div>
        )}
        <div ref={bottom} />
      </div>
      <form className="panel assistant-composer" onSubmit={submit}>
        <label htmlFor="assistant-question">Ask a financial question</label>
        <textarea
          id="assistant-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          required
          maxLength={1000}
          rows={2}
          placeholder="How much did I spend on groceries last month?"
          disabled={busy}
        />
        <div>
          <small className="muted">
            {question.length}/1000 · Read-only · No external AI
          </small>
          <button className="primary" disabled={busy || !question.trim()}>
            {busy ? "Working…" : "Ask FinSight"}
          </button>
        </div>
      </form>
    </section>
  );
}
