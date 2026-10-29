"""Explicit offline training and held-out evaluation using synthetic data only."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import joblib
import sklearn
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from sklearn.pipeline import Pipeline
from app.model import Categorizer, MODEL_VERSION, MIN_CONFIDENCE, MIN_MARGIN

ROOT = Path(__file__).resolve().parent

def train(output: Path = ROOT / "artifacts", dataset: Path = ROOT / "data" / "synthetic-transactions.csv") -> dict:
    with dataset.open() as handle:
        rows = list(csv.DictReader(handle))
    training = [r for r in rows if r["split"] == "train"]
    testing = [r for r in rows if r["split"] == "test"]
    if not training or not testing or set(r["description"].lower() for r in training) & set(r["description"].lower() for r in testing):
        raise ValueError("Dataset must have nonempty, disjoint train and test descriptions")
    labels = sorted({r["category"] for r in training})
    if set(labels) != {r["category"] for r in testing}:
        raise ValueError("Every supported category needs training and held-out examples")
    pipeline = Pipeline([
        ("tfidf", TfidfVectorizer(lowercase=True, ngram_range=(1, 2), sublinear_tf=True)),
        ("classifier", LogisticRegression(C=12.0, max_iter=1000, random_state=42)),
    ])
    pipeline.fit([r["description"] for r in training], [r["category"] for r in training])
    output.mkdir(parents=True, exist_ok=True)
    artifact = output / "category-model.joblib"
    joblib.dump({"pipeline": pipeline, "model_version": MODEL_VERSION, "sklearn_version": sklearn.__version__}, artifact)
    expected = [r["category"] for r in testing]
    predicted = pipeline.predict([r["description"] for r in testing])
    categorizer = Categorizer(artifact)
    results = [categorizer.predict(r["description"]) for r in testing]
    offered = [(r, label) for r, label in zip(results, expected) if r["status"] == "suggested"]
    report = {
        "model_version": MODEL_VERSION,
        "dataset": "SYNTHETIC ONLY: handcrafted merchants and descriptions; no real customer data",
        "dataset_sha256": hashlib.sha256(dataset.read_bytes()).hexdigest(),
        "split": "Explicit disjoint description split. Merchants and vocabulary overlap; not a merchant-held-out benchmark.",
        "training_rows": len(training), "test_rows": len(testing), "categories": labels,
        "accuracy": float(accuracy_score(expected, predicted)),
        "suggestion_coverage": len(offered) / len(testing),
        "suggestion_accuracy": sum(r["category"] == label for r, label in offered) / len(offered) if offered else None,
        "min_confidence": MIN_CONFIDENCE, "min_margin": MIN_MARGIN,
        "classification_report": classification_report(expected, predicted, labels=labels, output_dict=True, zero_division=0),
        "confusion_matrix": confusion_matrix(expected, predicted, labels=labels).tolist(),
        "sklearn_version": sklearn.__version__,
        "limitations": "Synthetic evaluation does not establish real-world accuracy. Probabilities are uncalibrated; mixed merchants and unfamiliar descriptions can be confidently wrong. No feedback is used in training.",
    }
    (output / "evaluation.json").write_text(json.dumps(report, indent=2) + "\n")
    return report

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts")
    args = parser.parse_args()
    result = train(args.output)
    print(json.dumps({k: result[k] for k in ("training_rows", "test_rows", "accuracy", "suggestion_coverage", "suggestion_accuracy", "limitations")}, indent=2))
