from datetime import date, timedelta
from uuid import UUID
from decimal import Decimal
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.spending import Expense, SpendingRequest, analyze, threshold

def expense(n,amount=1000,day=None,category=1,rule=None):
    return Expense(id=UUID(int=n),date=day or date(2026,9,1)+timedelta(days=n),amount_cents=amount,category_id=UUID(int=category),recurring_rule_id=UUID(int=rule) if rule else None)
def payload(rows,start=date(2026,10,1),end=date(2026,10,15)):
    return SpendingRequest(start=start,end=end,expenses=rows)
def history(count=8,amount=1000,rule=None):return [expense(i+1,amount,rule=rule) for i in range(count)]

def test_flat_history_large_expense_and_real_causal_evidence():
    rows=history()+[expense(100,10000,date(2026,10,5))];r=analyze(payload(rows));assert r.eligible==1;assert len(r.alerts)==1;assert r.alerts[0].baseline_ids==[x.id for x in rows[:8]];assert r.alerts[0].method=='CATEGORY_MAD'
@pytest.mark.parametrize('count',[0,1,7])
def test_insufficient_history_abstains(count):
    r=analyze(payload(history(count)+[expense(100,100000,date(2026,10,5))]));assert not r.alerts;assert r.insufficient==1;assert r.eligible==0

def test_same_day_and_future_values_do_not_pollute_baseline():
    rows=[expense(i+1,1000,date(2026,10,5)) for i in range(8)]+[expense(100,100000,date(2026,10,5))];r=analyze(payload(rows));assert not r.alerts;assert r.insufficient==9

def test_other_category_not_used_as_baseline():
    r=analyze(payload(history()+[expense(100,100000,date(2026,10,5),category=2)]));assert not r.alerts

def test_recurring_baseline_is_distinct_and_flags_an_actual_payment_change():
    r=analyze(payload(history(rule=3)+[expense(100,10000,date(2026,10,5),rule=3)]));assert {a.method for a in r.alerts}=={'CATEGORY_MAD','RECURRING_MAD'}

def test_strict_cent_threshold_boundary_and_substantial_increase_floor():
    assert threshold([1000]*8)==6000
    assert not analyze(payload(history()+[expense(100,6000,date(2026,10,5))])).alerts
    assert analyze(payload(history()+[expense(100,6001,date(2026,10,5))])).alerts

def test_uneven_history_is_not_assumed_to_have_a_small_variance():
    rows=[expense(i+1,a) for i,a in enumerate([1000,20000,5000,15000,8000,18000,2000,14000])]
    assert not analyze(payload(rows+[expense(100,22000,date(2026,10,5))])).alerts

def test_old_history_is_excluded():
    rows=[expense(i+1,1000,date(2025,1,1)+timedelta(days=i)) for i in range(8)]
    assert not analyze(payload(rows+[expense(100,100000,date(2026,10,5))])).alerts

@pytest.mark.parametrize('amount',[0,-1,1.23,'1000',True])
def test_invalid_amounts_are_rejected(amount):
    with pytest.raises(ValueError):Expense(id=UUID(int=1),date=date(2026,10,1),amount_cents=amount,category_id=UUID(int=1))

def test_duplicate_ids_invalid_ranges_and_unknown_fields_rejected():
    with pytest.raises(ValueError):payload([expense(1),expense(1)])
    with pytest.raises(ValueError):payload([],date(2026,10,10),date(2026,10,1))
    with pytest.raises(ValueError):Expense(id=UUID(int=1),date=date(2026,10,1),amount_cents=100,category_id=UUID(int=1),description='Not needed by the analyzer')

def test_api_structure_and_read_only_stateless_repeatability():
    with TestClient(create_app()) as client:
        body=payload(history()+[expense(100,10000,date(2026,10,5))]).model_dump(mode='json')
        first=client.post('/analyze-spending',json=body);second=client.post('/analyze-spending',json=body)
        assert first.status_code==200;assert first.json()==second.json();assert first.json()['method_version']=='robust-mad-v1';assert 'amount' not in first.text
        assert client.post('/analyze-spending',json={'start':'2026-01-01'}).status_code==422
