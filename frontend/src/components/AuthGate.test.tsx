// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AuthGate from './AuthGate';
import { clearCsrf, request } from '../api';

vi.mock('../App',()=>({default:({username,onLogout}:{username:string;onLogout:()=>Promise<void>})=><div><p>Private dashboard for {username}</p><button onClick={()=>void onLogout()}>Log out</button></div>}));
let calls:{path:string;init?:RequestInit}[];
let loggedIn=false;
let rejectLogin=false;
const response=(value:unknown,status=200)=>new Response(status===204?null:JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
beforeEach(()=>{
  clearCsrf();calls=[];loggedIn=false;rejectLogin=false;localStorage.clear();location.hash='';
  vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
    calls.push({path,init});
    if(path==='/api/auth/csrf')return response({token:'synthetic-token'});
    if(path==='/api/auth/me')return loggedIn?response({username:'personal',accountId:'a'}):response({},401);
    if(path==='/api/auth/logout'){loggedIn=false;return response(null,204);}
    if(path==='/api/auth/login'||path==='/api/auth/register'){
      if(rejectLogin)return response({detail:'Invalid username or password'},401);
      loggedIn=true;return response({username:'personal',accountId:'a'},path.endsWith('register')?201:200);
    }
    return response({},401);
  }));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
async function form(mode='Log In'){
  await screen.findByText('Welcome to FinSight AI');fireEvent.click(screen.getByRole('button',{name:mode}));
  fireEvent.change(screen.getByLabelText('Username'),{target:{value:'personal'}});
  fireEvent.change(screen.getByLabelText('Password'),{target:{value:'My synthetic password'}});
}
it('shows welcome without fetching financial records',async()=>{
  render(<AuthGate/>);await screen.findByText('Welcome to FinSight AI');
  expect(screen.queryByText(/Private dashboard/)).toBeNull();
  expect(calls.map(c=>c.path)).toEqual(['/api/auth/me']);
});
it('registers with confirmation and a CSRF header before showing the dashboard',async()=>{
  render(<AuthGate/>);await form('Create Account');
  fireEvent.change(screen.getByLabelText('Confirm Password'),{target:{value:'My synthetic password'}});
  fireEvent.click(screen.getByRole('button',{name:'Create Account'}));await screen.findByText('Private dashboard for personal');
  const call=calls.find(c=>c.path==='/api/auth/register')!;
  expect(JSON.parse(call.init!.body as string)).toEqual({username:'personal',password:'My synthetic password',confirmPassword:'My synthetic password'});
  expect(call.init!.headers).toMatchObject({'X-CSRF-TOKEN':'synthetic-token'});
  expect(localStorage.getItem('password')).toBeNull();expect(localStorage.getItem('token')).toBeNull();
});
it('validates confirmation without sending registration',async()=>{
  render(<AuthGate/>);await form('Create Account');fireEvent.change(screen.getByLabelText('Confirm Password'),{target:{value:'Different password'}});
  fireEvent.click(screen.getByRole('button',{name:'Create Account'}));await screen.findByRole('alert');expect(calls.some(c=>c.path==='/api/auth/register')).toBe(false);
});
it('logs in and removes all financial components on logout',async()=>{
  render(<AuthGate/>);await form();fireEvent.click(screen.getByRole('button',{name:'Log In'}));await screen.findByText('Private dashboard for personal');
  fireEvent.click(screen.getByRole('button',{name:'Log out'}));await screen.findByText('Welcome to FinSight AI');expect(screen.queryByText(/Private dashboard/)).toBeNull();
});
it('does not mount a dashboard when credentials fail',async()=>{
  rejectLogin=true;render(<AuthGate/>);await form();fireEvent.click(screen.getByRole('button',{name:'Log In'}));await screen.findByText('Invalid username or password');expect(screen.queryByText(/Private dashboard/)).toBeNull();
});
it('unmounts financial state when the server session expires',async()=>{
  loggedIn=true;render(<AuthGate/>);await screen.findByText('Private dashboard for personal');loggedIn=false;
  await request('/account').catch(()=>{});await screen.findByText('Your session expired. Log in to continue.');expect(screen.queryByText(/Private dashboard/)).toBeNull();
});
it('restores only a validated session and supports dark mode on welcome',async()=>{
  loggedIn=true;const view=render(<AuthGate/>);await screen.findByText('Private dashboard for personal');view.unmount();loggedIn=false;
  render(<AuthGate/>);await screen.findByText('Welcome to FinSight AI');fireEvent.click(screen.getByRole('button',{name:'Dark mode'}));
  await waitFor(()=>expect(document.documentElement.dataset.theme).toBe('dark'));
});
