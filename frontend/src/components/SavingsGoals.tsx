import { useEffect, useState } from "react";
import { request, type Transaction, type RecurringRule } from "../api";
import { money } from "../finance";
import type { SavingsDashboard, SavingsDetail, SavingsEntry } from "../savings";
import Modal from "./Modal";
import SavingsCharts from "./SavingsCharts";
import {
  SavingsGoalForm,
  SavingsEntryForm,
  SavingsScheduleForm,
} from "./SavingsForms";
const EMPTY_TRANSACTIONS: Transaction[] = [];
type Dialog =
  | "CREATE"
  | "EDIT"
  | "CONTRIBUTION"
  | "WITHDRAWAL"
  | "CORRECTION"
  | "SCHEDULE"
  | "ARCHIVE"
  | "RESTORE"
  | "COMPLETE"
  | "REOPEN";
export default function SavingsGoals({
  transactions = EMPTY_TRANSACTIONS,
}: {
  transactions?: Transaction[];
}) {
  const [data, setData] = useState<SavingsDashboard>(),
    [selected, setSelected] = useState<string>(),
    [detail, setDetail] = useState<SavingsDetail>(),
    [loading, setLoading] = useState(true),
    [detailLoading, setDetailLoading] = useState(false),
    [error, setError] = useState(""),
    [detailError, setDetailError] = useState(""),
    [revision, setRevision] = useState(0),
    [dialog, setDialog] = useState<Dialog>(),
    [entry, setEntry] = useState<SavingsEntry>(),
    [busy, setBusy] = useState(false),
    [mutationError, setMutationError] = useState(""),
    [filter, setFilter] = useState("ALL");
  const [links, setLinks] = useState<{
      plans: {
        id: string;
        description: string;
        amount: string;
        type: string;
        status: string;
      }[];
      rules: RecurringRule[];
    }>({ plans: [], rules: [] }),
    [linksError, setLinksError] = useState("");
  useEffect(() => {
    if (dialog) return;
    const c = new AbortController();
    setLoading(true);
    setError("");
    request<SavingsDashboard>("/savings-goals", { signal: c.signal })
      .then((r) => {
        if (!c.signal.aborted) {
          setData(r);
          setSelected((old) =>
            old && r.goals.some((g) => g.id === old) ? old : r.goals[0]?.id,
          );
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError((e as Error).message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [revision, transactions, dialog]);
  useEffect(() => {
    if (dialog) return;
    const c = new AbortController();
    setDetail(undefined);
    setDetailError("");
    if (!selected) return;
    setDetailLoading(true);
    request<SavingsDetail>("/savings-goals/" + selected, { signal: c.signal })
      .then((r) => {
        if (!c.signal.aborted) setDetail(r);
      })
      .catch((e) => {
        if (!c.signal.aborted) setDetailError((e as Error).message);
      })
      .finally(() => {
        if (!c.signal.aborted) setDetailLoading(false);
      });
    return () => c.abort();
  }, [selected, revision, transactions, dialog]);
  useEffect(() => {
    if (dialog !== "SCHEDULE") return;
    const c = new AbortController();
    setLinksError("");
    Promise.all([
      request<typeof links.plans>("/planned-transactions", {
        signal: c.signal,
      }),
      request<RecurringRule[]>("/recurring-transactions", { signal: c.signal }),
    ])
      .then(([plans, rules]) => {
        if (!c.signal.aborted)
          setLinks({
            plans: plans.filter((p) => p.status === "PLANNED"),
            rules,
          });
      })
      .catch(() => {
        if (!c.signal.aborted)
          setLinksError(
            "Cash-flow links could not load. Allocation-only plans remain available.",
          );
      });
    return () => c.abort();
  }, [dialog]);
  function close() {
    if (!busy) {
      setDialog(undefined);
      setMutationError("");
      setEntry(undefined);
    }
  }
  async function save(path: string, body: unknown, method = "POST") {
    setBusy(true);
    try {
      const d = await request<SavingsDetail>(path, {
        method,
        body: JSON.stringify(body),
      });
      setDetail(d);
      setSelected(d.goal.id);
      setDialog(undefined);
      setEntry(undefined);
      setRevision((v) => v + 1);
    } finally {
      setBusy(false);
    }
  }
  async function changeState() {
    if (!detail || !dialog) return;
    setMutationError("");
    try {
      await save("/savings-goals/" + detail.goal.id + "/state", {
        action: dialog,
        version: detail.goal.version,
      });
    } catch (e) {
      setMutationError((e as Error).message);
    }
  }
  function open(d: Dialog) {
    setDialog(d);
    setMutationError("");
  }
  const summary = data?.summary,
    g = detail?.goal,
    projection = detail?.projection;
  return (
    <section className="savings-workspace" aria-label="Savings Goals workspace">
      <div className="panel savings-intro">
        <div>
          <h2>A purpose for your money</h2>
          <p>
            Goals reserve allocations, not cash movements. Planned allocations
            are intentions; bank transactions and cash-flow plans remain
            separate.
          </p>
        </div>
        <button
          className="primary"
          onClick={() => open("CREATE")}
          disabled={loading}
        >
          Create goal
        </button>
      </div>
      {error ? (
        <div className="error-panel" role="alert">
          <p>{error}</p>
          <button
            className="secondary"
            onClick={() => setRevision((v) => v + 1)}
          >
            Retry savings
          </button>
        </div>
      ) : loading && !data ? (
        <p role="status">Loading savings goals…</p>
      ) : (
        summary && (
          <>
            <div className="savings-summary" aria-label="Savings summary">
              {[
                ["Actual account balance", money(summary.actualBalance)],
                ["Reserved in this account", money(summary.allocatedInAccount)],
                ["Tracked outside account", money(summary.trackedExternal)],
                ["Unallocated balance", money(summary.unallocatedBalance)],
                ["Total target amount", money(summary.totalTarget)],
                ["Total saved toward goals", money(summary.totalSaved)],
                ["Overall progress", summary.overallProgress + "%"],
                [
                  "Goals / completed",
                  `${summary.totalGoals} / ${summary.completedGoals}`,
                ],
              ].map(([label, value]) => (
                <article className="summary-card" key={label}>
                  <h2>{label}</h2>
                  <strong className="insight-metric">{value}</strong>
                </article>
              ))}
            </div>
            <p className="muted">
              {summary.activeGoals} active · {summary.archivedGoals} archived ·{" "}
              {summary.approachingGoals} approaching a target in the next 30
              days. Totals include archived and completed allocations; archiving
              never silently frees reserved money.
            </p>
            {Number(summary.unallocatedBalance) < 0 && (
              <p className="notice">
                Allocations exceed the recorded account balance. They are
                bookkeeping intentions, not verified bank-backed funds; review
                your reservations.
              </p>
            )}
            <div className="savings-toolbar">
              <label>
                Show goals
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="ALL">All goals</option>
                  <option value="ACTIVE">Active</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
              </label>
              <button
                className="secondary"
                onClick={() => setRevision((v) => v + 1)}
              >
                Refresh savings
              </button>
            </div>
            {!data?.goals.length ? (
              <div className="panel empty">
                <h2>Your first goal starts here</h2>
                <p>
                  Create a goal, then explicitly allocate money. Your bank
                  balance stays unchanged.
                </p>
              </div>
            ) : (
              <div className="savings-goal-grid">
                {data.goals
                  .filter((goal) => filter === "ALL" || goal.status === filter)
                  .map((goal) => (
                    <article
                      className={
                        "panel savings-goal-card " +
                        (goal.id === selected ? "selected" : "")
                      }
                      key={goal.id}
                    >
                      <div className="savings-card-head">
                        <h2>{goal.name}</h2>
                        <span className="demo-pill savings-status">
                          {goal.status}
                        </span>
                      </div>
                      <p>
                        {goal.description || "A goal for your next chapter."}
                      </p>
                      <strong>
                        {money(goal.saved)}{" "}
                        <small className="muted">
                          of {money(goal.targetAmount)}
                        </small>
                      </strong>
                      <div
                        className="savings-progress"
                        role="progressbar"
                        aria-label={goal.name + " progress"}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.min(100, Number(goal.progress))}
                        aria-valuetext={goal.progress + "% allocated"}
                      >
                        <span
                          style={{
                            width: Math.min(100, Number(goal.progress)) + "%",
                          }}
                        />
                      </div>
                      <p>
                        {goal.progress}% · {money(goal.remaining)} remaining
                      </p>
                      <p className="muted">
                        Target: {goal.targetDate ?? "No target date"}
                        {goal.targetDate &&
                        goal.targetDate < summary.asOfDate &&
                        Number(goal.remaining) > 0
                          ? " · overdue"
                          : ""}
                      </p>
                      <p className="muted">
                        Estimate:{" "}
                        {detail?.goal.id === goal.id
                          ? (detail.projection.estimatedCompletionDate ??
                            "Insufficient data / no completion in horizon")
                          : "Open details for estimate"}
                      </p>
                      <button
                        className="secondary"
                        onClick={() => setSelected(goal.id)}
                        aria-label={"View " + goal.name}
                      >
                        View goal & progress
                      </button>
                    </article>
                  ))}
              </div>
            )}
            {detailLoading && (
              <p role="status">Loading goal details and projections…</p>
            )}
            {detailError && (
              <div className="error-panel" role="alert">
                <p>{detailError}</p>
                <button
                  className="secondary"
                  onClick={() => setRevision((v) => v + 1)}
                >
                  Retry goal details
                </button>
              </div>
            )}
            {detail && g && projection && (
              <section
                className="savings-detail"
                aria-label={g.name + " details"}
              >
                <article className="panel savings-detail-head">
                  <div>
                    <h2>{g.name}</h2>
                    <p>
                      Created {g.createdAt.slice(0, 10)} · {g.status} · as of{" "}
                      {projection.asOfDate}
                    </p>
                  </div>
                  <div className="savings-actions">
                    {g.archived ? (
                      <button
                        className="secondary"
                        onClick={() => open("RESTORE")}
                      >
                        Restore goal
                      </button>
                    ) : (
                      <>
                        <button
                          className="secondary"
                          onClick={() => open("EDIT")}
                        >
                          Edit goal
                        </button>
                        {g.completed ? (
                          <button
                            className="secondary"
                            onClick={() => open("REOPEN")}
                          >
                            Reopen goal
                          </button>
                        ) : (
                          <>
                            <button
                              className="primary"
                              onClick={() => open("CONTRIBUTION")}
                            >
                              Add contribution
                            </button>
                            <button
                              className="secondary"
                              onClick={() => open("WITHDRAWAL")}
                            >
                              Record withdrawal
                            </button>
                            <button
                              className="secondary"
                              onClick={() => open("SCHEDULE")}
                            >
                              Plan contributions
                            </button>
                            <button
                              className="secondary"
                              disabled={Number(g.remaining) > 0}
                              onClick={() => open("COMPLETE")}
                            >
                              Mark completed
                            </button>
                          </>
                        )}
                        <button
                          className="secondary"
                          onClick={() => open("ARCHIVE")}
                        >
                          Archive goal
                        </button>
                      </>
                    )}
                  </div>
                </article>
                <article className="panel savings-projection">
                  <h3>Allocation outlook</h3>
                  <div className="savings-summary">
                    {[
                      [
                        "Estimated completion",
                        projection.estimatedCompletionDate ?? "Not supported",
                      ],
                      [
                        "Expected saved by target",
                        projection.expectedByTarget === null
                          ? "No supported target estimate"
                          : money(projection.expectedByTarget),
                      ],
                      [
                        "Required per month",
                        projection.requiredMonthly === null
                          ? "Choose a future target date"
                          : money(projection.requiredMonthly),
                      ],
                      [
                        "Required per planned occurrence",
                        projection.requiredPerOccurrence === null
                          ? "No pending target-date occurrences"
                          : money(projection.requiredPerOccurrence),
                      ],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <p className="muted">{label}</p>
                        <strong>{value}</strong>
                      </div>
                    ))}
                  </div>
                  <p className="notice">
                    Separate bank projection on {projection.bankForecastDate}:{" "}
                    {money(projection.bankProjectedBalance)}. Savings
                    allocations do not automatically subtract from this
                    projection.
                  </p>
                  {detail.schedule && (
                    <p className="muted">
                      Current allocation plan: {money(detail.schedule.amount)} ·{" "}
                      {detail.schedule.linkType === "NONE"
                        ? detail.schedule.frequency
                        : "dates from linked " +
                          detail.schedule.linkType.toLowerCase() +
                          " cash flow"}{" "}
                      · {detail.schedule.enabled ? "enabled" : "paused"} ·{" "}
                      {detail.schedule.bucket === "IN_ACCOUNT"
                        ? "in account"
                        : "outside account"}
                      .
                    </p>
                  )}
                  <details>
                    <summary>Forecast assumptions and recommendations</summary>
                    <ul>
                      {projection.observations.map((note, i) => (
                        <li key={i}>{note}</li>
                      ))}
                    </ul>
                  </details>
                </article>
                <SavingsCharts detail={detail} />
                <article className="panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Contribution and withdrawal history</h3>
                      <p>
                        Corrected originals stay visible. Only active entries
                        count toward progress. {detail.entries.length} retained
                        entries.
                      </p>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Entry / location</th>
                          <th>Note / audit</th>
                          <th>Amount</th>
                          <th>Payment reference</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...detail.entries]
                          .reverse()
                          .slice(0, 200)
                          .map((e) => (
                            <tr key={e.id}>
                              <td>{e.date}</td>
                              <td>
                                {e.type} ·{" "}
                                {e.bucket === "IN_ACCOUNT"
                                  ? "in account"
                                  : "outside account"}
                              </td>
                              <td>
                                {e.note || "—"}
                                {!e.active && (
                                  <small>
                                    {" "}
                                    · corrected: {e.correctionReason}
                                  </small>
                                )}
                                {e.replacesId && (
                                  <small> · replacement entry</small>
                                )}
                              </td>
                              <td>{money(e.amount)}</td>
                              <td>
                                {e.transactionId
                                  ? e.transactionMissing
                                    ? "Original payment removed"
                                    : e.transactionChanged
                                      ? "Payment changed — review link"
                                      : "Linked existing payment"
                                  : "Allocation only"}
                              </td>
                              <td>
                                {e.active && !g.archived && !g.completed && (
                                  <button
                                    className="text-button"
                                    onClick={() => {
                                      setEntry(e);
                                      open("CORRECTION");
                                    }}
                                    aria-label={
                                      "Correct " +
                                      e.type.toLowerCase() +
                                      " " +
                                      e.amount +
                                      " on " +
                                      e.date
                                    }
                                  >
                                    Correct
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        {!detail.entries.length && (
                          <tr>
                            <td colSpan={6} className="empty">
                              No recorded allocations yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {detail.entries.length > 200 && (
                    <p className="muted">
                      Latest 200 shown. All retained entries contribute to the
                      exact totals and backup/export.
                    </p>
                  )}
                </article>
              </section>
            )}
          </>
        )
      )}
      {dialog === "CREATE" && (
        <Modal title="Create savings goal" onClose={close}>
          <SavingsGoalForm
            onClose={close}
            onSave={(body) => save("/savings-goals", body)}
          />
        </Modal>
      )}
      {detail && dialog === "EDIT" && (
        <Modal title="Edit savings goal" onClose={close}>
          <SavingsGoalForm
            goal={detail.goal}
            onClose={close}
            onSave={(body) =>
              save("/savings-goals/" + detail.goal.id, body, "PUT")
            }
          />
        </Modal>
      )}
      {detail &&
        dialog &&
        ["CONTRIBUTION", "WITHDRAWAL", "CORRECTION"].includes(dialog) && (
          <Modal
            title={
              dialog === "CORRECTION"
                ? "Correct allocation entry"
                : dialog === "WITHDRAWAL"
                  ? "Withdraw savings allocation"
                  : "Add savings contribution"
            }
            onClose={close}
          >
            <SavingsEntryForm
              detail={detail}
              mode={dialog as "CONTRIBUTION" | "WITHDRAWAL" | "CORRECTION"}
              existing={entry}
              transactions={transactions}
              onClose={close}
              onSave={(body) =>
                save(
                  "/savings-goals/" +
                    detail.goal.id +
                    "/entries" +
                    (dialog === "CORRECTION"
                      ? "/" + entry?.id + "/correct"
                      : ""),
                  body,
                )
              }
            />
          </Modal>
        )}
      {detail && dialog === "SCHEDULE" && (
        <Modal title="Plan savings allocations" onClose={close}>
          {linksError && (
            <p className="error" role="alert">
              {linksError}
            </p>
          )}
          <SavingsScheduleForm
            detail={detail}
            plans={links.plans}
            rules={links.rules}
            onClose={close}
            onSave={(body) =>
              save(
                "/savings-goals/" + detail.goal.id + "/schedule",
                body,
                "PUT",
              )
            }
          />
        </Modal>
      )}
      {detail &&
        dialog &&
        ["ARCHIVE", "RESTORE", "COMPLETE", "REOPEN"].includes(dialog) && (
          <Modal
            title={dialog[0] + dialog.slice(1).toLowerCase() + " savings goal?"}
            onClose={close}
          >
            <div className="form-stack">
              <p>
                {dialog === "ARCHIVE"
                  ? "Archiving preserves all history and reserved allocations. It does not free money, delete entries or change your bank balance."
                  : dialog === "COMPLETE"
                    ? "The saved amount meets the target. Completion is a tracking status; no money moves. Reopen before recording later withdrawals."
                    : "This changes the tracking state only. Contributions and bank records stay unchanged."}
              </p>
              {mutationError && (
                <p className="error" role="alert">
                  {mutationError}
                </p>
              )}
              <div className="form-row">
                <button className="secondary" onClick={close} disabled={busy}>
                  Cancel
                </button>
                <button
                  className="primary"
                  onClick={() => void changeState()}
                  disabled={busy}
                >
                  {busy ? "Saving…" : "Confirm " + dialog.toLowerCase()}
                </button>
              </div>
            </div>
          </Modal>
        )}
    </section>
  );
}
