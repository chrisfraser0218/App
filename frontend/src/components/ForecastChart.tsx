import { useState } from "react";
import {
  Brush,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ForecastComparison, ForecastDay } from "../forecast";
import { money } from "../finance";
import { shortDate } from "../recurring";

interface Point {
  date: string;
  baseline: number;
  scenario: number;
  baselineDay: ForecastDay;
  scenarioDay: ForecastDay;
}
export function ForecastTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: Point }[];
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="forecast-tooltip">
      <strong>{shortDate(point.date)}</strong>
      <p>Baseline: {money(point.baselineDay.endingBalance)}</p>
      <p>Comparison: {money(point.scenarioDay.endingBalance)}</p>
      <p>
        Income: {money(point.scenarioDay.income)} · Expenses:{" "}
        {money(point.scenarioDay.expenses)}
      </p>
      <ul>
        {point.scenarioDay.transactions.slice(0, 6).map((t) => (
          <li key={t.id}>
            {t.description} · {t.type === "INCOME" ? "+" : "−"}
            {money(t.amount)}
          </li>
        ))}
      </ul>
      {point.scenarioDay.transactions.length > 6 && (
        <small>More transactions in the daily details below.</small>
      )}
    </div>
  );
}
export default function ForecastChart({
  comparison,
  hasScenario,
}: {
  comparison: ForecastComparison;
  hasScenario: boolean;
}) {
  const [mode, setMode] = useState("daily");
  const baseline = comparison.baseline,
    scenario = comparison.scenario;
  const points: Point[] = baseline.days.map((d, i) => ({
    date: d.date,
    baseline: Number(d.endingBalance),
    scenario: Number(scenario.days[i].endingBalance),
    baselineDay: d,
    scenarioDay: scenario.days[i],
  }));
  const data =
    mode === "daily"
      ? points
      : baseline.months.map((month, index) => {
          const p = points.find((p) => p.date === month.periodEnd)!;
          const other = scenario.months[index];
          return {
            ...p,
            baselineDay: {
              ...p.baselineDay,
              income: month.income,
              expenses: month.expenses,
              transactions: baseline.days
                .filter((d) => d.date.startsWith(month.month))
                .flatMap((d) => d.transactions),
            },
            scenarioDay: {
              ...p.scenarioDay,
              income: other.income,
              expenses: other.expenses,
              transactions: scenario.days
                .filter((d) => d.date.startsWith(month.month))
                .flatMap((d) => d.transactions),
            },
          };
        });
  return (
    <section className="panel forecast-chart-panel">
      <div className="panel-heading">
        <div>
          <h2>Projected balance over time</h2>
          <p>
            Calculated closing balances on scheduled dates. No AI-generated
            amounts.
          </p>
        </div>
        <label className="compact-control">
          Chart view
          <select
            aria-label="Chart view"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="daily">Daily</option>
            <option value="monthly">Monthly closes</option>
          </select>
        </label>
      </div>
      <div
        className="forecast-chart"
        role="img"
        aria-label={`Balance projection from ${baseline.summary.asOfDate} to ${baseline.summary.endDate}. Baseline ending ${money(baseline.summary.projectedBalance)}${hasScenario ? `, hypothetical ending ${money(scenario.summary.projectedBalance)}` : ""}. Exact values are in the tables below.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ left: 12, right: 20, top: 10, bottom: 8 }}
          >
            <CartesianGrid stroke="var(--line)" strokeDasharray="4 4" />
            <XAxis
              dataKey="date"
              minTickGap={45}
              tick={{ fill: "var(--muted)", fontSize: 10 }}
              tickFormatter={(v) => String(v).slice(5)}
            />
            <YAxis
              width={70}
              tick={{ fill: "var(--muted)", fontSize: 10 }}
              tickFormatter={(n) =>
                `$${Math.round(Number(n)).toLocaleString()}`
              }
            />
            <Tooltip content={<ForecastTooltip />} />
            <Legend />
            <ReferenceLine y={0} stroke="#d06079" />
            <ReferenceLine
              y={Number(scenario.lowBalanceThreshold)}
              stroke="#d39d42"
              strokeDasharray="5 5"
            />
            {mode === "daily" && (
              <ReferenceDot
                x={scenario.summary.lowestDate}
                y={Number(scenario.summary.lowestBalance)}
                r={5}
                fill="#d39d42"
                stroke="var(--panel)"
                ifOverflow="extendDomain"
              />
            )}
            <Line
              name="Baseline projection"
              type="stepAfter"
              dataKey="baseline"
              stroke="#8074e8"
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />
            {hasScenario && (
              <Line
                name="Hypothetical projection"
                type="stepAfter"
                dataKey="scenario"
                stroke="#36aa96"
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
              />
            )}
            <Brush
              dataKey="date"
              height={22}
              stroke="#8074e8"
              tickFormatter={(v) => String(v).slice(5)}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="forecast-footnote">
        Actual starting balance {money(scenario.summary.currentActualBalance)} ·
        projected ending {money(scenario.summary.projectedBalance)} · lowest{" "}
        {money(scenario.summary.lowestBalance)} on{" "}
        {shortDate(scenario.summary.lowestDate)}. Scheduled income{" "}
        {money(scenario.summary.recurringIncome)} / expenses{" "}
        {money(scenario.summary.recurringExpenses)}; planned income{" "}
        {money(scenario.summary.plannedIncome)} / expenses{" "}
        {money(scenario.summary.plannedExpenses)}. Chart numbers are for
        visualization; the backend computes all currency using exact decimal
        arithmetic. Monthly view samples each month’s closing balance.
      </p>
    </section>
  );
}
