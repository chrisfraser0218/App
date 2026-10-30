import { useEffect, useState } from "react";
import { request, type Transaction } from "../api";
import { localDate, money } from "../finance";
import { shortDate } from "../recurring";
import {
  INSIGHT_RANGES,
  insightKind,
  type SpendingReport,
  type SpendingInsight,
  type SpendingEvidence,
} from "../insights";
import SpendingCharts from "./SpendingCharts";
import Modal from "./Modal";
export default function SpendingInsights({
  transactions,
}: {
  transactions?: Transaction[];
}) {
  const [range, setRange] = useState("this_month"),
    [from, setFrom] = useState(localDate().slice(0, 7) + "-01"),
    [to, setTo] = useState(localDate()),
    [report, setReport] = useState<SpendingReport>(),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<SpendingInsight>(),
    [evidence, setEvidence] = useState<{
      title: string;
      rows: SpendingEvidence[];
      total: number;
    }>(),
    [detailError, setDetailError] = useState(""),
    [detailLoading, setDetailLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setReport(undefined);
    if (range === "custom" && (!from || !to || from > to)) {
      setError("Choose both dates in chronological order.");
      setLoading(false);
      return;
    }
    const query =
      range === "custom"
        ? `range=custom&from=${from}&to=${to}`
        : `range=${range}`;
    request<SpendingReport>("/insights?" + query, { signal: controller.signal })
      .then((r) => {
        if (!controller.signal.aborted) setReport(r);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [range, from, to, revision, transactions]);
  async function category(id: string, name: string) {
    if (!report) return;
    setDetailLoading(true);
    setDetailError("");
    setEvidence({ title: name + " · recorded expenses", rows: [], total: 0 });
    try {
      const data = await request<{
        transactions: SpendingEvidence[];
        total: number;
      }>(
        `/insights/transactions?from=${report.period.from}&to=${report.period.to}&categoryId=${id}`,
      );
      setEvidence({
        title: name + " · recorded expenses",
        rows: data.transactions,
        total: data.total,
      });
    } catch (e) {
      setDetailError((e as Error).message);
    } finally {
      setDetailLoading(false);
    }
  }
  const p = report?.period,
    s = report?.summary;
  const cards = s
    ? [
        [
          "Recorded expenses",
          money(s.expenses),
          "Selected range · gross expenses",
        ],
        [
          "Recorded income",
          money(s.income),
          "Selected range · includes any refunds recorded as income",
        ],
        ["Net cash flow", money(s.net), "Selected income minus expenses"],
        [
          "Spending this month",
          money(s.currentMonthSpending),
          "Month to date · independent of selected historical filter",
        ],
        [
          "Month-to-date change",
          s.monthToDate.percent === null
            ? "No baseline"
            : `${s.monthToDate.percent}%`,
          `${money(s.monthToDate.current)} versus ${money(s.monthToDate.previous)} through matched calendar days`,
        ],
        [
          "Average monthly spending",
          s.average.amount === null
            ? "Insufficient history"
            : money(s.average.amount),
          "Last 3 complete calendar months · recorded coverage required",
        ],
        [
          "Largest expense category",
          s.largestCategory ?? "None recorded",
          "Selected range",
        ],
        [
          "Recorded recurring expenses",
          money(s.recurringRecorded),
          "Included once in expenses; excludes future plans",
        ],
      ]
    : [];
  function evidenceTable(rows: SpendingEvidence[], count: number) {
    return (
      <>
        <p className="muted">
          Showing {rows.length} of {count} supporting records. Amounts reflect
          the current posted ledger.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="nowrap">{t.date}</td>
                  <td>{t.description}</td>
                  <td>{t.category}</td>
                  <td>{money(t.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }
  return (
    <div className="spending-insights-workspace">
      <section className="panel insights-controls">
        <label>
          Date range
          <select
            aria-label="Insights date range"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            {INSIGHT_RANGES.map(([value, name]) => (
              <option value={value} key={value}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {range === "custom" && (
          <>
            <label>
              Insights start date
              <input
                type="date"
                min="1900-01-01"
                max={report?.period.asOfDate ?? localDate()}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              Insights end date
              <input
                type="date"
                min={from}
                max={report?.period.asOfDate ?? localDate()}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </>
        )}
        <button className="secondary" onClick={() => setRevision((x) => x + 1)}>
          Refresh insights
        </button>
        <p>
          Read-only analysis of recorded activity. No transactions, categories,
          schedules, plans or balances are changed.
        </p>
      </section>
      {loading && (
        <p className="notice" role="status">
          Analyzing recorded spending locally…
        </p>
      )}
      {error && (
        <div className="error-panel" role="alert">
          <h2>Spending insights unavailable</h2>
          <p>{error}</p>
          <button
            className="secondary"
            onClick={() => setRevision((x) => x + 1)}
          >
            Retry insights
          </button>
        </div>
      )}
      {report && s && p && (
        <>
          <p className="notice">
            Selected: {shortDate(p.from)} – {shortDate(p.to)}. Comparison:{" "}
            {shortDate(p.comparisonFrom)} – {shortDate(p.comparisonTo)} (equal
            number of days). As of {shortDate(p.asOfDate)}.
          </p>
          <section className="insights-summary" aria-label="Spending summary">
            {cards.map(([title, value, note]) => (
              <article className="summary-card" key={title}>
                <h2>{title}</h2>
                <div className="insight-metric">{value}</div>
                <p className="muted">{note}</p>
              </article>
            ))}
          </section>
          <p className="forecast-footnote">
            {s.average.explanation}{" "}
            {s.average.months
              .map((m) => `${m.month}: ${money(m.expenses)}`)
              .join(" · ")}
          </p>
          <SpendingCharts report={report} />
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Category evidence</h2>
                <p>
                  Amounts and rounded shares come directly from exact Java
                  calculations. A zero baseline has no percentage change.
                </p>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Expenses</th>
                    <th>Share</th>
                    <th>Previous range</th>
                    <th>Change</th>
                    <th>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {report.categories.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td>{money(c.expenses)}</td>
                      <td>{c.share === null ? "—" : c.share + "%"}</td>
                      <td>{money(c.previous)}</td>
                      <td>
                        {c.percent === null ? "No baseline" : c.percent + "%"}
                      </td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => void category(c.id, c.name)}
                        >
                          View {c.name} transactions
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!report.categories.length && (
                <p className="empty">
                  No category expenses recorded in either period.
                </p>
              )}
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Unusual spending detection</h2>
                <p>
                  {report.detection.methodVersion} · {report.detection.status}
                </p>
              </div>
            </div>
            <div className="forecast-padding">
              <p className="notice">{report.detection.explanation}</p>
              <p>
                {report.detection.eligible} selected expenses had sufficient
                prior history; {report.detection.insufficient} did not.{" "}
                {report.detection.truncated
                  ? "Alert output is capped; narrow the range for details."
                  : ""}
              </p>
              {!report.insights.some((i) => i.id.startsWith("unusual-")) && (
                <p className="muted">
                  {report.detection.status === "available"
                    ? "No selected expenses crossed the configured robust thresholds. This is not proof that every payment was expected."
                    : "Transaction alerts are withheld rather than guessed."}
                </p>
              )}
            </div>
          </section>
          <section
            className="insights-feed"
            aria-label="Evidence-based insights"
          >
            <h2>Insights and review prompts</h2>
            {!report.insights.length ? (
              <div className="panel empty">
                <h3>Not enough recorded evidence yet</h3>
                <p>
                  Add actual transactions through your normal workflow. Insights
                  will appear when there is sufficient recorded activity;
                  analysis never invents data.
                </p>
              </div>
            ) : (
              report.insights.map((i) => (
                <article
                  className={`panel insight-card severity-${i.severity}`}
                  key={i.id}
                >
                  <div>
                    <span className="category-tag">{insightKind(i.kind)}</span>
                    <span className="muted">
                      {" "}
                      · {i.severity} · {i.from} – {i.to}
                    </span>
                  </div>
                  <h3>{i.title}</h3>
                  <p>{i.explanation}</p>
                  <button
                    className="text-button"
                    onClick={() => setSelected(i)}
                  >
                    See supporting calculations
                  </button>
                </article>
              ))
            )}
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Recurring expense analysis</h2>
                <p>
                  Current active definitions and future dates are independent of
                  the historical date filter.
                </p>
              </div>
            </div>
            <div className="insights-recurring-totals">
              <article>
                <h3>Normalized monthly estimate</h3>
                <strong>
                  {money(report.recurring.normalizedMonthlyEstimate)}
                </strong>
                <p>
                  Steady cadence estimate, not an exact bill total. Gregorian
                  average year: 365.2425 days; starts/ends are not prorated.
                </p>
              </article>
              <article>
                <h3>Exact pending this month</h3>
                <strong>{money(report.recurring.pendingThisMonth)}</strong>
                <p>
                  Unposted recurring expenses from today through month-end,
                  using Balance Forecast.
                </p>
              </article>
              <article>
                <h3>Exact pending next 30 days</h3>
                <strong>{money(report.recurring.upcomingTotal)}</strong>
                <p>
                  Through {report.recurring.upcomingThrough}; overdue items
                  retain original due dates.
                </p>
              </article>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Current expense schedule</th>
                    <th>Category</th>
                    <th>Per occurrence</th>
                    <th>Frequency</th>
                    <th>Estimated monthly</th>
                  </tr>
                </thead>
                <tbody>
                  {report.recurring.schedules.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <a className="text-button" href={`#recurring/${r.id}`}>
                          {r.description}
                        </a>
                      </td>
                      <td>{r.category}</td>
                      <td>{money(r.amount)}</td>
                      <td>{r.frequency.replaceAll("_", " ")}</td>
                      <td>{money(r.monthlyEstimate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!report.recurring.schedules.length && (
                <p className="empty">
                  No active future recurring expense schedules.
                </p>
              )}
            </div>
            <div className="forecast-padding">
              <h3>Estimated monthly expenses by category</h3>
              {report.recurring.byCategory.length ? (
                <ul>
                  {report.recurring.byCategory.map((c) => (
                    <li key={c.name}>
                      {c.name}: {money(c.expenses)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No current cadence estimate to group.</p>
              )}
              <h3>Upcoming exact payments</h3>
              {!report.recurring.upcoming.length ? (
                <p className="muted">
                  No pending recurring expenses in the next 30 days.
                </p>
              ) : (
                <ul className="insights-upcoming">
                  {report.recurring.upcoming.map((e) => (
                    <li key={e.id}>
                      <span>
                        {e.scheduledDate} · {e.description}
                        {e.overdue ? " · overdue, projected today" : ""}
                      </span>
                      <strong>{money(e.amount)}</strong>
                    </li>
                  ))}
                </ul>
              )}
              <h3>Recorded payment amount changes</h3>
              {report.recurring.changes.length ? (
                <ul>
                  {report.recurring.changes.map((c) => (
                    <li key={c.ruleId}>
                      {c.date}: {money(c.previous)} → {money(c.current)} (
                      {c.percent}%).{" "}
                      <a
                        className="text-button"
                        href={`#recurring/${c.ruleId}`}
                      >
                        Open schedule
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">
                  No differing consecutive recorded payments in the selected
                  dates. Original schedule versions are not retained; changes
                  are not inferred.
                </p>
              )}
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Monthly recorded totals</h2>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Month / coverage</th>
                    <th>Income</th>
                    <th>Expenses</th>
                    <th>Net cash flow</th>
                    <th>Records</th>
                  </tr>
                </thead>
                <tbody>
                  {report.months.map((m) => (
                    <tr key={m.month}>
                      <td>
                        {m.month}
                        {m.partial ? " · partial" : ""}
                        <small className="recurring-meta">
                          {m.from} – {m.to}
                        </small>
                      </td>
                      <td>{money(m.income)}</td>
                      <td>{money(m.expenses)}</td>
                      <td>{money(m.net)}</td>
                      <td>{m.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel forecast-padding">
            <h2>Analysis limits</h2>
            <ul>
              {report.limitations.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </section>
        </>
      )}
      {selected && report && (
        <Modal title={selected.title} onClose={() => setSelected(undefined)}>
          <div className="form-stack">
            <span className="category-tag">{insightKind(selected.kind)}</span>
            <p>{selected.explanation}</p>
            <dl className="insight-calculations">
              {selected.calculations.map((c) => (
                <div key={c.label}>
                  <dt>{c.label}</dt>
                  <dd>{c.value}</dd>
                </div>
              ))}
            </dl>
            {evidenceTable(
              report.evidence.filter((t) =>
                selected.evidenceIds.includes(t.id),
              ),
              selected.evidenceCount,
            )}
          </div>
        </Modal>
      )}
      {evidence && (
        <Modal title={evidence.title} onClose={() => setEvidence(undefined)}>
          <div className="form-stack">
            {detailLoading ? (
              <p role="status">Loading recorded evidence…</p>
            ) : detailError ? (
              <p className="error" role="alert">
                {detailError}
              </p>
            ) : (
              evidenceTable(evidence.rows, evidence.total)
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
