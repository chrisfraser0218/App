import {
  Area,
  ComposedChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SavingsDetail } from "../savings";
import { money } from "../finance";
export function SavingsTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: Record<string, unknown> }[];
}) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="forecast-tooltip">
      <strong>{String(p.date ?? p.month)}</strong>
      {["actual", "projected", "contributions", "withdrawals", "net"].map(
        (key) =>
          typeof p[key] === "string" ? (
            <p key={key}>
              {key}: {money(p[key] as string)}
            </p>
          ) : null,
      )}
    </div>
  );
}
export default function SavingsCharts({
  detail: d,
}: {
  detail: SavingsDetail;
}) {
  const points = d.projection.points.map((p) => ({
      ...p,
      actualValue: p.actual === null ? null : Number(p.actual),
      projectedValue: p.projected === null ? null : Number(p.projected),
    })),
    months = d.projection.months.slice(-24).map((m) => ({
      ...m,
      inValue: Number(m.contributions),
      outValue: Number(m.withdrawals),
    }));
  return (
    <section
      className="savings-chart-grid"
      aria-label="Savings progress charts"
    >
      <article className="panel">
        <div className="panel-heading">
          <div>
            <h3>Target versus actual and projected savings</h3>
            <p>
              Allocation book only. Dashed projections are not recorded funds.
            </p>
          </div>
        </div>
        <div
          className="savings-chart"
          role="img"
          aria-label="Actual allocation progress and projected completion chart"
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="4 4" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "var(--muted)" }}
                minTickGap={45}
              />
              <YAxis width={70} tick={{ fontSize: 10, fill: "var(--muted)" }} />
              <Tooltip content={<SavingsTooltip />} />
              <Legend />
              <ReferenceLine
                y={Number(d.goal.targetAmount)}
                stroke="#36aa96"
                ifOverflow="extendDomain"
                label="Target"
              />
              <Area
                dataKey="actualValue"
                name="Recorded allocations"
                stroke="#8074e8"
                fill="#8074e822"
                connectNulls={false}
                isAnimationActive={false}
              />
              <Line
                dataKey="projectedValue"
                name="Projected allocations"
                stroke="#de9d52"
                strokeDasharray="5 4"
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </article>
      <article className="panel">
        <div className="panel-heading">
          <div>
            <h3>Contributions by month</h3>
            <p>
              Latest 24 recorded months. Corrected entries excluded; withdrawal
              history retained.
            </p>
          </div>
        </div>
        <div
          className="savings-chart"
          role="img"
          aria-label="Recorded savings contributions and withdrawals by month"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={months}>
              <CartesianGrid stroke="var(--line)" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 10, fill: "var(--muted)" }}
              />
              <YAxis width={70} tick={{ fontSize: 10, fill: "var(--muted)" }} />
              <Tooltip content={<SavingsTooltip />} />
              <Legend />
              <Bar
                dataKey="inValue"
                name="Contributions"
                fill="#36aa96"
                isAnimationActive={false}
              />
              <Bar
                dataKey="outValue"
                name="Withdrawals"
                fill="#d26986"
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </article>
    </section>
  );
}
