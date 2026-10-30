"""Stateless, causal robust thresholds. No database, persistence, descriptions, LLM or retraining."""
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal, ROUND_CEILING
from typing import Annotated, Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, model_validator

MIN_HISTORY = 8
MAX_BASELINE = 100
WINDOW_DAYS = 180
class Expense(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: UUID
    date: date
    amount_cents: Annotated[int, Field(gt=0, le=99999999999999, strict=True)]
    category_id: UUID
    recurring_rule_id: UUID | None = None
class SpendingRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    start: date
    end: date
    expenses: Annotated[list[Expense], Field(max_length=5000)]
    @model_validator(mode='after')
    def validate_range(self):
        if self.end < self.start or (self.end-self.start).days>1830: raise ValueError('Invalid analysis range')
        if len({x.id for x in self.expenses}) != len(self.expenses): raise ValueError('Expense IDs must be unique')
        if any(x.date>self.end for x in self.expenses): raise ValueError('History cannot extend beyond the analysis end')
        return self
class Signal(BaseModel):
    transaction_id: UUID
    method: Literal['CATEGORY_MAD','RECURRING_MAD']
    baseline_ids: list[UUID]
class SpendingResponse(BaseModel):
    method_version: str = 'robust-mad-v1'
    min_history: int = MIN_HISTORY
    eligible: int
    insufficient: int
    alerts: list[Signal]
    truncated: bool

def median(values):
    v=sorted(Decimal(x) for x in values);n=len(v)
    return v[n//2] if n%2 else (v[n//2-1]+v[n//2])/2

def threshold(values):
    med=median(values);mad=median([abs(Decimal(x)-med) for x in values])
    # Require both a meaningful absolute/relative increase and a robust z-score above 6.
    limit=max(med+max(Decimal(5000),med/2),med+6*mad/Decimal('0.67448975'))
    return int(limit.to_integral_value(rounding=ROUND_CEILING))

def analyze(payload:SpendingRequest)->SpendingResponse:
    category=defaultdict(list);recurring=defaultdict(list);signals=[];eligible=insufficient=0
    ordered=sorted(payload.expenses,key=lambda x:(x.date,str(x.id)))
    by_date=defaultdict(list)
    for item in ordered:by_date[item.date].append(item)
    for day,items in by_date.items():
        # Same-day entries never become one another's historical baseline.
        for item in items:
            if item.date<payload.start:continue
            has_history=False
            for method,group in [('CATEGORY_MAD',category[item.category_id]),('RECURRING_MAD',recurring[item.recurring_rule_id] if item.recurring_rule_id else [])]:
                prior=[x for x in group if day-timedelta(days=WINDOW_DAYS)<=x.date<day][-MAX_BASELINE:]
                if len(prior)<MIN_HISTORY:continue
                has_history=True
                if item.amount_cents>threshold([x.amount_cents for x in prior]):
                    signals.append(Signal(transaction_id=item.id,method=method,baseline_ids=[x.id for x in prior]))
            if has_history:eligible+=1
            else:insufficient+=1
        for item in items:
            category[item.category_id].append(item)
            if item.recurring_rule_id:recurring[item.recurring_rule_id].append(item)
    return SpendingResponse(eligible=eligible,insufficient=insufficient,alerts=signals[:200],truncated=len(signals)>200)
