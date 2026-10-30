import { useEffect, useState } from "react";
import { request, type Transaction } from "../api";
import { money } from "../finance";
import type { SavingsDashboard } from "../savings";
/** Separate optional context; an unavailable savings request cannot alter spending charts/totals. */
export default function SavingsAllocation({
  transactions,
}: {
  transactions?: Transaction[];
}) {
  const [data, setData] = useState<SavingsDashboard>();
  useEffect(() => {
    const c = new AbortController();
    request<SavingsDashboard>("/savings-goals", { signal: c.signal })
      .then((r) => {
        if (!c.signal.aborted) setData(r);
      })
      .catch(() => {});
    return () => c.abort();
  }, [transactions]);
  if (!data || !data.summary.totalGoals) return null;
  return (
    <aside className="panel savings-allocation-note">
      <h2>Savings allocations — separate from spending</h2>
      <p>
        {money(data.summary.allocatedInAccount)} reserved here ·{" "}
        {money(data.summary.trackedExternal)} tracked elsewhere ·{" "}
        {money(data.summary.unallocatedBalance)} unallocated in this account.
      </p>
      <p className="muted">
        These allocations are not expenses or income and are excluded from
        spending totals and anomaly detection.{" "}
        <a className="text-button" href="#savings">
          View Savings Goals →
        </a>
      </p>
    </aside>
  );
}
