import { useState, type FormEvent } from 'react';
import { request, type TransactionType } from '../api';

export default function CategorySetup({onCreated}:{onCreated:()=>void}) {
  const [open,setOpen]=useState(false),[name,setName]=useState(''),[type,setType]=useState<TransactionType>('EXPENSE');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function create(e:FormEvent) {
    e.preventDefault();setError('');setBusy(true);
    try {await request('/categories',{method:'POST',body:JSON.stringify({name,type})});setName('');onCreated();setOpen(false);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <section className="category-setup"><button onClick={()=>setOpen(!open)}>Add a category</button>{open&&<form onSubmit={create}>
    <p>Choose your own categories before recording income or expenses. No demo categories are copied.</p>
    <label>Category name<input value={name} onChange={e=>setName(e.target.value)} required maxLength={60}/></label>
    <label>Category type<select value={type} onChange={e=>setType(e.target.value as TransactionType)}><option value="EXPENSE">Expense</option><option value="INCOME">Income</option></select></label>
    {error&&<p role="alert">{error}</p>}<button disabled={busy}>Save category</button>
  </form>}</section>;
}
