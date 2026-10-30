import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  request,
  type Category,
  type Transaction,
  type TransactionType,
} from "../api";
import { localDate, money } from "../finance";
import { shortDate } from "../recurring";
import {
  calendarCells,
  shiftDate,
  shiftMonth,
  type CalendarMonth,
  type CalendarEntry,
} from "../calendar";
import PlannedTransactions from "./PlannedTransactions";

export default function BillCalendar({
  categories,
  transactions,
  onChanged,
}: {
  categories: Category[];
  transactions: Transaction[];
  onChanged: () => Promise<void>;
}) {
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [selected, setSelected] = useState(localDate());
  const [data, setData] = useState<CalendarMonth>();
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const [manager, setManager] = useState<{
    date?: string;
    type?: TransactionType;
    key: number;
    planId?: string;
  }>();
  const detailRef = useRef<HTMLElement>(null),
    managerRef = useRef<HTMLDivElement>(null),
    focusAfterLoad = useRef<string | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    request<CalendarMonth>(`/calendar?month=${month}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        setSelected((old) =>
          old.startsWith(result.month)
            ? old
            : (result.days.find((d) => d.today)?.date ?? result.days[0].date),
        );
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [month, revision, transactions]);
  useEffect(() => {
    if (data?.month === month && focusAfterLoad.current) {
      document.getElementById(`calendar-${focusAfterLoad.current}`)?.focus();
      focusAfterLoad.current = undefined;
    }
  }, [data, month]);
  useEffect(() => {
    if (manager)
      managerRef.current?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
  }, [manager]);
  const visible = data?.month === month ? data : undefined;
  const day = visible?.days.find((d) => d.date === selected);
  const projection = day?.projection;
  const min = data?.minMonth ?? "1900-01",
    max = data?.maxMonth ?? shiftMonth(localDate().slice(0, 7), 119);
  function navigate(value: string) {
    if (value < min || value > max) return;
    setMonth(value);
    setSelected(value + "-01");
    setError("");
  }
  function keyboard(e: KeyboardEvent<HTMLButtonElement>, date: string) {
    const delta: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -new Date(date + "T12:00:00").getDay(),
      End: 6 - new Date(date + "T12:00:00").getDay(),
    };
    if (!(e.key in delta)) return;
    e.preventDefault();
    const target = shiftDate(date, delta[e.key]);
    if (target.slice(0, 7) < min || target.slice(0, 7) > max) return;
    setSelected(target);
    if (!target.startsWith(month)) {
      focusAfterLoad.current = target;
      setMonth(target.slice(0, 7));
    } else document.getElementById(`calendar-${target}`)?.focus();
  }
  function pick(date: string) {
    setSelected(date);
    detailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function add(type: TransactionType) {
    if (!data || selected <= data.asOfDate) return;
    setManager({ date: selected, type, key: Date.now() });
  }
  async function changed() {
    setRevision((r) => r + 1);
    await onChanged();
  }
  function entryAmount(e: CalendarEntry) {
    return e.amount === null
      ? "Amount unavailable"
      : `${e.type === "INCOME" ? "+" : e.type === "EXPENSE" ? "−" : ""}${money(e.amount)}`;
  }
  return (
    <div className="bill-calendar-workspace">
      <section
        className="panel calendar-toolbar"
        aria-label="Calendar navigation"
      >
        <div className="calendar-navigation">
          <button
            className="secondary"
            aria-label="Previous month"
            disabled={month <= min}
            onClick={() => navigate(shiftMonth(month, -1))}
          >
            ←
          </button>
          <h2>
            {new Date(month + "-01T12:00:00").toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
            })}
          </h2>
          <button
            className="secondary"
            aria-label="Next month"
            disabled={month >= max}
            onClick={() => navigate(shiftMonth(month, 1))}
          >
            →
          </button>
          <button
            className="secondary"
            onClick={() => {
              const today = data?.asOfDate ?? localDate();
              navigate(today.slice(0, 7));
              setSelected(today);
            }}
          >
            Current month
          </button>
        </div>
        <div className="calendar-selectors">
          <label>
            Month
            <select
              aria-label="Calendar month"
              value={month.slice(5)}
              onChange={(e) => navigate(month.slice(0, 5) + e.target.value)}
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i} value={String(i + 1).padStart(2, "0")}>
                  {new Date(2026, i, 1).toLocaleDateString("en-US", {
                    month: "long",
                  })}
                </option>
              ))}
            </select>
          </label>
          <label>
            Year
            <select
              aria-label="Calendar year"
              value={month.slice(0, 4)}
              onChange={(e) => navigate(e.target.value + month.slice(4))}
            >
              {Array.from(
                { length: Number(max.slice(0, 4)) - 1899 },
                (_, i) => (
                  <option key={i} value={1900 + i}>
                    {1900 + i}
                  </option>
                ),
              )}
            </select>
          </label>
        </div>
      </section>
      {loading && (
        <p className="notice" role="status">
          Loading calendar and exact projected balances…
        </p>
      )}
      {error && (
        <div className="error-panel" role="alert">
          <h2>Calendar unavailable</h2>
          <p>{error}</p>
          <button
            className="secondary"
            onClick={() => setRevision((r) => r + 1)}
          >
            Retry calendar
          </button>
        </div>
      )}
      {visible && !error && (
        <>
          <section className="calendar-summary" aria-label="Calendar summary">
            {[
              [
                "Upcoming expenses",
                money(visible.summary.upcomingExpenses),
                "Pending dates in this month",
              ],
              [
                "Expected income",
                money(visible.summary.expectedIncome),
                "Pending dates in this month",
              ],
              [
                "Next upcoming bill",
                visible.summary.nextBill
                  ? money(visible.summary.nextBill.amount!)
                  : "None",
                visible.summary.nextBill
                  ? `${visible.summary.nextBill.description} · ${shortDate(visible.summary.nextBill.scheduledDate!)}`
                  : "No pending expense this month",
              ],
              [
                "Projected month-end balance",
                visible.summary.monthEndBalance === null
                  ? "Unavailable"
                  : money(visible.summary.monthEndBalance),
                "Projection, not actual money",
              ],
              [
                "Lowest projected balance",
                visible.summary.lowestBalance === null
                  ? "Unavailable"
                  : money(visible.summary.lowestBalance),
                visible.summary.lowestDate
                  ? shortDate(visible.summary.lowestDate)
                  : "Historical balances not reconstructed",
              ],
            ].map(([label, value, note]) => (
              <article className="summary-card" key={label}>
                <h2>{label}</h2>
                <div className="metric">{value}</div>
                <p className="muted">{note}</p>
              </article>
            ))}
          </section>
          <p className="notice">
            {month < visible.asOfDate.slice(0, 7)
              ? visible.historicalExplanation
              : `Balances are projected daily closes in ${visible.timeZone}, using the same calculations as Balance Forecast. Current-month totals include only today onward. Low-balance threshold: ${money(visible.lowBalanceThreshold)}.`}
          </p>
          <div className="calendar-legend">
            <span className="positive">● Income</span>
            <span className="negative">● Expense</span>
            <span>Upcoming / overdue = projected</span>
            <span>Completed / reconciled = already recorded</span>
            <span>Canceled / handled = no additional cash</span>
          </div>
          {!visible.days.some((d) => d.entries.length > 0) && (
            <p className="notice">
              No financial activity in this month. Projected balances carry
              forward where available.
            </p>
          )}
          <section
            className="panel calendar-panel"
            aria-label="Monthly bill calendar"
          >
            <p className="calendar-mobile-hint">
              Swipe sideways to view the week. Select a date for full details
              below.
            </p>
            <div className="calendar-month-scroll">
              <div className="calendar-weekdays" aria-hidden="true">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div
                className="calendar-grid"
                role="group"
                aria-label="Calendar dates"
              >
                {calendarCells(visible.days).map((d, i) =>
                  d ? (
                    <button
                      key={d.date}
                      id={`calendar-${d.date}`}
                      className={`calendar-cell ${d.today ? "is-today" : ""} ${d.date === selected ? "is-selected" : ""} ${d.warnings.some((w) => w.severity === "NEGATIVE") ? "balance-negative" : d.warnings.length ? "balance-low" : ""}`}
                      aria-label={`${d.date}${d.today ? ", today" : ""}, ${d.entries.length} activities${d.projection ? `, projected closing ${money(d.projection.endingBalance)}` : ", historical balance unavailable"}${d.warnings.length ? ", low-balance warning" : ""}`}
                      aria-pressed={d.date === selected}
                      aria-current={d.today ? "date" : undefined}
                      tabIndex={d.date === selected ? 0 : -1}
                      onKeyDown={(e) => keyboard(e, d.date)}
                      onClick={() => pick(d.date)}
                    >
                      <span className="calendar-day-number">
                        {Number(d.date.slice(8))}
                        {d.today && <small>Today</small>}
                      </span>
                      <span className="calendar-items">
                        {d.entries.slice(0, 2).map((item) => (
                          <span
                            key={item.id}
                            title={`${item.description} · ${entryAmount(item)} · ${item.status.toLowerCase()} · ${item.source.toLowerCase()}`}
                            className={`calendar-chip ${item.type === "INCOME" ? "income" : "expense"} ${item.status === "CANCELED" ? "canceled" : ""} ${!item.projected ? "settled" : ""}`}
                          >
                            <span>{item.description}</span>
                            <small>
                              {entryAmount(item)} · {item.status.toLowerCase()}
                            </small>
                          </span>
                        ))}
                        {d.entries.length > 2 && (
                          <span className="calendar-more">
                            +{d.entries.length - 2} more
                          </span>
                        )}
                      </span>
                      <span className="calendar-closing">
                        {d.projection ? (
                          <>
                            <small>Projected</small>
                            {money(d.projection.endingBalance)}
                          </>
                        ) : (
                          <small>History only</small>
                        )}
                        {d.warnings.length > 0 && (
                          <span aria-hidden="true"> ⚠</span>
                        )}
                      </span>
                    </button>
                  ) : (
                    <div
                      key={`empty-${i}`}
                      className="calendar-cell outside"
                      aria-hidden="true"
                    />
                  ),
                )}
              </div>
            </div>
          </section>
          {day && (
            <section
              ref={detailRef}
              className="panel calendar-day-details"
              aria-label="Selected day details"
            >
              <div className="panel-heading">
                <div>
                  <h2>{shortDate(day.date)} · day details</h2>
                  <p>
                    {day.today ? "Today · " : ""}
                    {projection
                      ? "Projected balances; completed activity is already in actual balance."
                      : visible.historicalExplanation}
                  </p>
                </div>
                <div className="calendar-day-actions">
                  <button
                    className="primary"
                    disabled={day.date <= visible.asOfDate}
                    onClick={() => add("EXPENSE")}
                  >
                    Add planned expense
                  </button>
                  <button
                    className="secondary"
                    disabled={day.date <= visible.asOfDate}
                    onClick={() => add("INCOME")}
                  >
                    Add planned income
                  </button>
                </div>
              </div>
              {day.date <= visible.asOfDate && (
                <p className="forecast-padding muted">
                  Plans require a future date. Select a later day to add one.
                </p>
              )}
              {projection && (
                <dl className="calendar-day-totals">
                  <div>
                    <dt>Starting projected balance</dt>
                    <dd>{money(projection.startingBalance)}</dd>
                  </div>
                  <div>
                    <dt>Scheduled income</dt>
                    <dd>{money(day.flows!.scheduledIncome)}</dd>
                  </div>
                  <div>
                    <dt>Scheduled expenses</dt>
                    <dd>{money(day.flows!.scheduledExpenses)}</dd>
                  </div>
                  <div>
                    <dt>Planned income</dt>
                    <dd>{money(day.flows!.plannedIncome)}</dd>
                  </div>
                  <div>
                    <dt>Planned expenses</dt>
                    <dd>{money(day.flows!.plannedExpenses)}</dd>
                  </div>
                  <div>
                    <dt>Ending projected balance</dt>
                    <dd>{money(projection.endingBalance)}</dd>
                  </div>
                </dl>
              )}
              {day.warnings.map((w, i) => (
                <p
                  className={`notice ${w.severity === "NEGATIVE" ? "negative" : ""}`}
                  key={i}
                >
                  {w.severity === "NEGATIVE"
                    ? "Below zero"
                    : "Below low-balance threshold"}
                  : {money(w.balance)} ·{" "}
                  {w.kind === "CURRENT"
                    ? "Current actual balance"
                    : w.transactions.map((t) => t.description).join(", ") ||
                      "Balance carried forward"}
                </p>
              ))}
              <h3 className="forecast-padding">
                Scheduled, planned, and completed activity
              </h3>
              {!day.entries.length ? (
                <p className="empty">No activity on this date.</p>
              ) : (
                <ul className="calendar-detail-list">
                  {day.entries.map((item) => (
                    <li key={item.id}>
                      <div>
                        <strong>{item.description}</strong>
                        <p>
                          {item.type?.toLowerCase() ?? "Type unavailable"} ·{" "}
                          {item.category ?? "Category unavailable"} ·{" "}
                          {item.source.toLowerCase()} ·{" "}
                          <span className="category-tag">
                            {item.status.toLowerCase()}
                          </span>
                        </p>
                        <small>
                          {item.note}
                          {item.scheduledDate && item.scheduledDate !== day.date
                            ? ` Original due date: ${item.scheduledDate}.`
                            : ""}
                        </small>
                        <div className="calendar-source-actions">
                          {item.recurringRuleId && (
                            <a href={`#recurring/${item.recurringRuleId}`}>
                              Open recurring schedule
                            </a>
                          )}
                          {item.plannedTransactionId && (
                            <button
                              className="text-button"
                              onClick={() =>
                                setManager({
                                  planId: item.plannedTransactionId!,
                                  key: Date.now(),
                                })
                              }
                            >
                              Manage planned transaction
                            </button>
                          )}
                          {item.transactionId && (
                            <a href="#transactions">
                              View recorded transactions
                            </a>
                          )}
                        </div>
                      </div>
                      <strong
                        className={item.type === "INCOME" ? "positive" : ""}
                      >
                        {entryAmount(item)}
                      </strong>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
      {manager && data && (
        <div ref={managerRef}>
          <PlannedTransactions
            key={manager.key}
            categories={categories}
            transactions={transactions}
            today={data.asOfDate}
            onChanged={changed}
            onlyPlanId={manager.planId}
            createRequest={
              manager.date
                ? { date: manager.date, type: manager.type!, key: manager.key }
                : undefined
            }
          />
        </div>
      )}
    </div>
  );
}
