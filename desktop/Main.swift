import AppKit
@preconcurrency import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKScriptMessageHandler, WKDownloadDelegate {
 var window:NSWindow!; var web:WKWebView?; var supervisor:Process?; var input:Pipe?; var timer:Timer?
 var terminationReplied=false; var stateURL:URL!; var base:URL!; var resources:URL!; var token=""; var port=18480; var quitting=false; var shownReady=false; var shownError=false
 var label:NSTextField!; var spinner:NSProgressIndicator!; var retry:NSButton!; var tasks:[String:URLSessionDataTask]=[:]
 var verificationExport:((URL?)->Void)?
 var nativePanel:NSSavePanel?; var profile:String?; var readOnly=false; var test=false; var automationRoot:URL?;var seenCommand="";var sessionInstance=""
 let http:URLSession={let c=URLSessionConfiguration.ephemeral;c.urlCache=nil;c.timeoutIntervalForRequest=65;return URLSession(configuration:c)}()
 func applicationDidFinishLaunching(_ n:Notification){
  resources=Bundle.main.resourceURL!;base=FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/FinSight AI")
  let args=CommandLine.arguments
  if let i=args.firstIndex(of:"--verification-profile"),i+1<args.count {profile=args[i+1];test=true
   do {let u=URL(fileURLWithPath:profile!).resolvingSymlinksInPath();guard u.path.hasPrefix("/private/tmp/finsight-desktop-test-")||u.path.hasPrefix("/tmp/finsight-desktop-test-") else{throw NSError(domain:"Invalid verification profile",code:1)};let a=try FileManager.default.attributesOfItem(atPath:u.path);guard ((a[.posixPermissions] as? NSNumber)?.intValue ?? 511) & 0o077 == 0 else{throw NSError(domain:"Private verification profile required",code:1)};let p=try JSONSerialization.jsonObject(with:Data(contentsOf:u)) as! [String:Any];base=URL(fileURLWithPath:p["dataHome"] as! String).resolvingSymlinksInPath();guard base.path.hasPrefix("/private/tmp/finsight-desktop-test-")||base.path.hasPrefix("/tmp/finsight-desktop-test-") else{throw NSError(domain:"Synthetic data path required",code:1)};automationRoot=base.appendingPathComponent("automation");try FileManager.default.createDirectory(at:automationRoot!,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])}catch{fatalAlert("Invalid private synthetic verification profile.");return}
  }
  readOnly=args.contains("--read-only-acceptance")
  window=NSWindow(contentRect:NSRect(x:0,y:0,width:1240,height:860),styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false);window.title="FinSight AI"+(test ? " — Synthetic Verification" : readOnly ? " — Read-only Verification" : "");window.minSize=NSSize(width:640,height:560);window.center();window.setFrameAutosaveName("FinSightMainWindow");window.delegate=self
  menus();showLoading("Starting your local financial workspace…");window.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true);start()
 }
 func menus(){let menu=NSMenu();NSApp.mainMenu=menu;let app=NSMenuItem(title:"FinSight AI",action:nil,keyEquivalent:"");menu.addItem(app);let a=NSMenu();app.submenu=a;a.addItem(withTitle:"About FinSight AI",action:#selector(about),keyEquivalent:"").target=self;a.addItem(.separator());a.addItem(withTitle:"Hide FinSight AI",action:#selector(NSApplication.hide(_:)),keyEquivalent:"h");a.addItem(.separator());a.addItem(withTitle:"Quit FinSight AI",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q")
  let edit=NSMenuItem(title:"Edit",action:nil,keyEquivalent:"");menu.addItem(edit);edit.submenu=NSMenu(title:"Edit");for(title,selector,key) in [("Undo","undo:","z"),("Redo","redo:","Z"),("Cut","cut:","x"),("Copy","copy:","c"),("Paste","paste:","v"),("Select All","selectAll:","a")]{edit.submenu!.addItem(withTitle:title,action:Selector(selector),keyEquivalent:key)}
  let view=NSMenuItem(title:"View",action:nil,keyEquivalent:"");menu.addItem(view);view.submenu=NSMenu(title:"View");view.submenu!.addItem(withTitle:"Reload Workspace",action:#selector(reload),keyEquivalent:"r").target=self;view.submenu!.addItem(withTitle:"Show Local Data Folder",action:#selector(showData),keyEquivalent:"").target=self
 }
 @objc func about(){NSApp.orderFrontStandardAboutPanel(options:[.applicationName:"FinSight AI",.applicationVersion:"0.6.1",.credits:NSAttributedString(string:"Private, offline personal finance. Native macOS shell with React, Java, PostgreSQL and local Python AI. No cloud services.")])}
 @objc func reload(){web?.reload()}
 @objc func showData(){NSWorkspace.shared.open(base)}
 func showLoading(_ text:String){let root=NSView();window.contentView=root;label=NSTextField(wrappingLabelWithString:text);label.alignment = .center;label.font = .systemFont(ofSize:17);spinner=NSProgressIndicator();spinner.style = .spinning;spinner.startAnimation(nil);retry=NSButton(title:"Retry Startup",target:self,action:#selector(retryStartup));retry.isHidden=true
  let stack=NSStackView(views:[spinner,label,retry]);stack.orientation = .vertical;stack.spacing=24;stack.translatesAutoresizingMaskIntoConstraints=false;root.addSubview(stack);NSLayoutConstraint.activate([stack.centerXAnchor.constraint(equalTo:root.centerXAnchor),stack.centerYAnchor.constraint(equalTo:root.centerYAnchor),stack.widthAnchor.constraint(lessThanOrEqualToConstant:600),stack.widthAnchor.constraint(lessThanOrEqualTo:root.widthAnchor,multiplier:0.85)])
 }
 func fatalAlert(_ text:String){let alert=NSAlert();alert.messageText="FinSight AI could not start";alert.informativeText=text;alert.runModal();NSApp.terminate(nil)}
 @objc func retryStartup(){guard supervisor?.isRunning != true else{return};shownReady=false;shownError=false;web=nil;showLoading("Retrying local services…");start()}
 func start(){do{
  let desktop=base.appendingPathComponent("desktop");try FileManager.default.createDirectory(at:desktop,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700]);stateURL=desktop.appendingPathComponent("session-"+UUID().uuidString.replacingOccurrences(of:"-",with:"").lowercased()+".json")
  let p=Process();p.executableURL=resources.appendingPathComponent("python/Python.framework/Versions/3.11/bin/python3.11");var args=[resources.appendingPathComponent("supervisor.py").path,"--resources",resources.path,"--state",stateURL.path,"--parent",String(ProcessInfo.processInfo.processIdentifier)];if let profile=profile{args += ["--profile",profile]};if readOnly{args += ["--read-only"]};p.arguments=args
  p.environment=["HOME":FileManager.default.homeDirectoryForCurrentUser.path,"PATH":"/usr/bin:/bin:/usr/sbin:/sbin","PYTHONHOME":resources.appendingPathComponent("python/Python.framework/Versions/3.11").path,"PYTHONPATH":resources.appendingPathComponent("site-packages").path,"PYTHONNOUSERSITE":"1","PYTHONDONTWRITEBYTECODE":"1"]
  let pipe=Pipe();input=pipe;p.standardInput=pipe;p.standardOutput=FileHandle.nullDevice;p.standardError=FileHandle.nullDevice;supervisor=p;p.terminationHandler={ [weak self] _ in DispatchQueue.main.async {guard let self=self else{return};if self.quitting{self.finishQuit()}else{self.poll()}}};try p.run()
  timer?.invalidate();let nextTimer=Timer(timeInterval:0.25,repeats:true){[weak self]_ in self?.poll()};timer=nextTimer;RunLoop.main.add(nextTimer,forMode:.common);RunLoop.main.add(nextTimer,forMode:.modalPanel)
 }catch{label.stringValue="The bundled local runtime could not start. No database was reset. Rebuild or reinstall this application bundle.";spinner.stopAnimation(nil);retry.isHidden=false}}
 func poll(){
  if let data=try? Data(contentsOf:stateURL),let state=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any],let status=state["status"] as? String{
   sessionInstance=state["instance"] as? String ?? ""
   if status=="ready" && !shownReady {token=state["token"] as? String ?? "";port=state["port"] as? Int ?? 18480;if token.count==64{shownReady=true;loadWorkspace()}}
   else if status=="error" && !shownError {shownError=true;showLoading(state["message"] as? String ?? "Local startup failed. Your data was not reset.");spinner.stopAnimation(nil);retry.isHidden=false}
   else if status=="starting" && !shownReady {label.stringValue=state["message"] as? String ?? "Starting local services…"}
   else if status=="stopping" && quitting {label.stringValue=state["message"] as? String ?? "Closing safely…"}
  }
  if supervisor?.isRunning==false {if quitting{finishQuit()}else if !shownError{shownError=true;showLoading("Local services stopped. Data and backups were not reset. Retry to restart safely.");spinner.stopAnimation(nil);retry.isHidden=false}}
  if test && !sessionInstance.isEmpty && !quitting {automation()}
 }
 func loadWorkspace(){let c=WKWebViewConfiguration();c.websiteDataStore = .nonPersistent();c.userContentController.add(self,name:"finsight")
  let theme=UserDefaults.standard.string(forKey:"workspaceTheme") ?? (NSApp.effectiveAppearance.name == .darkAqua ? "dark":"light");let initial="localStorage.setItem('finsight-theme',"+String(data:try! JSONSerialization.data(withJSONObject:theme,options:.fragmentsAllowed),encoding:.utf8)!+");"
  let bridge=(try? String(contentsOf:resources.appendingPathComponent("bridge.js"),encoding:.utf8)) ?? ""
  c.userContentController.addUserScript(WKUserScript(source:initial+bridge,injectionTime:.atDocumentStart,forMainFrameOnly:true));let v=WKWebView(frame:.zero,configuration:c);web=v;v.navigationDelegate=self;v.autoresizingMask=[.width,.height];window.contentView=v;v.load(URLRequest(url:URL(string:"http://127.0.0.1:\(port)/")!))
 }
 func allowed(_ path:String)->Bool{guard path.utf8.count<4096,let decoded=path.removingPercentEncoding,!decoded.contains(".."),!decoded.contains("\\"),!decoded.contains("\0") else{return false};return path.range(of:"^/api/(auth|account|categories|transactions|summaries|category-predictions|recurring-transactions|forecasts|forecast-preferences|planned-transactions|calendar|backups|insights|assistant|savings-goals)(?:[/?]|$)",options:.regularExpression) != nil}
 func reply(_ id:String,_ response:[String:Any]){web?.callAsyncJavaScript("window.__finsightResolve(id, response)",arguments:["id":id,"response":response],in:nil,in:.page,completionHandler:nil)}
 func userContentController(_ c:WKUserContentController,didReceive message:WKScriptMessage){guard message.frameInfo.isMainFrame,let data=message.body as? [String:Any],let action=data["action"] as? String else{return}
  if action=="theme",let value=data["value"] as? String,["light","dark"].contains(value){UserDefaults.standard.set(value,forKey:"workspaceTheme");return}
  guard let id=data["id"] as? String,id.count<64 else{return}
  if quitting{reply(id,["error":"The application is closing safely"]);return}
  if action=="cancel"{tasks.removeValue(forKey:id)?.cancel();return}
  if action=="directory"{let panel=NSOpenPanel();nativePanel=panel;panel.canChooseDirectories=true;panel.canChooseFiles=false;panel.canCreateDirectories=true;panel.prompt="Choose Backup Folder";panel.beginSheetModal(for:window){result in self.nativePanel=nil;self.reply(id,["directory":result == .OK ? (panel.url?.path ?? "") as Any : NSNull()])};return}
  guard action=="api",let path=data["path"] as? String,allowed(path),let method=data["method"] as? String,["GET","HEAD","POST","PUT","DELETE"].contains(method),!token.isEmpty else{reply(id,["error":"Unsupported local request"]);return}
  let body=data["body"] as? String;if let body=body,body.utf8.count>1024*1024{reply(id,["error":"Local request is too large"]);return}
  var req=URLRequest(url:URL(string:"http://127.0.0.1:\(port)"+path)!);req.httpMethod=method;req.httpBody=body?.data(using:.utf8);req.setValue("application/json",forHTTPHeaderField:"Content-Type");req.setValue(token,forHTTPHeaderField:"X-FinSight-Session");req.setValue("http://127.0.0.1:\(port)",forHTTPHeaderField:"Origin")
  if let csrf=data["csrf"] as? String,csrf.utf8.count<=512{req.setValue(csrf,forHTTPHeaderField:"X-CSRF-TOKEN")}
  let task=http.dataTask(with:req){bytes,response,error in DispatchQueue.main.async{self.tasks.removeValue(forKey:id);guard error==nil,let response=response as? HTTPURLResponse,let bytes=bytes,bytes.count<=64*1024*1024 else{self.reply(id,["error":"Local financial service unavailable or response too large. Retry after it is ready."]);return};var headers=[String:String]();for name in ["Content-Type","Content-Disposition","Cache-Control"]{if let value=response.value(forHTTPHeaderField:name){headers[name]=value}};self.reply(id,["status":response.statusCode,"headers":headers,"body":bytes.base64EncodedString()])}}
  tasks[id]=task;task.resume()
 }
 func webView(_ webView:WKWebView,decidePolicyFor action:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void){guard let url=action.request.url else{decisionHandler(.cancel);return}
  if url.scheme=="blob" && action.shouldPerformDownload{decisionHandler(.download);return}
  guard url.scheme=="http",url.host=="127.0.0.1",url.port==port else{decisionHandler(.cancel);return}
  if url.path.hasPrefix("/api/"){decisionHandler(.cancel);if url.path.range(of:"^/api/backups/exports/export-[a-f0-9]{32}\\.(json|zip)$",options:.regularExpression) != nil{saveExport(url)};return}
  decisionHandler(.allow)
 }
 func saveExport(_ url:URL){
  var req=URLRequest(url:url);req.setValue(token,forHTTPHeaderField:"X-FinSight-Session")
  http.dataTask(with:req){data,response,error in
   guard error==nil,(response as? HTTPURLResponse)?.statusCode==200,let data=data else{return}
   DispatchQueue.main.async{
    let panel=NSSavePanel();self.nativePanel=panel;panel.nameFieldStringValue=url.lastPathComponent
    let finish:(URL?)->Void={target in
     self.verificationExport=nil
     guard let target=target else{return}
     do{try data.write(to:target,options:.atomic);try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:target.path)}
     catch{let a=NSAlert();a.messageText="Export could not be saved";a.informativeText="Choose a writable local folder and retry.";a.beginSheetModal(for:self.window)}
    }
    if self.test{self.verificationExport=finish}
    panel.beginSheetModal(for:self.window){result in self.nativePanel=nil;finish(result == .OK ? panel.url:nil)}
   }
  }.resume()
 }
 func webView(_ webView:WKWebView,navigationAction:WKNavigationAction,didBecome download:WKDownload){download.delegate=self}
 func download(_ download:WKDownload,decideDestinationUsing response:URLResponse,suggestedFilename:String,completionHandler:@escaping(URL?)->Void){let panel=NSSavePanel();panel.nameFieldStringValue=URL(fileURLWithPath:suggestedFilename).lastPathComponent;panel.beginSheetModal(for:window){result in completionHandler(result == .OK ? panel.url:nil)}}
 func windowShouldClose(_ sender:NSWindow)->Bool{NSApp.terminate(nil);return false}
 func finishQuit(){guard !terminationReplied else{return};terminationReplied=true;timer?.invalidate();try? FileManager.default.removeItem(at:stateURL);NSApp.reply(toApplicationShouldTerminate:true)}
 func applicationShouldTerminate(_ sender:NSApplication)->NSApplication.TerminateReply{if supervisor?.isRunning != true{return .terminateNow};quitting=true;showLoading("Finishing local operations before quitting…");try? input?.fileHandleForWriting.write(contentsOf:Data("quit\n".utf8));return .terminateLater}
 func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool{return true}
 func applicationShouldHandleReopen(_ sender:NSApplication,hasVisibleWindows:Bool)->Bool{window?.makeKeyAndOrderFront(nil);return true}
 // Only an explicitly isolated synthetic profile enables this fixed-operation acceptance harness.
 func automation(){guard let root=automationRoot,let data=try? Data(contentsOf:root.appendingPathComponent("command.json")),let command=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any],let id=command["id"] as? String,id != seenCommand,command["instance"] as? String == sessionInstance else{return};seenCommand=id
  let action=command["action"] as? String ?? "";let script:String
  if action=="status"{writeAutomation(root,id,["result":["ready":shownReady,"error":shownError,"message":label?.stringValue ?? "","panel":nativePanel != nil]]);return}
  if action=="retry"{retryStartup();writeAutomation(root,id,["result":true]);return}
  if action=="reload"{writeAutomation(root,id,["result":true]);DispatchQueue.main.async{self.reload()};return}
  if action=="quit"{writeAutomation(root,id,["result":true]);DispatchQueue.main.async{NSApp.terminate(nil)};return}
  if action=="cancelPanel"{nativePanel?.cancel(nil);writeAutomation(root,id,["result":true]);return}
  if action=="saveExport"{
   guard let panel=nativePanel,let finish=verificationExport,
    panel.nameFieldStringValue.range(of:"^export-[a-f0-9]{32}\\.(json|zip)$",options:.regularExpression) != nil
    else{writeAutomation(root,id,["error":"No owned export panel"]);return}
   let folder=root.appendingPathComponent("exports")
   do{try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])}
   catch{writeAutomation(root,id,["error":"Synthetic export destination unavailable"]);return}
   let destination=folder.appendingPathComponent(panel.nameFieldStringValue)
   // Test-only fixed destination exercises the same writer after rendering the real panel.
   // Ending a sheet programmatically does not establish NSSavePanel.url on every macOS version.
   verificationExport=nil;window.endSheet(panel,returnCode:.cancel);nativePanel=nil;finish(destination)
   writeAutomation(root,id,["result":true]);return
  }

  switch action{
   case "snapshot":script="return {hash:location.hash,title:document.querySelector('h1')?.textContent,text:document.body.innerText,errors:window.__finsightErrors||[]};"
   case "navigate":script="if(!['#dashboard','#transactions','#recurring','#forecast','#calendar','#insights','#assistant','#savings','#settings'].includes(value))throw Error('Unsupported section');location.hash=value;return true;"
   case "api":script="const p=JSON.parse(value);const method=p.method||'GET';const headers={'Content-Type':'application/json'};if(!['GET','HEAD'].includes(method)){const csrf=await fetch('/api/auth/csrf');headers['X-CSRF-TOKEN']=(await csrf.json()).token;}const r=await fetch('/api'+p.path,{method,headers,body:p.body===undefined?undefined:JSON.stringify(p.body)});const t=await r.text();return {status:r.status,body:t?JSON.parse(t):null};"
   case "click":script="const nodes=[...document.querySelectorAll('button,a')].filter(e=>e.textContent.trim()===value);const e=nodes.find(e=>!e.disabled&&e.getClientRects().length&&(!document.querySelector('dialog[open]')||e.closest('dialog[open]')));if(!e)throw Error('Control unavailable');e.click();return true;"
   case "fill":script="const p=JSON.parse(value);const label=[...document.querySelectorAll('label')].find(e=>[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim()===p.label);const e=label?.querySelector('input,textarea,select');if(!e)throw Error('Field unavailable');const proto=e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,p.value);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true;"
   default:writeAutomation(root,id,["error":"Unsupported verification operation"]);return
  }
  web?.callAsyncJavaScript(script,arguments:["value":command["value"] as? String ?? ""],in:nil,in:.page){result in switch result{case .success(let value):self.writeAutomation(root,id,["result":value]);case .failure:self.writeAutomation(root,id,["error":"Verification operation failed"])} }
 }
 func writeAutomation(_ root:URL,_ id:String,_ value:[String:Any]){var out=value;out["id"]=id;do{let target=root.appendingPathComponent("response.json");try JSONSerialization.data(withJSONObject:out).write(to:target,options:.atomic);try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:target.path)}catch{}}
}
let app=NSApplication.shared;let delegate=AppDelegate();app.delegate=delegate;app.setActivationPolicy(.regular);app.run()
