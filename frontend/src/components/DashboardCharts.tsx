import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Summary, Transaction } from "../api";
import { cashFlow, money } from "../finance";
import Icon from "./Icon";
const COLORS = [
  "#635bdb",
  "#a59af0",
  "#3fa99b",
  "#f1b861",
  "#e3839c",
  "#7e9bc3",
  "#9ba866",
  "#c68c69",
];
export default function DashboardCharts({
  transactions,
  summary,
  month,
  displayMonth,
}: {
  transactions: Transaction[];
  summary: Summary;
  month: string;
  displayMonth: string;
}) {
  const totalExpenses = Number(summary.expenses);
  return (
    <section className="charts-grid">
      <article className="panel cashflow">
        <div className="panel-heading">
          <div>
            <h2>Cash flow</h2>
            <p>Your income and expenses, day by day</p>
          </div>
          <span className="subtle-pill">{displayMonth}</span>
        </div>
        <div className="chart-legend">
          <span>
            <i style={{ background: "#635bdb" }} />
            Income
          </span>
          <span>
            <i style={{ background: "#3fa99b" }} />
            Expenses
          </span>
        </div>
        <div
          className="area-chart"
          role="img"
          aria-label={`Daily income and expenses for ${displayMonth}. Income ${money(summary.income)}, expenses ${money(summary.expenses)}.`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={cashFlow(transactions, month)}
              margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#635bdb" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#635bdb" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="expenseFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3fa99b" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="#3fa99b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                vertical={false}
                stroke="var(--line)"
                strokeDasharray="4 4"
              />
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={false}
                minTickGap={28}
                tick={{ fill: "var(--muted)", fontSize: 11 }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={52}
                tick={{ fill: "var(--muted)", fontSize: 11 }}
                tickFormatter={(v) =>
                  Number(v) >= 1000 ? `$${Number(v) / 1000}k` : `$${v}`
                }
              />
              <Tooltip
                contentStyle={{
                  background: "var(--panel)",
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  color: "var(--text)",
                }}
                formatter={(v) => money(Number(v))}
                labelFormatter={(v) => `${displayMonth} · Day ${v}`}
              />
              <Area
                type="monotone"
                dataKey="Income"
                stroke="#635bdb"
                strokeWidth={2.5}
                fill="url(#incomeFill)"
              />
              <Area
                type="monotone"
                dataKey="Expenses"
                stroke="#3fa99b"
                strokeWidth={2.5}
                fill="url(#expenseFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </article>
      <article className="panel spending">
        <div className="panel-heading">
          <div>
            <h2>Spending breakdown</h2>
            <p>Where your money goes this month</p>
          </div>
        </div>
        {summary.categories.length ? (
          <>
            <div className="donut-wrap">
              <div
                className="donut"
                role="img"
                aria-label={`Spending by category for ${displayMonth}`}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={summary.categories.map((c) => ({
                        ...c,
                        amount: Number(c.amount),
                      }))}
                      dataKey="amount"
                      nameKey="name"
                      innerRadius={67}
                      outerRadius={87}
                      paddingAngle={3}
                      stroke="none"
                    >
                      {summary.categories.map((c, i) => (
                        <Cell
                          key={c.categoryId}
                          fill={COLORS[i % COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v) => money(Number(v))}
                      contentStyle={{
                        background: "var(--panel)",
                        border: "1px solid var(--line)",
                        borderRadius: 10,
                        color: "var(--text)",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="donut-center">
                <small>Total spent</small>
                <strong>{money(totalExpenses)}</strong>
              </div>
            </div>
            <ul className="category-list">
              {summary.categories.map((c, i) => (
                <li key={c.categoryId}>
                  <span>
                    <i style={{ background: COLORS[i % COLORS.length] }} />
                    {c.name}
                  </span>
                  <strong>
                    {money(c.amount)}
                    <small>
                      {totalExpenses
                        ? Math.round((Number(c.amount) / totalExpenses) * 100)
                        : 0}
                      %
                    </small>
                  </strong>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="empty">
            <Icon name="wallet" size={30} />
            <h3>A fresh start</h3>
            <p>Add an expense to see your spending breakdown.</p>
          </div>
        )}
      </article>
    </section>
  );
}
