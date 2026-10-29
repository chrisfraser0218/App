import { useState, type FormEvent } from "react";
import type {
  Category,
  Transaction,
  TransactionInput,
  TransactionType,
} from "../api";
import { localDate, validMoney } from "../finance";
export default function TransactionForm({
  categories,
  existing,
  onSave,
  onClose,
}: {
  categories: Category[];
  existing?: Transaction;
  onSave: (input: TransactionInput) => Promise<void>;
  onClose: () => void;
}) {
  const [type, setType] = useState<TransactionType>(
    existing?.type ?? "EXPENSE",
  );
  const [categoryId, setCategory] = useState(
    existing?.categoryId ?? categories.find((c) => c.type === type)?.id ?? "",
  );
  const [description, setDescription] = useState(existing?.description ?? "");
  const [amount, setAmount] = useState(String(existing?.amount ?? ""));
  const [date, setDate] = useState(existing?.date ?? localDate());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!validMoney(amount)) {
      setError("Enter a positive amount with at most two decimal places.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave({
        description: description.trim(),
        amount,
        type,
        categoryId,
        date,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <fieldset disabled={saving} className="form-stack">
        <p className="muted">A little clarity, one transaction at a time.</p>
        <div className="type-switch">
          {(["EXPENSE", "INCOME"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={type === t ? "selected" : ""}
              onClick={() => {
                setType(t);
                setCategory(categories.find((c) => c.type === t)?.id ?? "");
              }}
            >
              {t === "EXPENSE" ? "Expense" : "Income"}
            </button>
          ))}
        </div>
        <label>
          Description
          <input
            autoFocus
            required
            maxLength={160}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Weekly groceries"
          />
        </label>
        <div className="form-row">
          <label>
            Amount (USD)
            <input
              required
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </label>
          <label>
            Date
            <input
              required
              type="date"
              max={localDate()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>
        <label>
          Category
          <select
            required
            value={categoryId}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories
              .filter((c) => c.type === type)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={saving || !description.trim()}>
          {saving ? "Saving…" : existing ? "Save changes" : "Add transaction"}
        </button>
      </fieldset>
    </form>
  );
}
