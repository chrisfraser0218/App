import { useEffect, useState } from "react";
import { request, type CategoryPrediction, type TransactionType } from "../api";
import { validMoney } from "../finance";

type PredictionState = {
  key: string;
  status: "idle" | "loading" | "ready" | "unavailable";
  prediction?: CategoryPrediction;
};

/** Cancels obsolete requests and hides results for an older description/amount immediately. */
export function useCategoryPrediction(
  description: string,
  amount: string,
  type: TransactionType,
) {
  const normalized = description.trim();
  const key = JSON.stringify([normalized, amount, type]);
  const eligible =
    type === "EXPENSE" &&
    normalized.length >= 2 &&
    normalized.length <= 160 &&
    validMoney(amount);
  const [state, setState] = useState<PredictionState>({
    key: "",
    status: "idle",
  });

  useEffect(() => {
    if (!eligible) return;
    const controller = new AbortController();
    setState({ key, status: "loading" });
    const timer = setTimeout(async () => {
      try {
        const prediction = await request<CategoryPrediction>(
          "/category-predictions",
          {
            method: "POST",
            body: JSON.stringify({ description: normalized, amount }),
            signal: controller.signal,
          },
        );
        if (!controller.signal.aborted)
          setState({
            key,
            status:
              prediction.status === "unavailable" ? "unavailable" : "ready",
            prediction,
          });
      } catch {
        if (!controller.signal.aborted)
          setState({ key, status: "unavailable" });
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, eligible, normalized, amount]);

  if (!eligible) return { status: "idle" as const, prediction: undefined };
  if (state.key !== key)
    return { status: "loading" as const, prediction: undefined };
  return state;
}
