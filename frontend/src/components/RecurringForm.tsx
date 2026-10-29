import { useState } from "react";
import type {
  Category,
  Frequency,
  RecurringInput,
  RecurringRule,
} from "../api";
import { localDate } from "../finance";
import { FREQUENCIES, validPaymentDays } from "../recurring";
import TransactionForm from "./TransactionForm";

export default function RecurringForm({
  categories,
  existing,
  onSave,
  onClose,
}: {
  categories: Category[];
  existing?: RecurringRule;
  onSave: (value: RecurringInput) => Promise<void>;
  onClose: () => void;
}) {
  const [frequency, setFrequency] = useState<Frequency>(
    existing?.frequency ?? "MONTHLY",
  );
  const [first, setFirst] = useState(existing?.paymentDay ?? 1);
  const [second, setSecond] = useState(existing?.secondPaymentDay ?? 15);
  const [endDate, setEndDate] = useState(existing?.endDate ?? "");
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [confirmed, setConfirmed] = useState(false);
  const [requestId] = useState(
    () => existing?.requestId ?? crypto.randomUUID(),
  );
  return (
    <TransactionForm
      categories={categories}
      existing={
        existing
          ? {
              id: existing.id,
              description: existing.description,
              amount: existing.amount,
              type: existing.type,
              categoryId: existing.categoryId,
              date: existing.startDate,
            }
          : undefined
      }
      onClose={onClose}
      dateLabel="Start date"
      allowFutureDate
      submitLabel={
        existing ? "Save schedule changes" : "Create recurring schedule"
      }
      validateExtra={(date) => {
        if (!validPaymentDays(frequency, first, second))
          return "Choose valid payment days (1–31), with the second later than the first.";
        if (endDate && endDate < date)
          return "End date must be on or after the start date.";
        if (!existing && enabled && date < localDate() && !confirmed)
          return "Confirm the catch-up postings for the past start date.";
      }}
      onSave={async (input) =>
        onSave({
          description: input.description,
          amount: input.amount,
          type: input.type,
          categoryId: input.categoryId,
          startDate: input.date,
          frequency,
          paymentDay:
            frequency === "MONTHLY" || frequency === "TWICE_MONTHLY"
              ? first
              : null,
          secondPaymentDay: frequency === "TWICE_MONTHLY" ? second : null,
          endDate: endDate || null,
          enabled,
          requestId,
          backfillConfirmed: confirmed,
          ...(input.predictionId ? { predictionId: input.predictionId } : {}),
        })
      }
      extraFields={(date) => (
        <>
          {existing && (
            <p className="notice">
              Only future occurrences change. Already due entries are processed
              using the previous schedule; posted transactions stay unchanged.
            </p>
          )}
          <label>
            Frequency
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as Frequency)}
            >
              {Object.entries(FREQUENCIES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {(frequency === "MONTHLY" || frequency === "TWICE_MONTHLY") && (
            <div className="form-row">
              <label>
                {frequency === "MONTHLY" ? "Payment day" : "First payment day"}
                <input
                  type="number"
                  required
                  min={1}
                  max={31}
                  value={first}
                  onChange={(e) => setFirst(Number(e.target.value))}
                />
              </label>
              {frequency === "TWICE_MONTHLY" && (
                <label>
                  Second payment day
                  <input
                    type="number"
                    required
                    min={1}
                    max={31}
                    value={second}
                    onChange={(e) => setSecond(Number(e.target.value))}
                  />
                </label>
              )}
            </div>
          )}
          {(frequency === "MONTHLY" || frequency === "TWICE_MONTHLY") && (
            <p className="muted">
              Missing days use the month’s last day. Two days that resolve to
              the same date create just one payment.
            </p>
          )}
          <label>
            End date (optional)
            <input
              type="date"
              min={date}
              max="9999-12-31"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
          {!existing && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Start active
            </label>
          )}
          {!existing && enabled && date < localDate() && (
            <label className="checkbox-label catchup-confirmation">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I authorize posting all due occurrences from the start date
              through today.
            </label>
          )}
          <p className="muted">
            Due entries post to your real balance automatically. Future dates
            stay unposted. Already recorded a payment? Start paused, reconcile
            it, then resume. Resume skips dates missed while paused.
          </p>
        </>
      )}
    />
  );
}
