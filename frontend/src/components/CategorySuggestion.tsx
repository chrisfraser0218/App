import type { CategoryPrediction } from "../api";

export default function CategorySuggestion({
  status,
  prediction,
  onAccept,
}: {
  status: "idle" | "loading" | "ready" | "unavailable";
  prediction?: CategoryPrediction;
  onAccept: () => void;
}) {
  if (status === "idle") return null;
  return (
    <aside
      className="category-suggestion"
      aria-label="AI category suggestion"
      aria-live="polite"
    >
      {status === "loading" ? (
        <p>Finding a category suggestion…</p>
      ) : status === "unavailable" ? (
        <p>
          AI suggestions are unavailable. You can still choose a category and
          save.
        </p>
      ) : prediction?.status !== "suggested" ? (
        <p>
          No reliable AI suggestion for this description. Please choose a
          category.
        </p>
      ) : (
        <>
          <div className="suggestion-title">
            <strong>AI suggested: {prediction.category}</strong>
            <span>
              {Math.round(prediction.confidence! * 100)}% model confidence
            </span>
          </div>
          {prediction.categoryName !== prediction.category && (
            <p>Saved in your “{prediction.categoryName}” category.</p>
          )}
          <p>
            Experimental model trained on synthetic examples. Review before
            saving.
          </p>
          <button type="button" className="secondary" onClick={onAccept}>
            Use suggestion
          </button>
          <small>
            Your saved category records acceptance or a correction. You always
            choose.
          </small>
        </>
      )}
    </aside>
  );
}
