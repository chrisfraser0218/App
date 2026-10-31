"""Real WKWebView authentication acceptance; accepts only the existing guarded synthetic profile."""
import argparse
import json
from pathlib import Path
import time
import uuid
from native_acceptance import NativeClient
from financial_workflows import workflows

def wait_title(client,title):
    deadline=time.monotonic()+30
    while time.monotonic()<deadline:
        snapshot=client.command('snapshot')
        if snapshot.get('title')==title and 'Loading your financial picture' not in snapshot.get('text',''):return
        time.sleep(.2)
    raise RuntimeError('Native authentication screen did not render: '+title)

def sign_in(client,username,password,register=False):
    wait_title(client,'Welcome to FinSight AI')
    action='Create Account' if register else 'Log In'
    client.command('click',action)
    for label,value in [('Username',username),('Password',password)]+([('Confirm Password',password)] if register else []):
        client.command('fill',json.dumps({'label':label,'value':value}))
    client.command('click',action)
    wait_title(client,'Financial overview')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--profile',required=True);parser.add_argument('--app',required=True);args=parser.parse_args()
    c=NativeClient(args.profile);c.ready();wait_title(c,'Welcome to FinSight AI')
    rejected=c.command('api',json.dumps({'path':'/account'}));assert rejected['status']==401
    username='native_'+uuid.uuid4().hex[:12];password='Synthetic native password 6B'
    sign_in(c,username,password,register=True)
    account=c.api('/account');assert str(account['balance']) in ('0','0.0','0.00') and str(account['startingBalance']) in ('0','0.0','0.00')
    for route in ['/transactions','/recurring-transactions','/planned-transactions']:assert c.api(route)==[]
    assert c.api('/savings-goals')['goals']==[]
    assert len(c.api('/categories'))==20
    c.navigate('transactions','Transactions');c.command('reload');time.sleep(.5);wait_title(c,'Transactions')
    # Exercise the unseeded account through the actual transaction form and bundled model.
    c.command('click','Add transaction')
    for label,value in [('Description','Starbucks Coffee'),('Amount (USD)','8.75')]:
        c.command('fill',json.dumps({'label':label,'value':value}))
    deadline=time.monotonic()+20
    while time.monotonic()<deadline:
        if 'Use suggestion' in c.command('snapshot').get('text',''):break
        time.sleep(.2)
    else:raise RuntimeError('Default-category AI suggestion did not appear in native UI')
    c.command('click','Use suggestion')
    groceries=next(category['id'] for category in c.api('/categories') if category['name']=='Groceries')
    c.command('fill',json.dumps({'label':'Category','value':groceries}))
    c.command('click','Add transaction')
    deadline=time.monotonic()+15
    while time.monotonic()<deadline:
        saved=c.api('/transactions')
        if saved:break
        time.sleep(.2)
    assert len(saved)==1 and saved[0]['categoryId']==groceries
    assert str(c.api('/account')['balance'])=='-8.75'
    c.api('/transactions/'+saved[0]['id'],'DELETE')
    result=workflows(c);result.pop('synthetic_account',None)
    before=c.api('/account');records=c.api('/transactions');goals=c.api('/savings-goals')
    c.command('click','Log out');wait_title(c,'Welcome to FinSight AI')
    sign_in(c,username,password)
    assert c.api('/account')==before and c.api('/transactions')==records
    c.command('quit');time.sleep(1)
    c.launch(Path(args.app));wait_title(c,'Welcome to FinSight AI')
    assert c.command('api',json.dumps({'path':'/account'}))['status']==401
    sign_in(c,username,password)
    assert c.api('/account')==before and c.api('/transactions')==records and c.api('/savings-goals')==goals
    c.command('click','Log out');wait_title(c,'Welcome to FinSight AI')
    other='native_'+uuid.uuid4().hex[:12];sign_in(c,other,password,register=True)
    assert c.api('/transactions')==[] and c.api('/savings-goals')['goals']==[]
    assert c.command('api',json.dumps({'path':'/transactions/'+records[0]['id']}))['status']==404
    c.command('click','Log out');wait_title(c,'Welcome to FinSight AI')
    sign_in(c,username,password)
    assert c.api('/transactions')==records
    assert not c.command('snapshot').get('errors')
    result.update(native_empty_registration=True,native_login_logout=True,native_account_isolation=True,native_restart_login_persistence=True,ephemeral_session_requires_login_after_restart=True)
    Path('/tmp/finsight-6b-native-result.json').write_text(json.dumps(result))
    print('PASS: real WKWebView empty registration, authenticated financial/AI/backup workflows, logout/login, account isolation, quit/reopen/login and record persistence; zero renderer errors. Synthetic data only.')
    c.command('quit')

if __name__=='__main__':main()
