"""Inference only. Load artifacts produced locally by train.py; never unpickle uploads."""
from pathlib import Path
import joblib
import numpy as np
import sklearn

MODEL_VERSION = "1.0"
MIN_CONFIDENCE = 0.45
MIN_MARGIN = 0.12

class Categorizer:
    def __init__(self, path: Path):
        bundle = joblib.load(path)
        if bundle.get("sklearn_version") != sklearn.__version__:
            raise ValueError("Train and serve with the same pinned scikit-learn version")
        self.pipeline = bundle["pipeline"]
        self.version = bundle["model_version"]
        self.vectorizer = self.pipeline.named_steps["tfidf"]
        self.classifier = self.pipeline.named_steps["classifier"]

    def predict(self, description: str) -> dict:
        features = self.vectorizer.transform([description])
        probabilities = self.classifier.predict_proba(features)[0]
        order = np.argsort(probabilities)
        best = int(order[-1])
        confidence = float(probabilities[best])
        margin = confidence - float(probabilities[order[-2]])
        if features.nnz == 0:
            status = "unknown"
        elif confidence < MIN_CONFIDENCE or margin < MIN_MARGIN:
            status = "uncertain"
        else:
            status = "suggested"
        return {
            "category": str(self.classifier.classes_[best]) if status == "suggested" else None,
            "confidence": confidence,
            "model_version": self.version,
            "status": status,
        }
