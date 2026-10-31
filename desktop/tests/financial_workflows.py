"""Synthetic end-to-end finance and native-dialog checks through real WKWebView fetch/IPC."""
import argparse,datetime,json,os,time,uuid
from decimal import Decimal
from pathlib import Path
from native_acceptance import NativeClient

def workflows(client):
 c=client;marker='Synthetic Native '+uuid.uuid4().hex[:8];prefs=c.api('/forecast-preferences');today=prefs['asOfDate'];categories=c.api('/categories');cat=lambda name:next(x['id']for x in categories if x['name']==name)
 before=c.api('/account');amount=lambda a:Decimal(str(a['balance']))
 c.navigate('transactions','Transactions');c.command('click','Add transaction')
 for label,value in [('Description',marker),('Amount (USD)','12.34'),('Category',cat('Groceries'))]:c.command('fill',json.dumps({'label':label,'value':value}))
 c.command('click','Add transaction')
 until=time.monotonic()+15;transaction=None
 while time.monotonic()<until:
  transaction=next((t for t in c.api('/transactions') if t['description']==marker),None)
  if transaction:break
  time.sleep(.2)
 assert transaction,'Native UI transaction was not created'
 assert amount(c.api('/account'))==amount(before)-Decimal('12.34')
 c.api('/transactions/'+transaction['id'],'PUT',{'description':marker,'amount':'13.34','type':'EXPENSE','categoryId':cat('Groceries'),'date':today})
 assert amount(c.api('/account'))==amount(before)-Decimal('13.34')
 c.api('/transactions/'+transaction['id'],'DELETE');assert c.api('/account')==before
 prediction=c.api('/category-predictions','POST',{'description':'Starbucks Coffee','amount':'8.75'});assert prediction['status']=='suggested' and prediction['categoryName']==('Dining' if any(x['name']=='Dining' for x in categories) else 'Restaurants') and 0<float(prediction['confidence'])<=1
 start=(datetime.date.fromisoformat(today)-datetime.timedelta(days=2)).isoformat()
 recurring=c.api('/recurring-transactions','POST',{'description':marker+' daily','amount':'5.00','type':'EXPENSE','categoryId':cat('Groceries'),'frequency':'DAILY','paymentDay':None,'secondPaymentDay':None,'startDate':start,'endDate':None,'enabled':True,'requestId':str(uuid.uuid4()),'backfillConfirmed':True,'predictionId':None})
 account_after=c.api('/account');assert amount(account_after)==amount(before)-Decimal('15.00')
 for _ in range(2):c.api('/recurring-transactions/process-due','POST',{})
 assert c.api('/account')==account_after
 current=c.api('/recurring-transactions/'+recurring['id']);c.api('/recurring-transactions/'+recurring['id']+'/stop','POST',{'version':current['version']})
 forecast=c.api('/forecasts?months=12');insights=c.api('/insights');assert c.api('/calendar?month='+today[:7])['month']==today[:7]
 goal=c.api('/savings-goals','POST',{'name':marker+' vacation','description':'Synthetic desktop verification','targetAmount':'5000.00','targetDate':None,'requestId':str(uuid.uuid4())})
 goal=c.api('/savings-goals/'+goal['goal']['id']+'/entries','POST',{'entry':{'amount':'500.00','type':'CONTRIBUTION','bucket':'IN_ACCOUNT','date':today,'note':marker,'transactionId':None},'requestId':str(uuid.uuid4()),'version':goal['goal']['version']})
 assert goal['goal']['saved']=='500.00' and goal['goal']['progress']=='10.00'
 tomorrow=(datetime.date.fromisoformat(today)+datetime.timedelta(days=1)).isoformat()
 goal=c.api('/savings-goals/'+goal['goal']['id']+'/schedule','PUT',{'amount':'100.00','bucket':'IN_ACCOUNT','frequency':'MONTHLY','paymentDay':1,'secondPaymentDay':None,'startDate':tomorrow,'endDate':None,'enabled':True,'linkType':'NONE','linkId':None,'version':goal['goal']['version']})
 assert goal['projection']['estimatedCompletionDate'] and c.api('/forecasts?months=12')==forecast and c.api('/account')==account_after and c.api('/insights')==insights
 answer=c.api('/assistant/questions','POST',{'question':'How much have I saved toward my '+goal['goal']['name']+'?','context':None});assert answer['status']=='answered' and '500.00' in answer['text']
 def complete():
  until=time.monotonic()+90
  while time.monotonic()<until:
   status=c.api('/backups')
   if not status['busy'] and status['operation']['state']!='running':
    assert status['operation']['state']=='succeeded',status['operation'].get('stage');return status
   time.sleep(.25)
  raise RuntimeError('Native maintenance timeout')
 status=complete();external=c.base/'simulated-ssd';external.mkdir(exist_ok=True,mode=0o700);settings={**status['settings'],'externalDirectory':str(external)};c.api('/backups/settings','PUT',settings)
 c.api('/backups','POST',{});status=complete();archive=status['backups'][0]['id'];c.api('/backups/'+archive+'/verify','POST',{});complete();c.api('/backups/'+archive+'/restore-test','POST',{'confirmed':True});complete();c.api('/backups/external-copy','POST',{});assert complete()['external']['lastSuccessfulCopy']
 c.navigate('settings','Backup & Recovery')
 # Open and cancel the actual native directory sheet, without changing the setting.
 until=time.monotonic()+15
 while time.monotonic()<until:
  try:c.command('click','Choose external backup folder…');break
  except RuntimeError:time.sleep(.2)
 c.command('cancelPanel')
 previous=c.api('/backups').get('lastExport');c.command('click','Export JSON');until=time.monotonic()+90
 while time.monotonic()<until:
  status=c.api('/backups')
  if not status['busy'] and status.get('lastExport') and status['lastExport']!=previous:break
  time.sleep(.25)
 else:raise RuntimeError('Native UI export did not complete')
 export=status['lastExport']['exportId'];assert export.endswith('.json')
 c.navigate('dashboard','Financial overview');c.navigate('settings','Backup & Recovery')
 until=time.monotonic()+15
 while time.monotonic()<until:
  try:c.command('click','Download prepared export');break
  except RuntimeError:time.sleep(.25)
 time.sleep(.5);c.command('saveExport')
 destinations=[c.base/'automation/exports'/export,Path.home()/'Downloads'/export];until=time.monotonic()+15
 while not any(p.is_file()for p in destinations) and time.monotonic()<until:time.sleep(.25)
 destination=next((p for p in destinations if p.is_file()),None)
 assert destination is not None,'Native export save did not complete'
 data=json.loads(destination.read_text());assert data['savingsDataAvailable'] and 'savings_goals' in data['data'];assert destination.stat().st_mode&0o077==0
 assert not c.command('snapshot').get('errors')
 return {'native_transaction_crud':True,'actual_ai_category_prediction':True,'recurring_catchup_idempotent':True,'forecasts_calendar_insights_assistant_savings':True,'allocations_preserve_bank_forecasts':True,'manual_backup_verification_restore':True,'simulated_external_copy_verified':True,'native_directory_dialog':True,'native_export_saved':True,'renderer_errors':0,'synthetic_account':c.api('/account')}
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--profile',required=True);args=parser.parse_args();c=NativeClient(args.profile);c.ready();result=workflows(c);result.pop('synthetic_account');Path('/tmp/finsight-phase6-native-workflows-result.json').write_text(json.dumps(result));print('PASS: real WKWebView transaction CRUD/AI/recurring catch-up, forecasts/calendar/insights/assistant/savings, unchanged bank allocation semantics, native backup/restore, simulated external copies and native directory/export dialogs; zero renderer exceptions. Synthetic writes only.')
