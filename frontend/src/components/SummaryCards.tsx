import type { Account, Summary } from "../api";
import { money } from "../finance";
import Icon from "./Icon";
export default function SummaryCards({
  account,
  summary,
  displayMonth,
  onAdjustBalance,
}: {
  account: Account;
  summary: Summary;
  displayMonth: string;
  onAdjustBalance: () => void;
}) {
  return (
    <section className="summary-grid" aria-label="Financial summary">
      <article className="summary-card balance-card">
        <div className="card-label">
          Available balance{" "}
          <span className="card-icon">
            <Icon name="wallet" />
          </span>
        </div>
        <div className="metric">{money(account.balance)}</div>
        <div className="card-foot">
          <span className="balance-dot" />
          Across all recorded activity
        </div>
      </article>
      <article className="summary-card">
        <div className="card-label">
          Income{" "}
          <span className="card-icon green">
            <Icon name="down" />
          </span>
        </div>
        <div className="metric">{money(summary.income)}</div>
        <div className="card-foot">In {displayMonth}</div>
      </article>
      <article className="summary-card">
        <div className="card-label">
          Expenses{" "}
          <span className="card-icon peach">
            <Icon name="up" />
          </span>
        </div>
        <div className="metric">{money(summary.expenses)}</div>
        <div className="card-foot">In {displayMonth}</div>
      </article>
      <article className="summary-card">
        <div className="card-label">
          Starting balance{" "}
          <span className="card-icon">
            <Icon name="wallet" />
          </span>
        </div>
        <div className="metric">{money(account.startingBalance)}</div>
        <button className="text-button" onClick={onAdjustBalance}>
          Adjust balance <Icon name="arrow" size={14} />
        </button>
      </article>
    </section>
  );
}
