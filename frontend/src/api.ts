export type TransactionType = "INCOME" | "EXPENSE";
export interface Transaction {
  id: string;
  description: string;
  amount: string | number;
  type: TransactionType;
  categoryId: string;
  date: string;
  recurringRuleId?: string | null;
  occurrenceDate?: string | null;
}
export interface CategoryPrediction {
  predictionId: string | null;
  category: string | null;
  categoryId: string | null;
  categoryName: string | null;
  confidence: number | null;
  modelVersion: string | null;
  status: "suggested" | "uncertain" | "unknown" | "unavailable";
}
export interface TransactionInput {
  description: string;
  amount: string;
  type: TransactionType;
  categoryId: string;
  date: string;
  predictionId?: string;
}
export interface Category {
  id: string;
  name: string;
  type: TransactionType;
}
export interface Account {
  id: string;
  name: string;
  currency: string;
  startingBalance: string | number;
  income: string | number;
  expenses: string | number;
  balance: string | number;
}
export interface Summary {
  month: string;
  income: string | number;
  expenses: string | number;
  categories: { categoryId: string; name: string; amount: string | number }[];
}
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
let csrf: Promise<string> | undefined;
let sessionEpoch=0;
export function clearCsrf() { csrf = undefined;sessionEpoch++; }
export async function prepareCsrf(): Promise<string> {
  return csrf ??= fetch('/api/auth/csrf', { credentials: 'same-origin', cache: 'no-store' })
    .then(async response => { if (response.status===401) {clearCsrf();window.dispatchEvent(new Event('finsight-session-expired'));} if (!response.ok) throw new ApiError(response.status,'Unable to start a secure session'); return (await response.json()).token as string; })
    .catch(error => { csrf=undefined; throw error; });
}
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const epoch=sessionEpoch;
  let response: Response;
  try {
    const method=(init?.method ?? 'GET').toUpperCase();
    const token=!['GET','HEAD','OPTIONS'].includes(method) ? await prepareCsrf() : undefined;
    response = await fetch(`/api${path}`, {
      credentials: 'same-origin', cache: 'no-store',
      ...init,
      headers: { "Content-Type": "application/json", ...(token ? { "X-CSRF-TOKEN": token } : {}), ...init?.headers },
    });
  } catch {
    throw new Error(
      "Unable to reach FinSight. Check that the backend is running and try again.",
    );
  }
  if (response.status===403) csrf=undefined; // A rejected nonce must not trap the next explicit retry.
  if (response.status===403 && !path.startsWith('/auth/') && epoch===sessionEpoch) {
    const check=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'}).catch(()=>null);
    if(check?.status===401){clearCsrf();window.dispatchEvent(new Event('finsight-session-expired'));}
  }
  if (response.status===401 && !path.startsWith('/auth/') && epoch===sessionEpoch) {
    clearCsrf(); window.dispatchEvent(new Event('finsight-session-expired'));
  }
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    throw new ApiError(response.status,
      problem?.errors?.join(". ") ||
        problem?.detail ||
        (response.status===403 ? "Your session check expired or was rejected. Please try again." : `Request failed (${response.status}). Please try again.`),
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export type Frequency =
  "DAILY" | "WEEKLY" | "BIWEEKLY" | "TWICE_MONTHLY" | "MONTHLY" | "YEARLY";
export interface RecurringInput {
  description: string;
  amount: string;
  type: TransactionType;
  categoryId: string;
  frequency: Frequency;
  paymentDay: number | null;
  secondPaymentDay: number | null;
  startDate: string;
  endDate: string | null;
  enabled: boolean;
  requestId: string;
  backfillConfirmed: boolean;
  predictionId?: string;
}
export interface RecurringRule extends Omit<
  RecurringInput,
  "amount" | "backfillConfirmed"
> {
  id: string;
  amount: number | string;
  version: number;
  nextDate: string | null;
  archived: boolean;
  status: "ACTIVE" | "PAUSED" | "CANCELED" | "COMPLETED";
  catchUpPending: boolean;
}
export interface Occurrence {
  date: string;
  resolution:
    | "SCHEDULED"
    | "POSTED"
    | "MANUAL"
    | "HANDLED"
    | "REMOVED"
    | "PAUSED"
    | "CANCELED";
  transactionId: string | null;
  description: string | null;
  amount: string | number | null;
  type: TransactionType | null;
}
export interface ProcessResult {
  posted: number;
  pendingRules: number;
  failedRules: number;
}
