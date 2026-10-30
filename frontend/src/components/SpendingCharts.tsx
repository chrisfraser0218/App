import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SpendingReport } from "../insights";
import { money } from "../finance";
const colors = [
  "#8074e8",
  "#36aa96",
  "#de9d52",
  "#d26986",
  "#6e9bc5",
  "#96a65f",
];
interface ChartPoint {
  label: string;
  details: { label: string; value: string }[];
}
export function InsightsTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: ChartPoint }[];
}) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="forecast-tooltip">
      <strong>{p.label}</strong>
      {p.details.map((d) => (
        <p key={d.label}>
          {d.label}: {money(d.value)}
        </p>
      ))}
    </div>
  );
}
export default function SpendingCharts({
  report: r,
}: {
  report: SpendingReport;
}) {
  const categories = r.categories
    .filter((c) => Number(c.expenses) > 0)
    .map((c) => ({
      ...c,
      label: c.name,
      value: Number(c.expenses),
      current: Number(c.expenses),
      prior: Number(c.previous),
      details: [
        { label: "Expenses", value: c.expenses },
        { label: "Previous range", value: c.previous },
      ],
    }));
  const months = r.months.map((m) => ({
    ...m,
    label: `${m.month}${m.partial ? " · partial dates" : ""}`,
    spending: Number(m.expenses),
    incomeValue: Number(m.income),
    details: [
      { label: "Expenses", value: m.expenses },
      { label: "Income", value: m.income },
      { label: "Net", value: m.net },
    ],
  }));
  const recurrence = [
    {
      label: "Recorded recurring",
      value: Number(r.summary.recurringRecorded),
      details: [
        { label: "Recorded recurring", value: r.summary.recurringRecorded },
      ],
    },
    {
      label: "Recorded nonrecurring",
      value: Number(r.summary.nonrecurringRecorded),
      details: [
        {
          label: "Recorded nonrecurring",
          value: r.summary.nonrecurringRecorded,
        },
      ],
    },
  ];
  const axes = (
    <>
      <CartesianGrid stroke="var(--line)" strokeDasharray="4 4" />
      <XAxis dataKey="month" tick={{ fill: "var(--muted)", fontSize: 10 }} />
      <YAxis
        width={64}
        tick={{ fill: "var(--muted)", fontSize: 10 }}
        tickFormatter={(n) => `$${Number(n).toLocaleString()}`}
      />
      <Tooltip content={<InsightsTooltip />} />
    </>
  );
  return (
    <section
      className="insights-charts"
      aria-label="Interactive spending charts"
    >
      <article className="panel">
        <div className="panel-heading">
          <div>
            <h2>Spending by category</h2>
            <p>Recorded gross expenses in the selected dates.</p>
          </div>
        </div>
        <div
          className="insight-chart"
          role="img"
          aria-label="Category spending chart. Exact amounts and percentages are in the category table."
        >
          {categories.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categories}
                  dataKey="value"
                  nameKey="label"
                  innerRadius="48%"
                  outerRadius="72%"
                  isAnimationActive={false}
                >
                  {categories.map((c, i) => (
                    <Cell key={c.id} fill={colors[i % colors.length]} />
                  ))}
                </Pie>
                <Tooltip content={<InsightsTooltip />} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="empty">No expenses recorded in these dates.</p>
          )}
        </div>
      </article>
      <article className="panel">
        <div className="panel-heading">
          <div>
            <h2>Monthly spending trend</h2>
            <p>Exact recorded totals; first/last periods may be partial.</p>
          </div>
        </div>
        <div
          className="insight-chart"
          role="img"
          aria-label="Monthly spending chart"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={months}
              margin={{ left: 4, right: 20, top: 12, bottom: 10 }}
            >
              {axes}
              <Area
                name="Recorded expenses"
                dataKey="spending"
                stroke="#8074e8"
                fill="#8074e822"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </article>
      <article className="panel">
        <div className="panel-heading">
          <div>
            <h2>Income versus expenses</h2>
            <p>Net cash flow uses recorded income minus gross expenses.</p>
          </div>
        </div>
        <div
          className="insight-chart"
          role="img"
          aria-label="Income versus expenses chart"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={months}
              margin={{ left: 4, right: 20, top: 12, bottom: 10 }}
            >
              {axes}
              <Legend />
              <Bar
                name="Income"
                dataKey="incomeValue"
                fill="#36aa96"
                isAnimationActive={false}
              />
              <Bar
                name="Expenses"
                dataKey="spending"
                fill="#8074e8"
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </article>
      <article className="panel">
        <div className="panel-heading">
          <div>
            <h2>Recurring versus nonrecurring</h2>
            <p>Posted payments only; monthly estimates are shown separately.</p>
          </div>
        </div>
        <div
          className="insight-chart"
          role="img"
          aria-label="Recurring versus nonrecurring recorded expenses"
        >
          {Number(r.summary.expenses) > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={recurrence}
                  dataKey="value"
                  nameKey="label"
                  innerRadius="48%"
                  outerRadius="72%"
                  isAnimationActive={false}
                >
                  {recurrence.map((c, i) => (
                    <Cell key={c.label} fill={colors[i]} />
                  ))}
                </Pie>
                <Tooltip content={<InsightsTooltip />} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="empty">No recorded expenses to compare.</p>
          )}
        </div>
      </article>
      <article className="panel insights-chart-wide">
        <div className="panel-heading">
          <div>
            <h2>Category spending changes</h2>
            <p>
              Selected dates versus the preceding equal-length period. Exact
              comparison dates appear above.
            </p>
          </div>
        </div>
        <div
          className="insight-chart"
          role="img"
          aria-label="Category comparison chart"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={r.categories.map((c) => ({
                ...c,
                label: c.name,
                current: Number(c.expenses),
                prior: Number(c.previous),
                details: [
                  { label: "Selected expenses", value: c.expenses },
                  { label: "Previous expenses", value: c.previous },
                ],
              }))}
              margin={{ left: 4, right: 20, top: 12, bottom: 10 }}
            >
              <CartesianGrid stroke="var(--line)" />
              <XAxis
                dataKey="name"
                tick={{ fill: "var(--muted)", fontSize: 10 }}
              />
              <YAxis width={64} tick={{ fill: "var(--muted)", fontSize: 10 }} />
              <Tooltip content={<InsightsTooltip />} />
              <Legend />
              <Bar
                dataKey="current"
                name="Selected period"
                fill="#8074e8"
                isAnimationActive={false}
              />
              <Bar
                dataKey="prior"
                name="Previous period"
                fill="#36aa96"
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </article>
    </section>
  );
}
