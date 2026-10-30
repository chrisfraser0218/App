import { useState, type FormEvent } from "react";
import type { Transaction, RecurringRule, Frequency } from "../api";
import { money, validMoney } from "../finance";
import { FREQUENCIES, validPaymentDays } from "../recurring";
import type {
  SavingsGoal,
  SavingsEntry,
  SavingsDetail,
  SavingsSchedule,
  Bucket,
} from "../savings";
interface FormProps {
  onSave: (body: unknown) => Promise<void>;
  onClose: () => void;
}
function tomorrow(date: string) {
  const d = new Date(date + "T12:00:00");
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function SavingsGoalForm({
  goal,
  onSave,
  onClose,
}: { goal?: SavingsGoal } & FormProps) {
  const [name, setName] = useState(goal?.name ?? ""),
    [description, setDescription] = useState(goal?.description ?? ""),
    [target, setTarget] = useState(goal?.targetAmount ?? ""),
    [date, setDate] = useState(goal?.targetDate ?? ""),
    [requestId] = useState(() => goal?.requestId ?? crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !validMoney(target)) {
      setError(
        "Enter a name and a positive target with at most two decimal places.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const input = {
        name: name.trim(),
        description,
        targetAmount: target,
        targetDate: date || null,
        requestId,
      };
      await onSave(goal ? { goal: input, version: goal.version } : input);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form-stack" onSubmit={submit}>
      <p className="muted">
        A goal tracks allocations. Creating or editing it does not move money.
      </p>
      <label>
        Goal name
        <input
          autoFocus
          required
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        Description
        <textarea
          maxLength={1000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label>
        Target amount (USD)
        <input
          inputMode="decimal"
          required
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
      </label>
      <label>
        Target date (optional)
        <input
          type="date"
          min="1900-01-01"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form-row">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </button>
        <button className="primary" disabled={busy}>
          {busy ? "Saving…" : goal ? "Save goal" : "Create goal"}
        </button>
      </div>
    </form>
  );
}
export function SavingsEntryForm({
  detail,
  mode,
  existing,
  transactions,
  onSave,
  onClose,
}: {
  detail: SavingsDetail;
  mode: "CONTRIBUTION" | "WITHDRAWAL" | "CORRECTION";
  existing?: SavingsEntry;
  transactions: Transaction[];
} & FormProps) {
  const [amount, setAmount] = useState(existing?.amount ?? ""),
    [type, setType] = useState<"CONTRIBUTION" | "WITHDRAWAL">(
      existing?.type ?? (mode === "WITHDRAWAL" ? "WITHDRAWAL" : "CONTRIBUTION"),
    ),
    [bucket, setBucket] = useState<Bucket>(existing?.bucket ?? "IN_ACCOUNT"),
    [date, setDate] = useState(existing?.date ?? detail.projection.asOfDate),
    [note, setNote] = useState(existing?.note ?? ""),
    [transactionId, setTransaction] = useState(existing?.transactionId ?? ""),
    [voidEntry, setVoid] = useState(false),
    [reason, setReason] = useState(""),
    [requestId] = useState(() => crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const direction =
    (type === "CONTRIBUTION") === (bucket === "IN_ACCOUNT")
      ? "INCOME"
      : "EXPENSE";
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!voidEntry && !validMoney(amount)) {
      setError("Use a positive amount with at most two decimal places.");
      return;
    }
    if (mode === "CORRECTION" && !reason.trim()) {
      setError("Explain why this entry is being corrected.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const entry = {
        amount,
        type,
        bucket,
        date,
        note,
        transactionId: transactionId || null,
      };
      await onSave(
        mode === "CORRECTION"
          ? {
              replacement: voidEntry ? null : entry,
              reason,
              requestId,
              version: detail.goal.version,
            }
          : { entry, requestId, version: detail.goal.version },
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form-stack" onSubmit={submit}>
      <p className="notice">
        This changes the allocation book only. It never creates, edits or
        deletes a bank transaction.
      </p>
      {mode === "CORRECTION" && (
        <>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={voidEntry}
              onChange={(e) => setVoid(e.target.checked)}
            />
            Void this erroneous entry without a replacement
          </label>
          <label>
            Correction reason
            <textarea
              required
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </>
      )}
      {!voidEntry && (
        <>
          <label>
            Entry type
            <select
              value={type}
              disabled={mode !== "CORRECTION"}
              onChange={(e) => {
                setType(e.target.value as typeof type);
                setTransaction("");
              }}
            >
              <option value="CONTRIBUTION">Contribution</option>
              <option value="WITHDRAWAL">Withdrawal</option>
            </select>
          </label>
          <label>
            Savings location
            <select
              value={bucket}
              onChange={(e) => {
                setBucket(e.target.value as Bucket);
                setTransaction("");
              }}
            >
              <option value="IN_ACCOUNT">Reserved in this account</option>
              <option value="EXTERNAL">Tracked outside this account</option>
            </select>
          </label>
          <p className="muted">
            Only in-account savings reduce the displayed unallocated balance.
            Outside-account savings are not subtracted again after a real
            transfer.
          </p>
          <label>
            Amount (USD)
            <input
              autoFocus
              required
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label>
            Allocation date
            <input
              type="date"
              required
              min="1900-01-01"
              max={detail.projection.asOfDate}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            Note (optional)
            <textarea
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <label>
            Associate existing {direction.toLowerCase()} transaction (optional)
            <select
              value={transactionId}
              onChange={(e) => {
                setTransaction(e.target.value);
                const t = transactions.find((t) => t.id === e.target.value);
                if (t) {
                  setAmount(String(t.amount));
                  setDate(t.date);
                }
              }}
            >
              <option value="">No transaction link — allocation only</option>
              {transactions
                .filter((t) => t.type === direction)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.date} · {t.description} · {money(t.amount)}
                  </option>
                ))}
            </select>
          </label>
          <p className="muted">
            Selecting a payment copies its exact amount/date for your review.
            Whole-payment links must match and may be used by only one active
            allocation. The payment stays unchanged.
          </p>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form-row">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </button>
        <button className="primary" disabled={busy}>
          {busy
            ? "Saving…"
            : mode === "CORRECTION"
              ? "Save correction"
              : type === "WITHDRAWAL"
                ? "Record withdrawal"
                : "Add contribution"}
        </button>
      </div>
    </form>
  );
}
export function SavingsScheduleForm({
  detail,
  plans,
  rules,
  onSave,
  onClose,
}: {
  detail: SavingsDetail;
  plans: {
    id: string;
    description: string;
    amount: string;
    type: string;
    status: string;
  }[];
  rules: RecurringRule[];
} & FormProps) {
  const s = detail.schedule;
  const [amount, setAmount] = useState(String(s?.amount ?? "")),
    [bucket, setBucket] = useState<Bucket>(s?.bucket ?? "IN_ACCOUNT"),
    [frequency, setFrequency] = useState<Frequency>(s?.frequency ?? "MONTHLY"),
    [day, setDay] = useState(s?.paymentDay ?? 1),
    [second, setSecond] = useState(s?.secondPaymentDay ?? 15),
    [start, setStart] = useState(
      s?.startDate ?? tomorrow(detail.projection.asOfDate),
    ),
    [end, setEnd] = useState(s?.endDate ?? ""),
    [enabled, setEnabled] = useState(s?.enabled ?? true),
    [linkType, setLinkType] = useState<SavingsSchedule["linkType"]>(
      s?.linkType ?? "NONE",
    ),
    [linkId, setLinkId] = useState(s?.linkId ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const links = linkType === "PLANNED" ? plans : rules;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (
      !validMoney(amount) ||
      start < "1900-01-01" ||
      (end && end < start) ||
      (linkType === "NONE" && !validPaymentDays(frequency, day, second)) ||
      (linkType !== "NONE" && !linkId)
    ) {
      setError(
        "Choose positive money, ordered dates, valid days and an existing cash-flow link when requested.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave({
        amount,
        bucket,
        frequency: linkType === "NONE" ? frequency : null,
        paymentDay:
          linkType === "NONE" &&
          ["MONTHLY", "TWICE_MONTHLY"].includes(frequency)
            ? day
            : null,
        secondPaymentDay:
          linkType === "NONE" && frequency === "TWICE_MONTHLY" ? second : null,
        startDate: start,
        endDate: end || null,
        enabled,
        linkType,
        linkId: linkType === "NONE" ? null : linkId,
        version: detail.goal.version,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form-stack" onSubmit={submit}>
      <p className="notice">
        An intention, not an automatic payment. Missed allocations are never
        backfilled. Bank forecasts change only through existing explicit
        cash-flow plans or schedules.
      </p>
      <label>
        Planned allocation (USD)
        <input
          required
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <label>
        Savings location
        <select
          value={bucket}
          onChange={(e) => {
            setBucket(e.target.value as Bucket);
            setLinkId("");
          }}
        >
          <option value="IN_ACCOUNT">In this account</option>
          <option value="EXTERNAL">Outside this account</option>
        </select>
      </label>
      <label>
        Cash-flow association
        <select
          aria-label="Cash-flow association"
          value={linkType}
          onChange={(e) => {
            setLinkType(e.target.value as typeof linkType);
            setLinkId("");
          }}
        >
          <option value="NONE">Allocation only — no bank effect</option>
          <option value="PLANNED">Use an existing planned cash flow</option>
          <option value="RECURRING">Use an existing recurring cash flow</option>
        </select>
      </label>
      {linkType === "NONE" ? (
        <>
          <label>
            Frequency
            <select
              aria-label="Frequency"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as Frequency)}
            >
              {Object.entries(FREQUENCIES).map(([v, n]) => (
                <option key={v} value={v}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {["MONTHLY", "TWICE_MONTHLY"].includes(frequency) && (
            <label>
              Payment day
              <input
                type="number"
                min={1}
                max={31}
                required
                value={day}
                onChange={(e) => setDay(Number(e.target.value))}
              />
            </label>
          )}
          {frequency === "TWICE_MONTHLY" && (
            <label>
              Second payment day
              <input
                type="number"
                min={1}
                max={31}
                required
                value={second}
                onChange={(e) => setSecond(Number(e.target.value))}
              />
            </label>
          )}
        </>
      ) : (
        <label>
          Existing cash flow
          <select
            required
            value={linkId}
            onChange={(e) => {
              setLinkId(e.target.value);
              const t = links.find((t) => t.id === e.target.value);
              if (t) setAmount(String(t.amount));
            }}
          >
            <option value="">
              Choose a matching {bucket === "EXTERNAL" ? "expense" : "income"}
            </option>
            {links
              .filter(
                (t) =>
                  t.type === (bucket === "EXTERNAL" ? "EXPENSE" : "INCOME"),
              )
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.description} · {money(t.amount)}
                </option>
              ))}
          </select>
        </label>
      )}
      <label>
        Start date
        <input
          type="date"
          required
          min="1900-01-01"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
      </label>
      <label>
        End date (optional)
        <input
          type="date"
          min={start}
          value={end}
          onChange={(e) => setEnd(e.target.value)}
        />
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Use this allocation plan in estimates
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form-row">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </button>
        <button className="primary" disabled={busy}>
          {busy ? "Saving…" : "Save allocation plan"}
        </button>
      </div>
    </form>
  );
}
