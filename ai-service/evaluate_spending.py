"""Controlled synthetic benchmark only. No real transactions, training or persistence of user data."""
from datetime import date,timedelta
from uuid import UUID
from pathlib import Path
import json,random
import numpy as np
from sklearn.ensemble import IsolationForest
from app.spending import Expense,SpendingRequest,analyze

def measure(rows):
    tp=sum(y and p for y,p,_ in rows);fp=sum(not y and p for y,p,_ in rows);fn=sum(y and not p for y,p,_ in rows);tn=sum(not y and not p for y,p,_ in rows)
    return dict(cases=len(rows),true_positive=tp,false_positive=fp,false_negative=fn,true_negative=tn,precision=tp/(tp+fp) if tp+fp else None,recall=tp/(tp+fn) if tp+fn else None,false_positive_rate=fp/(fp+tn) if fp+tn else None,coverage=sum(eligible for _,_,eligible in rows)/len(rows) if rows else 0)

def evaluate():
    rng=random.Random(1303);groups={};forest=[]
    for name,n,spread,base,spike in [('steady',16,100,2000,20000),('flat',12,0,1000,15000),('limited',4,100,2000,20000),('uneven',24,8000,10000,30000),('small_amount',12,25,200,3000),('rich_history',64,500,5000,30000)]:
        cases=[]
        for i in range(40):
            abnormal=i%2==1;values=[max(50,base+rng.randint(-spread,spread)) for _ in range(n)]
            target=spike if abnormal else max(50,base+rng.randint(-spread,spread))
            entries=[Expense(id=UUID(int=j+1),date=date(2026,7,1)+timedelta(days=j),amount_cents=a,category_id=UUID(int=1)) for j,a in enumerate(values)]
            entries.append(Expense(id=UUID(int=1000),date=date(2026,10,1),amount_cents=target,category_id=UUID(int=1)))
            result=analyze(SpendingRequest(start=date(2026,10,1),end=date(2026,10,1),expenses=entries));cases.append((abnormal,bool(result.alerts),result.eligible>0))
            if n>=32:
                # Offline comparison only. Personal runtime never fits this model or assumes it is superior.
                model=IsolationForest(n_estimators=50,contamination=.05,random_state=1303).fit(np.log1p(np.array(values)).reshape(-1,1))
                forest.append((abnormal,bool(model.predict(np.log1p([[target]]))[0]==-1),True))
        groups[name]=measure(cases)
    counts={k:sum(g[k] for g in groups.values()) for k in ['cases','true_positive','false_positive','false_negative','true_negative']}
    tp,fp,fn,tn=[counts[k] for k in ['true_positive','false_positive','false_negative','true_negative']]
    return {'dataset':'synthetic-controlled-v1','seed':1303,'runtime_method':'causal-robust-mad-v1','overall':{**counts,'precision':tp/(tp+fp) if tp+fp else None,'recall':tp/(tp+fn),'false_positive_rate':fp/(fp+tn)},'by_regime':groups,'offline_isolation_forest_rich_history':measure(forest),'limitations':['Synthetic labels are constructed expectations, not verified fraud or real-world ground truth.','Fixed thresholds intentionally abstain on limited data and miss small-dollar/uneven spikes.','One-dimensional Isolation Forest comparison is a limited synthetic benchmark, not evidence for production superiority.','No personal-data training, online retraining, probability calibration or real-world accuracy claim.']}
if __name__=='__main__':
    report=evaluate();path=Path(__file__).parent/'evaluation/spending-v1.json';path.parent.mkdir(exist_ok=True);path.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
