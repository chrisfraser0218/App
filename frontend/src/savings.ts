import type { Frequency } from "./api";
export type Bucket = "IN_ACCOUNT" | "EXTERNAL";
export interface SavingsGoal {
  id: string;
  name: string;
  description: string;
  targetAmount: string;
  targetDate: string | null;
  createdAt: string;
  status: "ACTIVE" | "COMPLETED" | "ARCHIVED";
  archived: boolean;
  completed: boolean;
  saved: string;
  inAccount: string;
  external: string;
  remaining: string;
  progress: string;
  version: number;
  requestId: string;
}
export interface SavingsEntry {
  id: string;
  amount: string;
  type: "CONTRIBUTION" | "WITHDRAWAL";
  bucket: Bucket;
  date: string;
  note: string;
  transactionId: string | null;
  active: boolean;
  transactionMissing: boolean;
  transactionChanged: boolean;
  replacesId: string | null;
  correctionReason: string | null;
  createdAt: string;
}
export interface SavingsSummary {
  totalGoals: number;
  activeGoals: number;
  archivedGoals: number;
  completedGoals: number;
  approachingGoals: number;
  totalTarget: string;
  totalSaved: string;
  overallProgress: string;
  actualBalance: string;
  allocatedInAccount: string;
  trackedExternal: string;
  unallocatedBalance: string;
  asOfDate: string;
}
export interface SavingsDashboard {
  summary: SavingsSummary;
  goals: SavingsGoal[];
}
export interface SavingsSchedule {
  amount: string;
  bucket: Bucket;
  frequency: Frequency | null;
  paymentDay: number | null;
  secondPaymentDay: number | null;
  startDate: string;
  endDate: string | null;
  enabled: boolean;
  linkType: "NONE" | "PLANNED" | "RECURRING";
  linkId: string | null;
  version: number;
}
export interface SavingsDetail {
  goal: SavingsGoal;
  entries: SavingsEntry[];
  schedule: SavingsSchedule | null;
  projection: {
    asOfDate: string;
    horizon: string;
    method: string;
    estimatedCompletionDate: string | null;
    expectedByTarget: string | null;
    requiredMonthly: string | null;
    requiredPerOccurrence: string | null;
    remainingOccurrences: number;
    bankProjectedBalance: string;
    bankForecastDate: string;
    points: { date: string; actual: string | null; projected: string | null }[];
    months: {
      month: string;
      contributions: string;
      withdrawals: string;
      net: string;
    }[];
    observations: string[];
  };
}
