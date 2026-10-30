import type { TransactionType } from "./api";
export interface SpendingCategory {
  id: string;
  name: string;
  expenses: string;
  previous: string;
  change: string;
  percent: string | null;
  share: string | null;
  count: number;
}
export interface SpendingMonth {
  month: string;
  from: string;
  to: string;
  income: string;
  expenses: string;
  net: string;
  count: number;
  partial: boolean;
}
export interface SpendingEvidence {
  id: string;
  description: string;
  amount: string;
  type: TransactionType;
  categoryId: string;
  category: string;
  date: string;
  recurringRuleId: string | null;
}
export interface SpendingInsight {
  id: string;
  kind: "HISTORICAL_FACT" | "STATISTICAL_OBSERVATION" | "RECOMMENDATION";
  severity: string;
  title: string;
  explanation: string;
  from: string;
  to: string;
  amount: string | null;
  percentage: string | null;
  calculations: { label: string; value: string }[];
  evidenceIds: string[];
  evidenceCount: number;
}
export interface SpendingReport {
  period: {
    from: string;
    to: string;
    comparisonFrom: string;
    comparisonTo: string;
    asOfDate: string;
  };
  summary: {
    expenses: string;
    income: string;
    net: string;
    currentMonthSpending: string;
    monthToDate: {
      current: string;
      previous: string;
      difference: string;
      percent: string | null;
    };
    average: {
      amount: string | null;
      months: SpendingMonth[];
      explanation: string;
    };
    largestCategory: string | null;
    recurringRecorded: string;
    nonrecurringRecorded: string;
    periodChange: {
      current: string;
      previous: string;
      difference: string;
      percent: string | null;
    };
  };
  categories: SpendingCategory[];
  months: SpendingMonth[];
  recurring: {
    recorded: string;
    normalizedMonthlyEstimate: string;
    pendingThisMonth: string;
    upcomingTotal: string;
    upcomingThrough: string;
    schedules: {
      id: string;
      description: string;
      category: string;
      amount: string;
      frequency: string;
      monthlyEstimate: string;
      startDate: string;
      endDate: string | null;
    }[];
    upcoming: {
      id: string;
      sourceId: string;
      description: string;
      amount: string;
      scheduledDate: string;
      effectiveDate: string;
      overdue: boolean;
      category: string;
    }[];
    byCategory: SpendingCategory[];
    changes: {
      ruleId: string;
      previousId: string;
      currentId: string;
      previous: string;
      current: string;
      percent: string;
      date: string;
    }[];
  };
  detection: {
    status: string;
    methodVersion: string;
    eligible: number;
    insufficient: number;
    truncated: boolean;
    explanation: string;
  };
  insights: SpendingInsight[];
  evidence: SpendingEvidence[];
  categoryNames: { id: string; name: string; type: TransactionType }[];
  limitations: string[];
}
export const INSIGHT_RANGES = [
  ["this_month", "This month"],
  ["last_month", "Last month"],
  ["last_3", "Last 3 months"],
  ["last_6", "Last 6 months"],
  ["last_12", "Last 12 months"],
  ["custom", "Custom date range"],
] as const;
export const insightKind = (kind: string) =>
  kind === "HISTORICAL_FACT"
    ? "Historical fact"
    : kind === "STATISTICAL_OBSERVATION"
      ? "Statistical observation"
      : "Recommendation";
