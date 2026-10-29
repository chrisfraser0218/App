import type { Transaction } from "../api";
import { money } from "../finance";
import Icon from "./Icon";
export default function TransactionTable({
  rows,
  categories,
  onEdit,
  onDelete,
}: {
  rows: Transaction[];
  categories: Map<string, string>;
  onEdit: (transaction?: Transaction) => void;
  onDelete: (transaction: Transaction) => void;
}) {
  return rows.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Transaction</th>
            <th>Category</th>
            <th>Date</th>
            <th className="number">Amount</th>
            <th>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td>
                <div className="transaction-name">
                  <span className={`transaction-icon ${t.type.toLowerCase()}`}>
                    <Icon
                      name={t.type === "INCOME" ? "down" : "up"}
                      size={17}
                    />
                  </span>
                  <div>
                    <strong>{t.description}</strong>
                    <small>{t.type === "INCOME" ? "Income" : "Expense"}</small>
                  </div>
                </div>
              </td>
              <td>
                <span className="category-tag">
                  {categories.get(t.categoryId)}
                </span>
              </td>
              <td className="muted nowrap">
                {new Date(`${t.date}T12:00:00`).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </td>
              <td
                className={`number amount ${t.type === "INCOME" ? "positive" : ""}`}
              >
                {t.type === "INCOME" ? "+" : "−"}
                {money(t.amount)}
              </td>
              <td>
                <div className="row-actions">
                  <button
                    className="icon-button"
                    aria-label={`Edit ${t.description}`}
                    onClick={() => onEdit(t)}
                  >
                    <Icon name="edit" size={16} />
                  </button>
                  <button
                    className="icon-button danger-text"
                    aria-label={`Delete ${t.description}`}
                    onClick={() => onDelete(t)}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <div className="empty">
      <Icon name="list" size={30} />
      <h3>No transactions here yet</h3>
      <p>Try a different month or filter, or add your first transaction.</p>
      <button className="secondary" onClick={() => onEdit()}>
        Add transaction
      </button>
    </div>
  );
}
