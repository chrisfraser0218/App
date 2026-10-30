import { useEffect, useState } from "react";
import {
  request,
  type Category,
  type Transaction,
  type TransactionType,
} from "../api";
import { money, validMoney } from "../finance";
import { shortDate } from "../recurring";
import {
  addMonthsClamped,
  hypotheticalError,
  nextDate,
  type ForecastComparison,
  type ForecastPreferences,
  type ForecastResult,
  type Hypothetical,
} from "../forecast";
import ForecastChart from "./ForecastChart";
import PlannedTransactions from "./PlannedTransactions";

export default function BalanceForecast({
  categories,
  transactions,
  onChanged,
}: {
  categories: Category[];
  transactions: Transaction[];
  onChanged: () => Promise<void>;
}) {
  const [preferences, setPreferences] = useState<ForecastPreferences>();
  const [range, setRange] = useState("1");
  const [custom, setCustom] = useState("");
  const [threshold, setThreshold] = useState("");
  const [prefError, setPrefError] = useState("");
  const [comparison, setComparison] = useState<ForecastComparison>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(0);
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [hypotheses, setHypotheses] = useState<Hypothetical[]>([]);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<TransactionType>("EXPENSE");
  const [date, setDate] = useState("");
  const [hypError, setHypError] = useState("");
  const [selectedMonth, setMonth] = useState("");
  const [selectedDate, setDay] = useState("");
  const [allWarnings, setAllWarnings] = useState(false);
  async function loadPreferences() {
    try {
      const p = await request<ForecastPreferences>("/forecast-preferences");
      setPreferences(p);
      setThreshold(p.lowBalanceThreshold);
      setDate(nextDate(p.asOfDate));
      setCustom(addMonthsClamped(p.asOfDate, 1));
      setError("");
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  }
  useEffect(() => {
    void loadPreferences();
  }, []);
  const end = preferences
    ? range === "custom"
      ? custom
      : addMonthsClamped(preferences.asOfDate, Number(range))
    : "";
  useEffect(() => {
    if (!preferences || !end) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setComparison(undefined);
    if (end <= preferences.asOfDate || end > preferences.maxDate) {
      setError("Choose a future date within the supported forecast range.");
      setLoading(false);
      return;
    }
    if (
      hypotheses.some((h) => h.date > end || h.date <= preferences.asOfDate)
    ) {
      setError(
        "Remove or move hypothetical transactions outside the selected range.",
      );
      setLoading(false);
      return;
    }
    const load = async () => {
      try {
        let result: ForecastComparison;
        if (hypotheses.length)
          result = await request<ForecastComparison>("/forecasts/scenarios", {
            method: "POST",
            body: JSON.stringify({ endDate: end, transactions: hypotheses }),
            signal: controller.signal,
          });
        else {
          const baseline = await request<ForecastResult>(
            `/forecasts?endDate=${end}`,
            { signal: controller.signal },
          );
          result = {
            baseline,
            scenario: baseline,
            projectedDifference: "0.00",
          };
        }
        if (!controller.signal.aborted) {
          setComparison(result);
          setMonth((old) =>
            result.scenario.months.some((m) => m.month === old)
              ? old
              : result.scenario.months[0].month,
          );
          setDay("");
        }
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [end, preferences, hypotheses, token, transactions]);
  async function changed() {
    setToken((x) => x + 1);
    await onChanged();
  }
  async function saveThreshold() {
    if (!preferences) return;
    if (!validMoney(threshold, true) || Number(threshold) < 0) {
      setPrefError("Enter a nonnegative threshold with at most two decimals.");
      return;
    }
    setSavingThreshold(true);
    setPrefError("");
    try {
      const p = await request<ForecastPreferences>("/forecast-preferences", {
        method: "PUT",
        body: JSON.stringify({
          lowBalanceThreshold: threshold,
          version: preferences.version,
        }),
      });
      setPreferences(p);
      setThreshold(p.lowBalanceThreshold);
    } catch (e) {
      setPrefError((e as Error).message);
    } finally {
      setSavingThreshold(false);
    }
  }
  function addHypothesis() {
    if (!preferences) return;
    const v = { description, amount, type, date };
    const validation = hypotheticalError(v, preferences.asOfDate, end);
    if (validation) {
      setHypError(validation);
      return;
    }
    if (hypotheses.length >= 100) {
      setHypError("Use at most 100 hypothetical transactions.");
      return;
    }
    setHypotheses((old) => [
      ...old,
      { ...v, description: description.trim(), id: crypto.randomUUID() },
    ]);
    setDescription("");
    setAmount("");
    setHypError("");
  }
  const result = comparison?.scenario;
  const summary = result?.summary;
  const monthDays =
    result?.days.filter((d) => d.date.startsWith(selectedMonth)) ?? [];
  const day = result?.days.find((d) => d.date === selectedDate);
  const baselineMonths = new Map(
    comparison?.baseline.months.map((m) => [m.month, m]),
  );
  const cards = summary
    ? [
        [
          "Current Actual Balance",
          summary.currentActualBalance,
          "Posted ledger only",
        ],
        [
          "Projected Balance at Selected Date",
          summary.projectedBalance,
          `${hypotheses.length ? "Hypothetical" : "Baseline"} · ${shortDate(summary.endDate)}`,
        ],
        [
          "Total Future Income",
          summary.totalIncome,
          "Scheduled + planned + optional scenario",
        ],
        [
          "Total Future Expenses",
          summary.totalExpenses,
          "Projected; not automatically recorded",
        ],
        [
          "Lowest Projected Balance",
          summary.lowestBalance,
          shortDate(summary.lowestDate),
        ],
        [
          "Net Projected Change",
          summary.netChange,
          "From current actual balance",
        ],
      ]
    : [];
  return (
    <div className="forecast-workspace">
      <section className="panel forecast-controls">
        <div>
          <label>
            Forecast range
            <select
              aria-label="Forecast range"
              value={range}
              onChange={(e) => setRange(e.target.value)}
            >
              {[1, 3, 5, 6, 12].map((n) => (
                <option key={n} value={String(n)}>
                  {n} {n === 1 ? "month" : "months"}
                </option>
              ))}
              <option value="custom">Custom future date</option>
            </select>
          </label>
          {range === "custom" && preferences && (
            <label>
              Forecast end date
              <input
                type="date"
                required
                min={nextDate(preferences.asOfDate)}
                max={preferences.maxDate}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
            </label>
          )}
        </div>
        <div>
          <label>
            Low-balance threshold (USD)
            <input
              inputMode="decimal"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </label>
          <button
            className="secondary"
            disabled={!preferences || savingThreshold}
            onClick={() => void saveThreshold()}
          >
            {savingThreshold ? "Saving…" : "Save threshold"}
          </button>
        </div>
        {preferences && (
          <p className="forecast-footnote">
            As of {shortDate(preferences.asOfDate)} · {preferences.timeZone}.
            Exact dates and decimals; projections are not actual money. Custom
            range up to 3,660 days.
          </p>
        )}
        {prefError && (
          <p className="error" role="alert">
            {prefError}
          </p>
        )}
      </section>
      {error && (
        <div className="error-panel" role="alert">
          <h2>Forecast unavailable</h2>
          <p>{error}</p>
          <button
            className="secondary"
            onClick={() =>
              preferences ? setToken((x) => x + 1) : void loadPreferences()
            }
          >
            Retry forecast
          </button>
        </div>
      )}
      {loading && (
        <p className="notice" role="status">
          Calculating your deterministic projection…
        </p>
      )}
      {result && summary && comparison && (
        <>
          <section className="forecast-summary" aria-label="Forecast summary">
            {cards.map(([label, value, note]) => (
              <article className="summary-card" key={label}>
                <h2>{label}</h2>
                <div
                  className={`metric ${Number(value) < 0 ? "negative" : ""}`}
                >
                  {money(value)}
                </div>
                <p className="muted">{note}</p>
              </article>
            ))}
          </section>
          {(summary.overdueOccurrences > 0 || summary.overduePlans > 0) && (
            <p className="notice">
              This projection includes {summary.overdueOccurrences} unposted
              overdue recurring occurrences and {summary.overduePlans} overdue
              plans on today’s projected flow. Original due dates remain in
              details. Generating this view posts nothing; planned payments
              always need explicit completion.
            </p>
          )}
          {hypotheses.length > 0 && (
            <p className="notice">
              Unsaved what-if comparison: baseline{" "}
              {money(comparison.baseline.summary.projectedBalance)} →
              hypothetical {money(summary.projectedBalance)} · difference{" "}
              {money(comparison.projectedDifference)}. Neither actual records
              nor plans were changed.
            </p>
          )}
          <ForecastChart
            comparison={comparison}
            hasScenario={hypotheses.length > 0}
          />
          <section className="panel forecast-warnings">
            <div className="panel-heading">
              <div>
                <h2>Low-balance warnings</h2>
                <p>
                  Based on current actual or projected daily closing balances,
                  not intraday timing or AI speculation.
                </p>
              </div>
            </div>
            {!result.warnings.length ? (
              <p className="forecast-padding muted">
                No balances below your threshold in this projection.
              </p>
            ) : (
              <>
                <ul>
                  {(allWarnings
                    ? result.warnings
                    : result.warnings.slice(0, 10)
                  ).map((w, i) => (
                    <li key={`${w.kind}-${w.date}-${i}`}>
                      <button
                        className="text-button"
                        onClick={() => {
                          setMonth(w.date.slice(0, 7));
                          setDay(w.date);
                        }}
                      >
                        {shortDate(w.date)}
                      </button>
                      <strong
                        className={w.severity === "NEGATIVE" ? "negative" : ""}
                      >
                        {money(w.balance)} ·{" "}
                        {w.severity === "NEGATIVE"
                          ? "below zero"
                          : "below threshold"}
                      </strong>
                      <span>
                        {w.kind === "CURRENT"
                          ? "Current actual balance"
                          : w.transactions
                              .map((t) => t.description)
                              .join(", ") || "Balance carried forward"}
                      </span>
                    </li>
                  ))}
                </ul>
                {result.warnings.length > 10 && (
                  <button
                    className="text-button forecast-padding"
                    onClick={() => setAllWarnings(!allWarnings)}
                  >
                    {allWarnings
                      ? "Show fewer warnings"
                      : `Show all ${result.warnings.length} warnings`}
                  </button>
                )}
              </>
            )}
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Month-by-month forecast</h2>
                <p>
                  {hypotheses.length
                    ? "Hypothetical projection"
                    : "Baseline projection"}
                  . First and last months may be partial periods.
                </p>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Month / covered dates</th>
                    <th>Starting balance</th>
                    <th>Expected income</th>
                    <th>Expected expenses</th>
                    <th>Net cash flow</th>
                    <th>Projected ending</th>
                    {hypotheses.length > 0 && <th>Baseline ending</th>}
                  </tr>
                </thead>
                <tbody>
                  {result.months.map((m) => (
                    <tr key={m.month}>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => {
                            setMonth(m.month);
                            setDay("");
                          }}
                        >
                          {m.month}
                        </button>
                        <small className="recurring-meta">
                          {m.periodStart} – {m.periodEnd}
                        </small>
                      </td>
                      <td>{money(m.startingBalance)}</td>
                      <td className="positive">{money(m.income)}</td>
                      <td>{money(m.expenses)}</td>
                      <td>{money(m.netChange)}</td>
                      <td
                        className={
                          Number(m.endingBalance) < 0 ? "negative" : ""
                        }
                      >
                        {money(m.endingBalance)}
                      </td>
                      {hypotheses.length > 0 && (
                        <td>
                          {money(baselineMonths.get(m.month)!.endingBalance)}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Daily forecast details</h2>
                <p>
                  Select a day to inspect the exact transactions affecting it.
                </p>
              </div>
              <label className="compact-control">
                Detail month
                <select
                  aria-label="Detail month"
                  value={selectedMonth}
                  onChange={(e) => {
                    setMonth(e.target.value);
                    setDay("");
                  }}
                >
                  {result.months.map((m) => (
                    <option key={m.month} value={m.month}>
                      {m.month}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="table-scroll forecast-daily-table">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Starting</th>
                    <th>Income</th>
                    <th>Expenses</th>
                    <th>Projected closing</th>
                    <th>Items</th>
                  </tr>
                </thead>
                <tbody>
                  {monthDays.map((d) => (
                    <tr key={d.date}>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => setDay(d.date)}
                        >
                          {d.date}
                        </button>
                      </td>
                      <td>{money(d.startingBalance)}</td>
                      <td className="positive">{money(d.income)}</td>
                      <td>{money(d.expenses)}</td>
                      <td
                        className={
                          Number(d.endingBalance) < 0 ? "negative" : ""
                        }
                      >
                        {money(d.endingBalance)}
                      </td>
                      <td>{d.transactions.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {day && (
              <div className="forecast-day-detail">
                <h3>Transactions affecting {shortDate(day.date)}</h3>
                {!day.transactions.length ? (
                  <p className="muted">
                    No projected changes; the previous balance carries forward.
                  </p>
                ) : (
                  <ul>
                    {day.transactions.map((t) => (
                      <li key={`${t.source}-${t.id}`}>
                        <span>
                          <strong>{t.description}</strong>
                          <small>
                            {t.source.toLowerCase()}{" "}
                            {t.category ? `· ${t.category}` : ""}
                            {t.overdue
                              ? ` · overdue from ${t.scheduledDate}`
                              : ""}
                          </small>
                        </span>
                        <strong
                          className={t.type === "INCOME" ? "positive" : ""}
                        >
                          {t.type === "INCOME" ? "+" : "−"}
                          {money(t.amount)}
                        </strong>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        </>
      )}
      {preferences && (
        <>
          <section className="panel what-if-panel">
            <div className="panel-heading">
              <div>
                <h2>What-if scenarios</h2>
                <p>
                  Hypothetical transactions stay in this page’s memory. They are
                  not plans or actual payments.
                </p>
              </div>
            </div>
            <form
              className="what-if-form"
              onSubmit={(e) => {
                e.preventDefault();
                addHypothesis();
              }}
            >
              <label>
                Hypothetical description
                <input
                  required
                  maxLength={160}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <label>
                Hypothetical type
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as TransactionType)}
                >
                  <option value="EXPENSE">Expense</option>
                  <option value="INCOME">Income</option>
                </select>
              </label>
              <label>
                Hypothetical amount (USD)
                <input
                  required
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <label>
                Hypothetical date
                <input
                  required
                  type="date"
                  min={nextDate(preferences.asOfDate)}
                  max={end}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <button className="primary">Add hypothetical transaction</button>
            </form>
            {hypError && (
              <p className="error forecast-padding" role="alert">
                {hypError}
              </p>
            )}
            {hypotheses.length > 0 && (
              <ul className="hypothesis-list">
                {hypotheses.map((h) => (
                  <li key={h.id}>
                    <span>
                      {h.description} · {h.type === "INCOME" ? "+" : "−"}
                      {money(h.amount)} · {h.date}
                    </span>
                    <button
                      className="text-button danger-text"
                      aria-label={`Remove hypothetical ${h.description}`}
                      onClick={() =>
                        setHypotheses((old) => old.filter((x) => x.id !== h.id))
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    className="text-button"
                    onClick={() => setHypotheses([])}
                  >
                    Clear all hypothetical transactions
                  </button>
                </li>
              </ul>
            )}
          </section>
          <PlannedTransactions
            categories={categories}
            transactions={transactions}
            today={preferences.asOfDate}
            onChanged={changed}
          />
        </>
      )}
    </div>
  );
}
