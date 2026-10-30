import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  request,
  type Account,
  type Category,
  type Summary,
  type Transaction,
  type TransactionInput,
} from "./api";
import { localDate, money, validMoney } from "./finance";

import SpendingInsights from "./components/SpendingInsights";
import BackupRecovery from "./components/BackupRecovery";
import BillCalendar from "./components/BillCalendar";
import BalanceForecast from "./components/BalanceForecast";
import RecurringTransactions from "./components/RecurringTransactions";
import Icon from "./components/Icon";
import Modal from "./components/Modal";
import TransactionForm from "./components/TransactionForm";
import TransactionTable from "./components/TransactionTable";
import SummaryCards from "./components/SummaryCards";
import DashboardCharts from "./components/DashboardCharts";

export default function App() {
  const [page, setPage] = useState(
    location.hash === "#insights"
      ? "insights"
      : location.hash === "#settings"
        ? "settings"
        : location.hash === "#calendar"
          ? "calendar"
          : location.hash === "#forecast"
            ? "forecast"
            : location.hash.startsWith("#recurring")
              ? "recurring"
              : location.hash === "#transactions"
                ? "transactions"
                : "dashboard",
  );
  const [focusedRule, setFocusedRule] = useState(location.hash.split("/")[1]);
  const [dark, setDark] = useState(
    () => localStorage.getItem("finsight-theme") === "dark",
  );
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [data, setData] = useState<{
    account: Account;
    categories: Category[];
    transactions: Transaction[];
    summary: Summary;
  }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<
    "transaction" | "balance" | "delete" | null
  >(null);
  const [selected, setSelected] = useState<Transaction>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [balance, setBalance] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("finsight-theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    const handle = () => {
      setFocusedRule(location.hash.split("/")[1]);
      setPage(
        location.hash === "#insights"
          ? "insights"
          : location.hash === "#settings"
            ? "settings"
            : location.hash === "#calendar"
              ? "calendar"
              : location.hash === "#forecast"
                ? "forecast"
                : location.hash.startsWith("#recurring")
                  ? "recurring"
                  : location.hash === "#transactions"
                    ? "transactions"
                    : "dashboard",
      );
    };
    window.addEventListener("hashchange", handle);
    return () => window.removeEventListener("hashchange", handle);
  }, []);
  async function load(background = false) {
    const current = ++generation.current;
    if (!background) setLoading(true);
    setError("");
    try {
      const [account, categories, transactions, summary] = await Promise.all([
        request<Account>("/account"),
        request<Category[]>("/categories"),
        request<Transaction[]>("/transactions"),
        request<Summary>(`/summaries/monthly?month=${month}`),
      ]);
      if (current === generation.current)
        setData({ account, categories, transactions, summary });
    } catch (e) {
      if (current === generation.current) setError((e as Error).message);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [month]); // Refresh the complete snapshot when the month changes.
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 5000);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  useEffect(() => {
    const refresh = async () => {
      if (document.visibilityState !== "visible" || page === "settings") return;
      try {
        if (
          page !== "forecast" &&
          page !== "calendar" &&
          page !== "settings" &&
          page !== "insights"
        )
          await request("/recurring-transactions/process-due", {
            method: "POST",
          });
      } catch {
        /* Manual entry remains usable during a scheduling outage. */
      }
      await load(true);
    };
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 30000);
    window.addEventListener("online", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", refresh);
    };
  }, [month, page]);
  function close() {
    if (!busy) {
      setModal(null);
      setSelected(undefined);
      setMutationError("");
    }
  }
  function openTransaction(transaction?: Transaction) {
    setSelected(transaction);
    setModal("transaction");
  }
  async function saveTransaction(input: TransactionInput) {
    setBusy(true);
    try {
      await request(
        selected ? `/transactions/${selected.id}` : "/transactions",
        { method: selected ? "PUT" : "POST", body: JSON.stringify(input) },
      );
      setNotice(selected ? "Transaction updated." : "Transaction added.");
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function saveBalance(e: FormEvent) {
    e.preventDefault();
    if (!validMoney(balance, true)) {
      setMutationError(
        "Enter a valid balance with at most two decimal places.",
      );
      return;
    }
    setBusy(true);
    setMutationError("");
    try {
      await request("/account/starting-balance", {
        method: "PUT",
        body: JSON.stringify({ startingBalance: balance }),
      });
      setModal(null);
      setNotice("Starting balance updated.");
      await load();
    } catch (e) {
      setMutationError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function deleteTransaction() {
    if (!selected) return;
    setBusy(true);
    setMutationError("");
    try {
      await request(`/transactions/${selected.id}`, { method: "DELETE" });
      setModal(null);
      setSelected(undefined);
      setNotice("Transaction deleted.");
      await load();
    } catch (e) {
      setMutationError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const categories = new Map(data?.categories.map((c) => [c.id, c.name]));
  const monthTransactions =
    data?.transactions.filter((t) => t.date.startsWith(month)) ?? [];
  const filtered = monthTransactions.filter(
    (t) =>
      (filter === "ALL" || t.type === filter) &&
      `${t.description} ${categories.get(t.categoryId)}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const monthly = data?.summary;
  const displayMonth = new Date(`${month}-01T12:00:00`).toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric" },
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#dashboard">
          <span className="brand-symbol">
            f<span>↗</span>
          </span>
          FinSight<span className="ai-label">AI</span>
        </a>
        <div className="workspace-label">PERSONAL WORKSPACE</div>
        <nav aria-label="Main navigation">
          <a
            href="#dashboard"
            className={page === "dashboard" ? "active" : ""}
            aria-current={page === "dashboard" ? "page" : undefined}
          >
            <Icon name="grid" />
            Overview
          </a>
          <a
            href="#transactions"
            className={page === "transactions" ? "active" : ""}
            aria-current={page === "transactions" ? "page" : undefined}
          >
            <Icon name="list" />
            Transactions
          </a>
          <a
            href="#recurring"
            className={page === "recurring" ? "active" : ""}
            aria-current={page === "recurring" ? "page" : undefined}
          >
            <Icon name="repeat" />
            Recurring Transactions
          </a>
          <a
            href="#forecast"
            className={page === "forecast" ? "active" : ""}
            aria-current={page === "forecast" ? "page" : undefined}
          >
            <Icon name="up" />
            Balance Forecast
          </a>
          <a
            href="#calendar"
            className={page === "calendar" ? "active" : ""}
            aria-current={page === "calendar" ? "page" : undefined}
          >
            <Icon name="calendar" />
            Bill Calendar
          </a>
          <a
            href="#settings"
            className={page === "settings" ? "active" : ""}
            aria-current={page === "settings" ? "page" : undefined}
          >
            <Icon name="wallet" />
            Settings
          </a>
          <a
            href="#insights"
            className={page === "insights" ? "active" : ""}
            aria-current={page === "insights" ? "page" : undefined}
          >
            <Icon name="up" />
            Spending Insights
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="demo-note">
            <span className="status-dot" />
            <strong>Your local demo</strong>
            <p>
              A space to explore your finances.
              <br />
              Sample data. Real functionality.
            </p>
          </div>
          <div className="profile">
            <span className="avatar">AM</span>
            <div>
              <strong>Alex Morgan</strong>
              <small>Demo account</small>
            </div>
            <span className="profile-dot" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span>{" "}
            <strong>
              {page === "dashboard"
                ? "Overview"
                : page === "recurring"
                  ? "Recurring Transactions"
                  : page === "insights"
                    ? "Spending Insights"
                    : page === "settings"
                      ? "Settings"
                      : page === "calendar"
                        ? "Bill Calendar"
                        : page === "forecast"
                          ? "Balance Forecast"
                          : "Transactions"}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="demo-pill">
              <span className="status-dot" />
              Local demo
            </span>
            <button
              className="icon-button theme-button"
              onClick={() => setDark(!dark)}
              aria-label={`Switch to ${dark ? "light" : "dark"} mode`}
            >
              <Icon name={dark ? "sun" : "moon"} />
            </button>
            <span className="avatar small">AM</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR MONEY, AT A GLANCE</div>
              <h1>
                {page === "dashboard"
                  ? "Financial overview"
                  : page === "recurring"
                    ? "Recurring Transactions"
                    : page === "insights"
                      ? "Spending Insights"
                      : page === "settings"
                        ? "Backup & Recovery"
                        : page === "calendar"
                          ? "Bill Calendar"
                          : page === "forecast"
                            ? "Balance Forecast"
                            : "Transactions"}
              </h1>
              <p>
                {page === "dashboard"
                  ? "A clear picture of where you are. A better sense of what’s next."
                  : page === "recurring"
                    ? "Rent, subscriptions, insurance, and paychecks — handled locally."
                    : page === "insights"
                      ? "Understand recorded spending with local, evidence-based analysis."
                      : page === "settings"
                        ? "Local backups, verification, and safe recovery."
                        : page === "calendar"
                          ? "Your bills, plans, and projected balances, day by day."
                          : page === "forecast"
                            ? "See what’s ahead with exact scheduled dates and your own plans."
                            : "Every little detail, all in one place."}
              </p>
            </div>
            <button
              className="primary"
              onClick={() => openTransaction()}
              disabled={!data || loading || !!error}
            >
              <Icon name="plus" size={18} />
              Add transaction
            </button>
          </div>
          <div className="period-bar">
            <span>
              <span className="status-dot" />{" "}
              {page === "dashboard"
                ? "Your everyday account"
                : "Your financial activity"}
            </span>
            {page !== "recurring" &&
              page !== "forecast" &&
              page !== "calendar" &&
              page !== "settings" &&
              page !== "insights" && (
                <label className="month-control">
                  <span className="sr-only">Selected month</span>
                  <input
                    type="month"
                    required
                    min="1900-01"
                    max="9999-12"
                    value={month}
                    onChange={(e) => {
                      if (/^\d{4}-\d{2}$/.test(e.target.value))
                        setMonth(e.target.value);
                    }}
                  />
                </label>
              )}
          </div>
          {notice && (
            <div className="notice" role="status">
              {notice}
            </div>
          )}
          {page === "insights" ? (
            <SpendingInsights transactions={data?.transactions} />
          ) : page === "settings" ? (
            <BackupRecovery />
          ) : error ? (
            <div className="error-panel" role="alert">
              <h2>We couldn’t load your finances</h2>
              <p>{error}</p>
              <button className="secondary" onClick={() => void load()}>
                Try again
              </button>
            </div>
          ) : loading ? (
            <div className="loading" role="status">
              <div className="skeleton-grid">
                {[1, 2, 3, 4].map((i) => (
                  <div className="skeleton" key={i} />
                ))}
              </div>
              <p>Loading your financial picture…</p>
            </div>
          ) : (
            data && (
              <>
                {page === "dashboard" && (
                  <>
                    <SummaryCards
                      account={data.account}
                      summary={monthly!}
                      displayMonth={displayMonth}
                      onAdjustBalance={() => {
                        setBalance(String(data.account.startingBalance));
                        setModal("balance");
                      }}
                    />
                    <DashboardCharts
                      transactions={data.transactions}
                      summary={monthly!}
                      month={month}
                      displayMonth={displayMonth}
                    />
                  </>
                )}
                {page === "recurring" && (
                  <RecurringTransactions
                    focusRuleId={focusedRule}
                    categories={data.categories}
                    transactions={data.transactions}
                    onChanged={() => load(true)}
                  />
                )}
                {page === "calendar" && (
                  <BillCalendar
                    categories={data.categories}
                    transactions={data.transactions}
                    onChanged={() => load(true)}
                  />
                )}
                {page === "forecast" && (
                  <BalanceForecast
                    categories={data.categories}
                    transactions={data.transactions}
                    onChanged={() => load(true)}
                  />
                )}
                {page !== "recurring" &&
                  page !== "forecast" &&
                  page !== "calendar" &&
                  page !== "settings" &&
                  page !== "insights" && (
                    <section className="panel transactions-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>
                            {page === "dashboard"
                              ? "Recent transactions"
                              : "Transaction history"}
                          </h2>
                          <p>
                            {page === "dashboard"
                              ? "The latest movements in your account"
                              : `${filtered.length} transactions in ${displayMonth}`}
                          </p>
                        </div>
                        {page === "dashboard" && (
                          <a className="text-button" href="#transactions">
                            View all <Icon name="arrow" size={15} />
                          </a>
                        )}
                      </div>
                      {page === "transactions" && (
                        <div className="filters">
                          <label className="search">
                            <span className="sr-only">Search transactions</span>
                            <input
                              placeholder="Search description or category…"
                              value={query}
                              onChange={(e) => setQuery(e.target.value)}
                            />
                          </label>
                          <label>
                            <span className="sr-only">Transaction type</span>
                            <select
                              value={filter}
                              onChange={(e) => setFilter(e.target.value)}
                            >
                              <option value="ALL">All transactions</option>
                              <option value="INCOME">Income</option>
                              <option value="EXPENSE">Expenses</option>
                            </select>
                          </label>
                        </div>
                      )}
                      <TransactionTable
                        rows={
                          page === "dashboard"
                            ? monthTransactions.slice(0, 5)
                            : filtered
                        }
                        categories={categories}
                        onEdit={openTransaction}
                        onDelete={(transaction) => {
                          setSelected(transaction);
                          setModal("delete");
                        }}
                      />
                    </section>
                  )}
                <div className="bottom-note">
                  <span className="status-dot" />
                  Your data stays in your local PostgreSQL database.
                  <span>FinSight AI · Phase 3</span>
                </div>
              </>
            )
          )}
        </main>
      </div>
      {modal === "transaction" && data && (
        <Modal
          title={selected ? "Edit transaction" : "Add transaction"}
          onClose={close}
        >
          <TransactionForm
            categories={data.categories}
            existing={selected}
            onSave={saveTransaction}
            onClose={close}
          />
        </Modal>
      )}
      {modal === "balance" && (
        <Modal title="Set starting balance" onClose={close}>
          <form className="form-stack" onSubmit={saveBalance}>
            <p className="muted">
              The amount in your account before your recorded transactions. Your
              available balance adds income and subtracts expenses from this
              amount.
            </p>
            <label>
              Starting balance (USD)
              <input
                autoFocus
                inputMode="decimal"
                required
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
              />
            </label>
            {mutationError && (
              <p className="error" role="alert">
                {mutationError}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? "Saving…" : "Save balance"}
            </button>
          </form>
        </Modal>
      )}
      {modal === "delete" && selected && (
        <Modal title="Delete transaction?" onClose={close}>
          <div className="form-stack">
            <p className="muted">
              Delete “{selected.description}” ({money(selected.amount)})? Your
              balance will be recalculated. This can’t be undone.
            </p>
            {mutationError && (
              <p className="error" role="alert">
                {mutationError}
              </p>
            )}
            <div className="form-row">
              <button className="secondary" onClick={close} disabled={busy}>
                Keep transaction
              </button>
              <button
                className="danger"
                onClick={() => void deleteTransaction()}
                disabled={busy}
              >
                {busy ? "Deleting…" : "Delete transaction"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
