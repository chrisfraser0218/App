import { useEffect, useState } from "react";
import {
  request,
  type Category,
  type Occurrence,
  type ProcessResult,
  type RecurringInput,
  type RecurringRule,
  type Transaction,
} from "../api";
import { localDate, money } from "../finance";
import { FREQUENCIES, recurringTotals, shortDate } from "../recurring";
import Modal from "./Modal";
import RecurringForm from "./RecurringForm";
import Icon from "./Icon";

export default function RecurringTransactions({
  categories,
  transactions,
  onChanged,
  focusRuleId,
}: {
  categories: Category[];
  transactions: Transaction[];
  onChanged: () => Promise<void>;
  focusRuleId?: string;
}) {
  const [rules, setRules] = useState<RecurringRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<RecurringRule>();
  const [modal, setModal] = useState<
    "create" | "edit" | "cancel" | "reconcile" | null
  >(null);
  const [detailRule, setDetailRule] = useState<RecurringRule>();
  const [history, setHistory] = useState<Occurrence[]>([]);
  const [upcoming, setUpcoming] = useState<Occurrence[]>([]);
  const [detailError, setDetailError] = useState("");
  const [occurrenceDate, setOccurrenceDate] = useState(localDate());
  const [transactionId, setTransactionId] = useState("");
  const [confirmDifference, setConfirmDifference] = useState(false);
  const [modalError, setModalError] = useState("");
  const names = new Map(categories.map((c) => [c.id, c.name]));
  async function load() {
    setError("");
    try {
      setRules(await request<RecurringRule[]>("/recurring-transactions"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [transactions]);
  useEffect(() => {
    const focused = rules.find((r) => r.id === focusRuleId);
    if (focused) {
      void details(focused);
      setTimeout(
        () =>
          document
            .getElementById("recurring-details")
            ?.scrollIntoView({ block: "start" }),
        0,
      );
    }
  }, [focusRuleId, rules]);
  async function details(rule: RecurringRule) {
    setDetailRule(rule);
    setDetailError("");
    setHistory([]);
    setUpcoming([]);
    const through = new Date();
    through.setDate(through.getDate() + 60);
    try {
      const [posted, future] = await Promise.all([
        request<Occurrence[]>(`/recurring-transactions/${rule.id}/history`),
        request<Occurrence[]>(
          `/recurring-transactions/${rule.id}/occurrences?from=${localDate()}&to=${localDate(through)}`,
        ),
      ]);
      setHistory(posted);
      setUpcoming(future);
    } catch (e) {
      setDetailError((e as Error).message);
    }
  }
  async function refresh() {
    await load();
    await onChanged();
    if (detailRule) await details(detailRule);
  }
  async function state(rule: RecurringRule) {
    setBusy(true);
    setError("");
    try {
      await request(`/recurring-transactions/${rule.id}/state`, {
        method: "PUT",
        body: JSON.stringify({ enabled: !rule.enabled, version: rule.version }),
      });
      setNotice(
        rule.enabled
          ? "Schedule paused. Due entries were posted first."
          : "Schedule resumed. Paused dates were skipped.",
      );
      await refresh();
    } catch (e) {
      await load();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function process() {
    setBusy(true);
    setError("");
    try {
      const result = await request<ProcessResult>(
        "/recurring-transactions/process-due",
        { method: "POST" },
      );
      setNotice(
        `${result.posted} due transactions posted. ${result.pendingRules} schedules still pending.${result.failedRules ? " Some schedules could not be processed; try again." : ""}`,
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(input: RecurringInput) {
    setBusy(true);
    try {
      if (modal === "edit" && selected)
        await request(`/recurring-transactions/${selected.id}`, {
          method: "PUT",
          body: JSON.stringify({ rule: input, version: selected.version }),
        });
      else
        await request("/recurring-transactions", {
          method: "POST",
          body: JSON.stringify(input),
        });
      setNotice(
        "Schedule saved. Due occurrences are posted automatically; future dates remain scheduled.",
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  function close() {
    if (!busy) {
      setModal(null);
      setSelected(undefined);
      setModalError("");
    }
  }
  function reconcile(rule: RecurringRule, date = rule.nextDate ?? localDate()) {
    setSelected(rule);
    setOccurrenceDate(date);
    setTransactionId("");
    setConfirmDifference(false);
    setModalError("");
    setModal("reconcile");
  }
  async function confirmAction() {
    if (!selected) return;
    setBusy(true);
    setModalError("");
    try {
      if (modal === "cancel")
        await request(`/recurring-transactions/${selected.id}/stop`, {
          method: "POST",
          body: JSON.stringify({ version: selected.version }),
        });
      else
        await request(`/recurring-transactions/${selected.id}/reconcile`, {
          method: "POST",
          body: JSON.stringify({
            occurrenceDate,
            transactionId: transactionId || null,
            confirmAmountDifference: confirmDifference,
          }),
        });
      setModal(null);
      setSelected(undefined);
      setNotice(
        modal === "cancel"
          ? "Schedule canceled. Posted transactions were preserved."
          : "Occurrence handled. No new ledger entry was created.",
      );
      await refresh();
    } catch (e) {
      setModalError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const active = rules.filter((r) => r.status === "ACTIVE");
  const next = [...active]
    .filter((r) => r.nextDate)
    .sort((a, b) => a.nextDate!.localeCompare(b.nextDate!))[0];
  const selectedPayment = transactions.find((t) => t.id === transactionId);
  const mismatch =
    selectedPayment &&
    selected &&
    Number(selectedPayment.amount) !== Number(selected.amount);
  return (
    <section className="recurring-workspace">
      <div className="recurring-heading">
        <div>
          <h2>Recurring income & expenses</h2>
          <p className="muted">
            Schedules post only when due, including catch-up after reopening.
          </p>
        </div>
        <div className="recurring-actions">
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void process()}
          >
            Process due now
          </button>
          <button
            className="primary"
            onClick={() => {
              setSelected(undefined);
              setModal("create");
            }}
          >
            <Icon name="plus" size={17} />
            Add recurring schedule
          </button>
        </div>
      </div>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
          <button className="text-button" onClick={() => void load()}>
            Refresh schedules
          </button>
        </div>
      )}
      <div className="summary-grid recurring-summary">
        {(["INCOME", "EXPENSE"] as const).map((type) => (
          <article className="summary-card" key={type}>
            <h3>
              {type === "INCOME" ? "Recurring income" : "Recurring expenses"}
            </h3>
            <dl>
              {recurringTotals(rules, type).map((total) => (
                <div key={total.frequency}>
                  <dt>{FREQUENCIES[total.frequency]} · per occurrence</dt>
                  <dd>{money(total.amount)}</dd>
                </div>
              ))}
            </dl>
            {!recurringTotals(rules, type).length && (
              <p className="muted">No active schedules</p>
            )}
          </article>
        ))}
        <article className="summary-card">
          <h3>Active schedules</h3>
          <div className="metric">{active.length}</div>
          <p className="muted">Amounts stay grouped by cadence.</p>
        </article>
        <article className="summary-card">
          <h3>Next upcoming payment</h3>
          {next ? (
            <>
              <strong>{next.description}</strong>
              <p>{shortDate(next.nextDate)}</p>
              <span className={next.type === "INCOME" ? "positive" : ""}>
                {money(next.amount)}
              </span>
            </>
          ) : (
            <p className="muted">Nothing scheduled</p>
          )}
        </article>
      </div>
      {rules.some((r) => r.catchUpPending) && (
        <p className="notice">
          Catch-up is pending. Processing runs automatically in batches; you can
          also use “Process due now.”
        </p>
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Your recurring schedules</h2>
            <p>
              Pausing skips the paused period on resume. Canceling preserves all
              history.
            </p>
          </div>
        </div>
        {loading ? (
          <p className="empty" role="status">
            Loading schedules…
          </p>
        ) : !rules.length ? (
          <div className="empty">
            <Icon name="list" size={30} />
            <h3>No recurring schedules yet</h3>
            <p>Add rent, a subscription, insurance, or a paycheck.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Schedule</th>
                  <th>Amount / cadence</th>
                  <th>Next date</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id}>
                    <td>
                      <strong>{rule.description}</strong>
                      <small className="recurring-meta">
                        {rule.type === "INCOME" ? "Income" : "Expense"} ·{" "}
                        {names.get(rule.categoryId)}
                      </small>
                    </td>
                    <td>
                      <strong>{money(rule.amount)}</strong>
                      <small className="recurring-meta">
                        {FREQUENCIES[rule.frequency]}
                        {rule.paymentDay
                          ? ` · day ${rule.paymentDay}${rule.secondPaymentDay ? ` & ${rule.secondPaymentDay}` : ""}`
                          : ""}
                      </small>
                    </td>
                    <td className="nowrap">
                      {rule.archived ? "—" : shortDate(rule.nextDate)}
                    </td>
                    <td>
                      <span className="category-tag">
                        {rule.status.toLowerCase()}
                      </span>
                    </td>
                    <td>
                      <div className="recurring-row-actions">
                        <button
                          className="text-button"
                          onClick={() => void details(rule)}
                        >
                          View history & upcoming
                        </button>
                        {!rule.archived && (
                          <>
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() => {
                                setSelected(rule);
                                setModal("edit");
                              }}
                            >
                              Edit schedule
                            </button>
                            <button
                              className="text-button"
                              disabled={busy || rule.status === "COMPLETED"}
                              onClick={() => void state(rule)}
                            >
                              {rule.enabled ? "Pause" : "Resume"}
                            </button>
                            <button
                              className="text-button"
                              onClick={() => reconcile(rule)}
                            >
                              Reconcile payment
                            </button>
                            <button
                              className="text-button danger-text"
                              disabled={busy}
                              onClick={() => {
                                setSelected(rule);
                                setModal("cancel");
                              }}
                            >
                              Cancel schedule
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {detailRule && (
        <section id="recurring-details" className="panel recurring-details">
          <div className="panel-heading">
            <div>
              <h2>{detailRule.description}: occurrences</h2>
              <p>
                Upcoming dates are scheduled payments, not posted money or
                balance forecasts.
              </p>
            </div>
            <button
              className="icon-button"
              aria-label="Close occurrence details"
              onClick={() => setDetailRule(undefined)}
            >
              <Icon name="close" />
            </button>
          </div>
          {detailError ? (
            <p className="error" role="alert">
              {detailError}
            </p>
          ) : (
            <div className="occurrence-columns">
              <div>
                <h3>Upcoming · next 60 days</h3>
                {upcoming.length ? (
                  <ul>
                    {upcoming.map((o) => (
                      <li key={o.date}>
                        <span>
                          {shortDate(o.date)}
                          <small>{o.resolution.toLowerCase()}</small>
                        </span>
                        {!detailRule.archived &&
                          (o.resolution === "SCHEDULED" ||
                            o.resolution === "REMOVED") && (
                            <button
                              className="text-button"
                              onClick={() => reconcile(detailRule, o.date)}
                            >
                              Handle occurrence
                            </button>
                          )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No dates in this range.</p>
                )}
              </div>
              <div>
                <h3>Recorded occurrences</h3>
                {history.length ? (
                  <ul>
                    {history.map((o) => (
                      <li key={o.date}>
                        <span>
                          {shortDate(o.date)}
                          <small>
                            {o.resolution.toLowerCase()}{" "}
                            {o.description ? `· ${o.description}` : ""}
                          </small>
                        </span>
                        <strong>
                          {o.amount == null ? "—" : money(o.amount)}
                        </strong>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No occurrences handled yet.</p>
                )}
              </div>
            </div>
          )}
        </section>
      )}
      {(modal === "create" || modal === "edit") && (
        <Modal
          title={
            modal === "edit"
              ? "Edit recurring schedule"
              : "Add recurring schedule"
          }
          onClose={close}
        >
          <RecurringForm
            categories={categories}
            existing={modal === "edit" ? selected : undefined}
            onSave={save}
            onClose={close}
          />
        </Modal>
      )}
      {modal === "cancel" && selected && (
        <Modal title="Cancel recurring schedule?" onClose={close}>
          <div className="form-stack">
            <p>
              Cancel “{selected.description}”? Already due occurrences are
              processed first. Future payments stop; recorded transactions stay
              unchanged.
            </p>
            {modalError && (
              <p className="error" role="alert">
                {modalError}
              </p>
            )}
            <div className="form-row">
              <button className="secondary" disabled={busy} onClick={close}>
                Keep schedule
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() => void confirmAction()}
              >
                {busy ? "Canceling…" : "Confirm cancellation"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {modal === "reconcile" && selected && (
        <Modal title="Reconcile recurring occurrence" onClose={close}>
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void confirmAction();
            }}
          >
            <p>
              Choose the exact scheduled date. Link a manually recorded payment
              or mark the occurrence handled without creating money. No
              transaction is changed or deleted.
            </p>
            <label>
              Scheduled occurrence date
              <input
                required
                type="date"
                min={selected.startDate}
                max={selected.endDate ?? "9999-12-31"}
                value={occurrenceDate}
                onChange={(e) => setOccurrenceDate(e.target.value)}
              />
            </label>
            <label>
              Existing payment
              <select
                value={transactionId}
                onChange={(e) => {
                  setTransactionId(e.target.value);
                  setConfirmDifference(false);
                }}
              >
                <option value="">Mark handled — no ledger entry</option>
                {transactions
                  .filter((t) => !t.recurringRuleId && t.type === selected.type)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.description} · {money(t.amount)} · {t.date}
                    </option>
                  ))}
              </select>
            </label>
            {selectedPayment && (
              <p className="muted">
                The recorded date, category, and amount stay unchanged. This
                transaction will not be counted twice.
              </p>
            )}
            {mismatch && (
              <label className="checkbox-label">
                <input
                  required
                  type="checkbox"
                  checked={confirmDifference}
                  onChange={(e) => setConfirmDifference(e.target.checked)}
                />
                I confirm the recorded amount {money(selectedPayment.amount)}{" "}
                differs from the schedule’s {money(selected.amount)}.
              </label>
            )}
            {modalError && (
              <p className="error" role="alert">
                {modalError}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? "Saving…" : "Confirm handled occurrence"}
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
