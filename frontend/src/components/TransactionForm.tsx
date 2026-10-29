import { useState, type FormEvent, type ReactNode } from "react";
import type {
  Category,
  Transaction,
  TransactionInput,
  TransactionType,
} from "../api";
import CategorySuggestion from "./CategorySuggestion";
import { useCategoryPrediction } from "../hooks/useCategoryPrediction";
import { localDate, validMoney } from "../finance";
export default function TransactionForm({
  categories,
  existing,
  onSave,
  onClose,
  dateLabel = "Date",
  allowFutureDate = false,
  submitLabel,
  extraFields,
  validateExtra,
}: {
  categories: Category[];
  existing?: Transaction;
  onSave: (input: TransactionInput) => Promise<void>;
  onClose: () => void;
  dateLabel?: string;
  allowFutureDate?: boolean;
  submitLabel?: string;
  extraFields?: (date: string) => ReactNode;
  validateExtra?: (date: string) => string | undefined;
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
  const { status, prediction } = useCategoryPrediction(
    description,
    amount,
    type,
  );
  const suggestion =
    prediction?.status === "suggested" &&
    categories.some(
      (c) => c.id === prediction.categoryId && c.type === "EXPENSE",
    )
      ? prediction
      : undefined;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!validMoney(amount)) {
      setError("Enter a positive amount with at most two decimal places.");
      return;
    }
    const extraError = validateExtra?.(date);
    if (extraError) {
      setError(extraError);
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
        ...(suggestion?.predictionId
          ? { predictionId: suggestion.predictionId }
          : {}),
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
            {dateLabel}
            <input
              required
              type="date"
              max={allowFutureDate ? "9999-12-31" : localDate()}
              min={allowFutureDate ? "1900-01-01" : undefined}
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
        {extraFields?.(date)}
        <CategorySuggestion
          status={status}
          prediction={prediction}
          onAccept={() => {
            if (suggestion?.categoryId) setCategory(suggestion.categoryId);
          }}
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={saving || !description.trim()}>
          {saving
            ? "Saving…"
            : (submitLabel ?? (existing ? "Save changes" : "Add transaction"))}
        </button>
      </fieldset>
    </form>
  );
}
