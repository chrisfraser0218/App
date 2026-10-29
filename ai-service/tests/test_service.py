from pathlib import Path
import numpy as np
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.model import Categorizer
from train import train

@pytest.fixture(scope="session")
def artifact(tmp_path_factory):
    output = tmp_path_factory.mktemp("trained-model")
    report = train(output)
    assert report["training_rows"] == 180
    assert report["test_rows"] == 45
    return output / "category-model.joblib"

@pytest.fixture
def client(artifact):
    with TestClient(create_app(artifact)) as client:
        yield client

@pytest.mark.parametrize("description,category", [
    ("Starbucks Coffee", "Food & Drinks"), ("Shell Gas Station", "Transportation"),
    ("Walmart Groceries", "Groceries"), ("Netflix", "Entertainment"),
    ("Verizon", "Utilities"), ("Amazon", "Shopping"),
    ("Apartment rent", "Housing"), ("CVS pharmacy prescription", "Health"),
    ("Charity donation", "Other"),
])
def test_predictions(client, artifact, description, category):
    response = client.post("/predict-category", json={"description": description, "amount": 8.75})
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"category", "confidence", "model_version", "status"}
    assert body["category"] == category
    assert body["status"] == "suggested"
    assert body["model_version"] == "1.0"
    model = Categorizer(artifact)
    actual = float(np.max(model.pipeline.predict_proba([description])[0]))
    assert body["confidence"] == pytest.approx(actual)

@pytest.mark.parametrize("payload", [
    {}, {"description": " ", "amount": 1}, {"description": "A", "amount": 1},
    {"description": "a" * 161, "amount": 1}, {"description": 42, "amount": 1},
    {"description": "Coffee", "amount": 0}, {"description": "Coffee", "amount": -1},
    {"description": "Coffee", "amount": "NaN"}, {"description": "Coffee", "amount": "Infinity"},
    {"description": "Coffee", "amount": "0.001"}, {"description": "Coffee", "amount": "1000000000000"},
    {"description": "Coffee", "amount": 1, "userId": "spoof"},
])
def test_invalid_inputs(client, payload):
    assert client.post("/predict-category", json=payload).status_code == 422

def test_unknown_abstains_with_actual_model_confidence(client, artifact):
    text = "zxqv 984739 xyzzy"
    result = client.post("/predict-category", json={"description": text, "amount": "12.30"}).json()
    assert result["status"] == "unknown"
    assert result["category"] is None
    model = Categorizer(artifact)
    assert result["confidence"] == pytest.approx(float(np.max(model.pipeline.predict_proba([text])[0])))

def test_ambiguous_description_abstains(client):
    result = client.post("/predict-category", json={"description": "coffee gasoline pharmacy rent", "amount": 20}).json()
    assert result["status"] == "uncertain"
    assert result["category"] is None

def test_health_and_repeatable_predictions(client):
    assert client.get("/health").json() == {"status": "ready", "model_version": "1.0"}
    body = {"description": "Starbucks coffee", "amount": "8.75"}
    assert client.post("/predict-category", json=body).json() == client.post("/predict-category", json=body).json()

def test_missing_artifact_fails_startup(tmp_path):
    with pytest.raises(FileNotFoundError):
        with TestClient(create_app(tmp_path / "missing.joblib")):
            pass

def test_test_vocabulary_does_not_leak_into_training(tmp_path):
    import csv
    dataset = tmp_path / "dataset.csv"
    with dataset.open("w") as f:
        writer = csv.writer(f)
        writer.writerow(["description", "category", "split"])
        writer.writerows([["apple coffee", "Food", "train"], ["bus gasoline", "Travel", "train"],
                         ["testonlyword coffee", "Food", "test"], ["testonlyword gasoline", "Travel", "test"]])
    output = tmp_path / "output"
    train(output, dataset)
    assert "testonlyword" not in Categorizer(output / "category-model.joblib").vectorizer.vocabulary_


def test_incompatible_model_metadata_fails_startup(artifact, tmp_path):
    import joblib
    bundle = joblib.load(artifact)
    bundle["sklearn_version"] = "incompatible"
    invalid = tmp_path / "incompatible.joblib"
    joblib.dump(bundle, invalid)
    with pytest.raises(ValueError, match="same pinned scikit-learn"):
        with TestClient(create_app(invalid)):
            pass
