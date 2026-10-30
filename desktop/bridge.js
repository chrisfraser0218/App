/* Native session credentials never enter the renderer. Only the fixed local API is bridged. */
(() => {
  const pending = new Map(); let next = 1;
  const documentId=crypto.randomUUID();
  window.__finsightErrors=[];
  addEventListener('error',e=>window.__finsightErrors.push(String(e.message)));
  addEventListener('unhandledrejection',e=>window.__finsightErrors.push(String(e.reason?.message||'Unhandled local error')));
  window.__finsightResolve = (id, response) => {
    const p = pending.get(id); if (!p) return; pending.delete(id);
    if (response.error) { p.reject(new TypeError(response.error)); return; }
    if (response.directory !== undefined) { p.resolve(response.directory); return; }
    const bytes = Uint8Array.from(atob(response.body || ''), c => c.charCodeAt(0));
    p.resolve(new Response([204,205,304].includes(response.status) ? null : bytes, {status:response.status,headers:response.headers}));
  };
  const send = (message, signal) => new Promise((resolve,reject) => {
    const id=documentId+'-'+String(next++); if(signal?.aborted){reject(new DOMException('Aborted','AbortError'));return;}
    pending.set(id,{resolve,reject});
    signal?.addEventListener('abort',()=>{pending.delete(id);window.webkit.messageHandlers.finsight.postMessage({action:'cancel',id});reject(new DOMException('Aborted','AbortError'));},{once:true});
    window.webkit.messageHandlers.finsight.postMessage({...message,id});
  });
  const originalFetch=window.fetch.bind(window);
  window.fetch=async(input,init={})=>{
    const request=input instanceof Request?input:null;
    const url=new URL(request?request.url:String(input),location.href);
    if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))return originalFetch(input,init);
    const method=(init.method||request?.method||'GET').toUpperCase();
    const body=init.body!==undefined?init.body:(request&&!['GET','HEAD'].includes(method)?await request.clone().text():null);
    if(body!==null&&typeof body!=='string')throw new TypeError('Only JSON local requests are supported');
    return send({action:'api',path:url.pathname+url.search,method,body},init.signal||request?.signal);
  };
  window.finsightDesktop={chooseBackupDirectory:()=>send({action:'directory'})};
  const originalSet=Storage.prototype.setItem;
  Storage.prototype.setItem=function(key,value){originalSet.call(this,key,value);if(this===localStorage&&key==='finsight-theme'&&['light','dark'].includes(String(value)))window.webkit.messageHandlers.finsight.postMessage({action:'theme',value:String(value)});};
})();
