export type TransactionType = "INCOME" | "EXPENSE";
export interface Transaction {
  id: string;
  description: string;
  amount: string | number;
  type: TransactionType;
  categoryId: string;
  date: string;
}
export interface TransactionInput {
  description: string;
  amount: string;
  type: TransactionType;
  categoryId: string;
  date: string;
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
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new Error(
      "Unable to reach FinSight. Check that the backend is running and try again.",
    );
  }
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    throw new Error(
      problem?.errors?.join(". ") ||
        problem?.detail ||
        `Request failed (${response.status}). Please try again.`,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
