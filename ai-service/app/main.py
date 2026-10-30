from contextlib import asynccontextmanager
from decimal import Decimal
import os
import hmac
from pathlib import Path
from typing import Annotated, Literal

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from .model import Categorizer
from .spending import SpendingRequest, SpendingResponse, analyze

DEFAULT_MODEL = Path(__file__).resolve().parents[1] / "artifacts" / "category-model.joblib"

class PredictionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=160)]
    amount: Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=2, allow_inf_nan=False)]

class PredictionResponse(BaseModel):
    category: str | None
    confidence: Annotated[float, Field(ge=0, le=1)]
    model_version: str
    status: Literal["suggested", "uncertain", "unknown"]

def create_app(model_path: Path | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Fail startup if missing/incompatible. Training is an explicit offline step.
        app.state.categorizer = Categorizer(model_path or Path(os.getenv("MODEL_PATH", str(DEFAULT_MODEL))))
        yield

    app = FastAPI(title="FinSight category model", version="1.0", lifespan=lifespan)

    token = os.getenv("FINSIGHT_AI_SESSION_TOKEN", "")
    @app.middleware("http")
    async def local_session(request: Request, call_next):
        if token and not hmac.compare_digest(request.headers.get("X-FinSight-AI", ""), token):
            return JSONResponse(status_code=403, content={"detail":"Local AI session required"})
        return await call_next(request)

    @app.get("/health")
    def health(request: Request):
        return {"status": "ready", "model_version": request.app.state.categorizer.version, **({"instance": os.getenv("FINSIGHT_DESKTOP_INSTANCE", "")} if token else {})}

    @app.post("/predict-category", response_model=PredictionResponse)
    def predict(payload: PredictionRequest, request: Request):
        # Amount is validated for a consistent API but v1 features use description only.
        return request.app.state.categorizer.predict(payload.description)

    @app.post("/analyze-spending", response_model=SpendingResponse)
    def spending(payload: SpendingRequest):
        return analyze(payload)

    return app

app = create_app()
