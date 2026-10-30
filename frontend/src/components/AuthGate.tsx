import { useEffect, useRef, useState, type FormEvent } from 'react';
import App from '../App';
import { request, clearCsrf, ApiError } from '../api';

interface Session { username: string; accountId: string }
export default function AuthGate() {
  const [session,setSession]=useState<Session>();
  const [checking,setChecking]=useState(true);
  const [mode,setMode]=useState<'welcome'|'login'|'register'>('welcome');
  const [username,setUsername]=useState(''), [password,setPassword]=useState(''), [confirmation,setConfirmation]=useState('');
  const [error,setError]=useState(''), [busy,setBusy]=useState(false);
  const generation=useRef(0);
  const [dark,setDark]=useState(()=>localStorage.getItem('finsight-theme')==='dark');
  useEffect(()=>{document.documentElement.dataset.theme=dark?'dark':'light';localStorage.setItem('finsight-theme',dark?'dark':'light');},[dark]);
  useEffect(()=>{
    let live=true;
    request<Session>('/auth/me').then(value=>{if(live)setSession(value);}).catch(()=>{}).finally(()=>{if(live)setChecking(false);});
    const expire=()=>{generation.current++;setSession(undefined);setPassword('');setConfirmation('');setMode('login');setError('Your session expired. Log in to continue.');};
    window.addEventListener('finsight-session-expired',expire);
    return ()=>{live=false;window.removeEventListener('finsight-session-expired',expire);};
  },[]);
  async function submit(event:FormEvent) {
    event.preventDefault();setError('');
    if(mode==='register' && password!==confirmation){setError('Passwords do not match.');return;}
    setBusy(true);const current=++generation.current;
    try {
      const value=await request<Session>(`/auth/${mode}`,{method:'POST',body:JSON.stringify({username,password,...(mode==='register'?{confirmPassword:confirmation}:{})})});
      clearCsrf();setPassword('');setConfirmation('');if(current===generation.current)setSession(value);
    } catch(e){setError((e as Error).message);} finally{setBusy(false);}
  }
  async function logout() {
    try {await request('/auth/logout',{method:'POST',body:'{}'});} catch(e) {if(!(e instanceof ApiError)||e.status!==401)throw e;}
    setDark(localStorage.getItem('finsight-theme')==='dark');
    generation.current++;clearCsrf();setSession(undefined);setUsername('');setPassword('');setConfirmation('');setMode('welcome');setError('');location.hash='';
  }
  if(checking)return <main className="auth-shell"><p role="status">Checking your local session…</p></main>;
  if(session)return <App key={`${session.accountId}-${generation.current}`} username={session.username} onLogout={logout}/>;
  return <main className="auth-shell"><section className="auth-card">
    <button className="auth-theme" onClick={()=>setDark(!dark)}>{dark?'Light mode':'Dark mode'}</button>
    <h1>Welcome to FinSight AI</h1><p>Your finances stay on this Mac. Log in to view your account.</p>
    {error&&<p role="alert">{error}</p>}
    {mode==='welcome'?<div className="auth-actions"><button onClick={()=>setMode('register')}>Create Account</button><button onClick={()=>setMode('login')}>Log In</button></div>:
    <form onSubmit={submit}>
      <h2>{mode==='register'?'Create Account':'Log In'}</h2>
      <label>Username<input autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={32} pattern="[A-Za-z][A-Za-z0-9_]{2,31}" value={username} onChange={e=>setUsername(e.target.value)}/></label>
      {mode==='register'&&<small>3–32 letters, digits or underscores; start with a letter. Usernames ignore case.</small>}
      <label>Password<input type="password" autoComplete={mode==='register'?'new-password':'current-password'} required minLength={mode==='register'?12:undefined} maxLength={1024} value={password} onChange={e=>setPassword(e.target.value)}/></label>
      {mode==='register'&&<><small>Use at least 12 characters. Long passwords and password managers are welcome.</small><label>Confirm Password<input type="password" autoComplete="new-password" required maxLength={1024} value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label><p>Your new account starts at $0.00 with no financial records or categories.</p></>}
      <button disabled={busy}>{busy?'Please wait…':mode==='register'?'Create Account':'Log In'}</button>
      <button type="button" disabled={busy} onClick={()=>{setMode('welcome');setError('');setPassword('');setConfirmation('');}}>Back</button>
    </form>}
  </section></main>;
}
