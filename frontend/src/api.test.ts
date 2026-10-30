// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError, clearCsrf, prepareCsrf, request } from './api';

afterEach(()=>{vi.unstubAllGlobals();clearCsrf();});
it('does not expire a newer session when an old request returns unauthorized',async()=>{
  let complete!:(response:Response)=>void;
  vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{complete=resolve;})));
  const expired=vi.fn();window.addEventListener('finsight-session-expired',expired);
  const pending=request('/account');clearCsrf();
  complete(new Response('{}',{status:401}));await expect(pending).rejects.toBeInstanceOf(ApiError);
  expect(expired).not.toHaveBeenCalled();window.removeEventListener('finsight-session-expired',expired);
});
it('clears financial state if session validation fails during CSRF preparation',async()=>{
  clearCsrf();vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:401})));
  const expired=vi.fn();window.addEventListener('finsight-session-expired',expired);
  await expect(prepareCsrf()).rejects.toBeInstanceOf(ApiError);expect(expired).toHaveBeenCalledTimes(1);
  window.removeEventListener('finsight-session-expired',expired);
});
it('refreshes a rejected login CSRF token on explicit retry without replaying the request',async()=>{
  clearCsrf();
  const fetcher=vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({token:'old-token'}),{status:200}))
    .mockResolvedValueOnce(new Response('{}',{status:403}))
    .mockResolvedValueOnce(new Response(JSON.stringify({token:'fresh-token'}),{status:200}))
    .mockResolvedValueOnce(new Response(JSON.stringify({username:'synthetic'}),{status:200}));
  vi.stubGlobal('fetch',fetcher);
  const input={method:'POST',body:JSON.stringify({username:'synthetic',password:'Synthetic password'})};
  await expect(request('/auth/login',input)).rejects.toMatchObject({status:403});
  expect(fetcher).toHaveBeenCalledTimes(2);
  await expect(request('/auth/login',input)).resolves.toEqual({username:'synthetic'});
  expect(fetcher.mock.calls[3][1].headers).toMatchObject({'X-CSRF-TOKEN':'fresh-token'});
});
