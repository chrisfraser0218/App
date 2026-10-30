import { useState, type FormEvent } from "react";
import type { Category, TransactionType } from "../api";
import type { Plan, PlanInput } from "../forecast";
import { nextDate } from "../forecast";
import { validMoney } from "../finance";
export default function PlanForm({
  categories,
  today,
  existing,
  initialDate,
  initialType,
  onSave,
  onClose,
}: {
  categories: Category[];
  today: string;
  existing?: Plan;
  initialDate?: string;
  initialType?: TransactionType;
  onSave: (p: PlanInput) => Promise<void>;
  onClose: () => void;
}) {
  const [type, setType] = useState<TransactionType>(
    existing?.type ?? initialType ?? "EXPENSE",
  );
  const [description, setDescription] = useState(existing?.description ?? "");
  const [amount, setAmount] = useState(existing?.amount ?? "");
  const [categoryId, setCategory] = useState(
    existing?.categoryId ?? categories.find((c) => c.type === type)?.id ?? "",
  );
  const [date, setDate] = useState(
    existing?.date ?? initialDate ?? nextDate(today),
  );
  const [requestId] = useState(
    () => existing?.requestId ?? crypto.randomUUID(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!description.trim()) {
      setError("Enter a description.");
      return;
    }
    if (!validMoney(amount)) {
      setError("Enter a positive amount with at most two decimals.");
      return;
    }
    if (date <= today) {
      setError(
        "Choose a date after today. Overdue plans may be rescheduled or completed explicitly.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave({
        description: description.trim(),
        amount,
        type,
        categoryId,
        date,
        requestId,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <fieldset className="form-stack" disabled={busy}>
        <p className="notice">
          Planning changes projections only. It will never post to your actual
          balance automatically.
        </p>
        <label>
          Type
          <select
            aria-label="Type"
            value={type}
            onChange={(e) => {
              const t = e.target.value as TransactionType;
              setType(t);
              setCategory(categories.find((c) => c.type === t)?.id ?? "");
            }}
          >
            <option value="EXPENSE">Expense</option>
            <option value="INCOME">Income</option>
          </select>
        </label>
        <label>
          Description
          <input
            required
            autoFocus
            maxLength={160}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label>
          Amount (USD)
          <input
            required
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
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
        <label>
          Planned date
          <input
            required
            type="date"
            min={nextDate(today)}
            max="9999-12-31"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy
            ? "Saving…"
            : existing
              ? "Save planned changes"
              : "Save planned transaction"}
        </button>
      </fieldset>
    </form>
  );
}
