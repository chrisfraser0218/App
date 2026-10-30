import { useEffect, useState } from "react";
import { request, type Category, type Transaction } from "../api";
import type { Plan, PlanInput } from "../forecast";
import { money } from "../finance";
import { shortDate } from "../recurring";
import Modal from "./Modal";
import PlanForm from "./PlanForm";

export default function PlannedTransactions({
  categories,
  transactions,
  today,
  onChanged,
}: {
  categories: Category[];
  transactions: Transaction[];
  today: string;
  onChanged: () => Promise<void>;
}) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Plan>();
  const [modal, setModal] = useState<
    "create" | "edit" | "cancel" | "complete" | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [mode, setMode] = useState("LINK");
  const [transactionId, setTransaction] = useState("");
  const [recordedDate, setRecordedDate] = useState(today);
  const [confirmed, setConfirmed] = useState(false);
  const [completionId, setCompletionId] = useState("");
  const names = new Map(categories.map((c) => [c.id, c.name]));
  async function load() {
    try {
      setPlans(await request<Plan[]>("/planned-transactions"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [transactions]);
  function close() {
    if (!busy) {
      setModal(null);
      setSelected(undefined);
      setActionError("");
    }
  }
  async function save(input: PlanInput) {
    setBusy(true);
    try {
      await request(
        selected
          ? `/planned-transactions/${selected.id}`
          : "/planned-transactions",
        {
          method: selected ? "PUT" : "POST",
          body: JSON.stringify(
            selected ? { plan: input, version: selected.version } : input,
          ),
        },
      );
      await load();
      await onChanged();
    } finally {
      setBusy(false);
    }
  }
  function openComplete(p: Plan) {
    setSelected(p);
    setMode(p.date <= today ? "RECORD" : "LINK");
    setTransaction("");
    setRecordedDate(today);
    setConfirmed(false);
    setCompletionId(crypto.randomUUID());
    setActionError("");
    setModal("complete");
  }
  async function act() {
    if (!selected) return;
    setBusy(true);
    setActionError("");
    try {
      const data =
        modal === "cancel"
          ? { version: selected.version }
          : {
              mode,
              version: selected.version,
              requestId: completionId,
              transactionId: mode === "LINK" ? transactionId : null,
              recordedDate: mode === "RECORD" ? recordedDate : null,
              confirmAmountDifference: confirmed,
            };
      if (modal === "complete" && mode === "LINK" && !transactionId) {
        setActionError("Choose an existing payment.");
        return;
      }
      await request(
        `/planned-transactions/${selected.id}/${modal === "cancel" ? "cancel" : "complete"}`,
        { method: "POST", body: JSON.stringify(data) },
      );
      setModal(null);
      setSelected(undefined);
      await load();
      await onChanged();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const linked = transactions.find((t) => t.id === transactionId);
  const mismatch =
    linked && selected && Number(linked.amount) !== Number(selected.amount);
  return (
    <section className="panel planned-panel">
      <div className="panel-heading">
        <div>
          <h2>Planned one-time transactions</h2>
          <p>
            Future intentions, separate from your actual ledger. Due plans need
            your explicit completion.
          </p>
        </div>
        <button
          className="primary"
          onClick={() => {
            setSelected(undefined);
            setModal("create");
          }}
        >
          Add planned transaction
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
          <button className="text-button" onClick={() => void load()}>
            Retry plans
          </button>
        </p>
      )}
      {loading ? (
        <p className="empty" role="status">
          Loading plans…
        </p>
      ) : !plans.length ? (
        <div className="empty">
          <h3>No planned transactions</h3>
          <p>
            Add a vacation, bonus, or one-time repair to include it in your
            projection.
          </p>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Plan</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.description}</strong>
                    <small className="recurring-meta">
                      {p.type === "INCOME" ? "Income" : "Expense"} ·{" "}
                      {names.get(p.categoryId)}
                    </small>
                  </td>
                  <td className="nowrap">{shortDate(p.date)}</td>
                  <td
                    className={
                      p.type === "INCOME" ? "positive nowrap" : "nowrap"
                    }
                  >
                    {p.type === "INCOME" ? "+" : "−"}
                    {money(p.amount)}
                  </td>
                  <td>
                    <span className="category-tag">
                      {p.overdue ? "overdue" : p.status.toLowerCase()}
                    </span>
                    {p.completionMode && (
                      <small className="recurring-meta">
                        {p.completionMode.toLowerCase()}
                        {p.completionMode !== "HANDLED" && !p.transactionId
                          ? " · linked entry removed"
                          : ""}
                      </small>
                    )}
                  </td>
                  <td>
                    {p.status === "PLANNED" && (
                      <div className="recurring-row-actions">
                        <button
                          className="text-button"
                          onClick={() => {
                            setSelected(p);
                            setModal("edit");
                          }}
                        >
                          Edit plan
                        </button>
                        <button
                          className="text-button"
                          onClick={() => openComplete(p)}
                        >
                          Complete / link payment
                        </button>
                        <button
                          className="text-button danger-text"
                          onClick={() => {
                            setSelected(p);
                            setActionError("");
                            setModal("cancel");
                          }}
                        >
                          Cancel plan
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(modal === "create" || modal === "edit") && (
        <Modal
          title={
            selected ? "Edit planned transaction" : "Add planned transaction"
          }
          onClose={close}
        >
          <PlanForm
            categories={categories}
            today={today}
            existing={selected}
            onSave={save}
            onClose={close}
          />
        </Modal>
      )}
      {modal === "cancel" && selected && (
        <Modal title="Cancel planned transaction?" onClose={close}>
          <div className="form-stack">
            <p>
              Cancel “{selected.description}”? It leaves the forecast. Actual
              transactions and your current balance stay unchanged.
            </p>
            {actionError && (
              <p className="error" role="alert">
                {actionError}
              </p>
            )}
            <div className="form-row">
              <button className="secondary" disabled={busy} onClick={close}>
                Keep plan
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() => void act()}
              >
                Confirm plan cancellation
              </button>
            </div>
          </div>
        </Modal>
      )}
      {modal === "complete" && selected && (
        <Modal title="Complete planned transaction" onClose={close}>
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void act();
            }}
          >
            <p>
              {selected.description} · {money(selected.amount)} ·{" "}
              {shortDate(selected.date)}
            </p>
            <label>
              Completion action
              <select
                aria-label="Completion action"
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value);
                  setConfirmed(false);
                }}
              >
                <option value="RECORD" disabled={selected.date > today}>
                  Record an actual payment (due plans only)
                </option>
                <option value="LINK">Link an already recorded payment</option>
                <option value="HANDLED">
                  Mark completed without recording money
                </option>
              </select>
            </label>
            {mode === "RECORD" ? (
              <>
                <p className="notice">
                  This explicitly creates one actual transaction and changes
                  your current balance. It also removes the plan from future
                  totals. For a different paid amount, enter the payment
                  manually and link it instead.
                </p>
                <label>
                  Actual payment date
                  <input
                    required
                    type="date"
                    max={today}
                    min="1900-01-01"
                    value={recordedDate}
                    onChange={(e) => setRecordedDate(e.target.value)}
                  />
                </label>
              </>
            ) : mode === "LINK" ? (
              <>
                <p className="muted">
                  No new money is recorded. The existing payment’s date, amount,
                  and category are preserved.
                </p>
                <label>
                  Recorded payment
                  <select
                    aria-label="Recorded payment"
                    required
                    value={transactionId}
                    onChange={(e) => {
                      setTransaction(e.target.value);
                      setConfirmed(false);
                    }}
                  >
                    <option value="">Choose a recorded transaction</option>
                    {transactions
                      .filter((t) => t.type === selected.type)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.description} · {money(t.amount)} · {t.date}
                        </option>
                      ))}
                  </select>
                </label>
                {mismatch && (
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      required
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    I confirm the payment amount {money(linked.amount)} differs
                    from the planned {money(selected.amount)}.
                  </label>
                )}
              </>
            ) : (
              <p className="notice">
                No actual transaction or cash movement will be recorded. This
                only removes the item from projections.
              </p>
            )}
            {actionError && (
              <p className="error" role="alert">
                {actionError}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? "Completing…" : "Confirm completion"}
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
