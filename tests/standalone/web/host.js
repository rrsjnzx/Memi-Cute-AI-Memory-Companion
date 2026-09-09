const $=id=>document.getElementById(id);
const mockFrame=$('mockFrame'),managerFrame=$('managerFrame');
const documentId='web-mock-'+crypto.randomUUID();
const records=[];
let floating=null,floatingOpening=false,ambiguousEditorFixture=null;
const mockReady=new Promise(resolve=>{if(mockFrame.contentWindow?.__tmMockSite)resolve();else mockFrame.addEventListener('load',resolve,{once:true});});
function status(text,error=false){$('hostStatus').textContent=text;$('hostStatus').classList.toggle('error',error);}
function log(kind,details={}){
  const record={at:new Date().toISOString(),kind,...details};records.push(record);if(records.length>200)records.shift();
  const li=document.createElement('li'),time=document.createElement('time');time.textContent=new Date(record.at).toLocaleTimeString();li.append(time,document.createTextNode(kind+' '+JSON.stringify(details)));
  $('eventList').append(li);while($('eventList').children.length>200)$('eventList').firstChild.remove();$('eventCount').textContent=String(records.length);
  return record;
}
function show(view){
  const isMock=view==='mock',isSidebar=!isMock&&managerFrame.classList.contains('sidebar-preview');
  // Sidepanel checks still operate on the real copied content adapter. Its
  // target frame must remain visible alongside the panel, as on an AI website.
  mockFrame.hidden=!isMock&&!isSidebar;managerFrame.hidden=isMock;
  $('stage').classList.toggle('sidebar-preview',isSidebar);
  $('manageView').setAttribute('aria-pressed',String(!isMock&&!isSidebar));
  $('sidebarView').setAttribute('aria-pressed',String(isSidebar));$('mockView').setAttribute('aria-pressed',String(isMock));
  globalThis.__tmLocalFeedbackBridge?.layoutChanged();
}
async function mock(){await mockReady;const site=mockFrame.contentWindow.__tmMockSite;if(!site)throw Error('本地模拟网页尚未就绪');return site;}
async function target(){
  if($('unsupportedEditor').checked)return{status:'unsupported',message:'本地故障场景：当前网页输入框不兼容，未写入或发送'};
  const site=await mock(),result={...await site.execute({action:'snapshot'}),tabId:1,documentId};
  if($('delayTargetRead').checked){log('延迟已完成的实际读取',{delayMs:2000,status:result.status,boundary:'local_simulation'});await new Promise(resolve=>setTimeout(resolve,2000));}
  return result;
}
function localMockDocument(){
  const url=new URL(mockFrame.src);
  if(!['127.0.0.1','localhost'].includes(url.hostname)||url.origin!==location.origin||url.pathname!=='/web/mock-site.html'||mockFrame.contentWindow.location.href!==url.href)throw Error('输入框夹具仅允许当前本地模拟网页');
  return mockFrame.contentDocument;
}
async function setAmbiguousEditor(enabled){
  if(typeof enabled!=='boolean')throw Error('输入框夹具开关必须为布尔值');
  await mock();const doc=localMockDocument();
  if(!enabled){const removed=!!ambiguousEditorFixture;ambiguousEditorFixture?.remove();ambiguousEditorFixture=null;log('移除额外候选输入框',{removed,boundary:'local_simulation',touchesDraft:false});return{enabled:false,removed};}
  if(ambiguousEditorFixture?.ownerDocument===doc&&ambiguousEditorFixture.isConnected)return{enabled:true,created:false};
  ambiguousEditorFixture?.remove();ambiguousEditorFixture=null;
  const original=doc.querySelector('#mockComposer textarea');
  if(!original||!['prompt-textarea','mobile-composer-prompt'].includes(original.id))throw Error('未找到本地原始输入框，未创建夹具');
  const label=doc.createElement('label'),extra=doc.createElement('textarea');
  label.setAttribute('data-tm-local-ambiguous-editor','');label.textContent='额外候选输入框 · 仅本地验收';
  label.style.cssText='display:block;position:fixed;left:18px;top:100px;width:min(420px,70vw);padding:12px;background:#fff8e6;border:2px dashed #aa7426;border-radius:12px;z-index:20';
  extra.id=original.id==='prompt-textarea'?'mobile-composer-prompt':'prompt-textarea';
  if(extra.id==='mobile-composer-prompt')extra.setAttribute('data-mobile-composer-prompt','');
  extra.setAttribute('aria-label','第二个兼容输入框（本地验收）');extra.rows=2;extra.style.cssText='display:block;width:100%;min-height:70px';
  label.append(extra);doc.body.append(label);ambiguousEditorFixture=label;
  log('创建额外候选输入框',{created:true,boundary:'local_simulation',touchesDraft:false});return{enabled:true,created:true};
}
function disconnectFeedback(){
  const bridge=globalThis.__tmLocalFeedbackBridge;if(typeof bridge?.disconnectPage!=='function')throw Error('本地反馈桥尚未就绪');
  const result=bridge.disconnectPage();log('实际断开网页反馈端口',{...result,boundary:'local_simulation'});
  status(result.disconnected?'网页反馈端口已断开。请观察正式侧栏的连接状态，再点击侧栏“重新连接外侧反馈”；未派发表情。':'当前没有活动的网页反馈端口。请先打开侧栏布局预览。');return result;
}
async function pageCall(request){
  const site=await mock(),result=await site.execute(request);
  log('页面操作',{action:request.action,status:result.status,...(result.reason?{reason:result.reason}:{}),...(result.display?{displayPhase:result.display.phase,displayCharacters:result.display.text.length}:{}),...(result.kind?{replyKind:result.kind}:{})});
  return{...result,tabId:1,documentId};
}
async function openFloating(){
  if($('unsupportedEditor').checked)return{status:'unsupported',message:'本地故障场景：当前网页输入框不兼容，未打开浮窗'};
  if(floatingOpening)return{status:'busy',message:'正在等待本地浮窗加载，请稍候'};
  floatingOpening=true;let site,record;
  const ready=()=>{log('打开浮窗',{status:'ready',boundary:'local_simulation'});status('本地浮窗已加载；发送实际点击下方模拟网页的按钮，回复由本地脚本生成，不连接真实 AI。');return{status:'opened',floating:{...record}};};
  try{
    show('mock');site=await mock();site.setScenario($('scenario').value);
    if(floating&&site.shell.check(floating.token).status==='ready'){record=floating;return ready();}
    const bytes=crypto.getRandomValues(new Uint8Array(32)),token=[...bytes].map(n=>n.toString(16).padStart(2,'0')).join('');
    const identity=await target();if(identity.status!=='ready')return identity;
    const frameUrl=new URL('../product/floating.html',mockFrame.src);frameUrl.searchParams.set('token',token);
    record={token,tabId:1,documentId,url:identity.url,identity,createdAt:new Date().toISOString()};floating=record;
    const mounted=site.shell.open({token,url:frameUrl.href,pageUrl:mockFrame.contentWindow.location.href});
    if(mounted.status!=='mounted')throw Error(mounted.message||'原版浮窗未能挂载：'+mounted.status);
    log('挂载浮窗',{status:'mounted',boundary:'local_simulation'});status('正在等待本地浮窗完成加载…');
    // Match the production OPEN_FLOATING contract: mounted is not ready. The
    // transport remains a local substitute, not a browser-permission check.
    for(let attempt=0;attempt<40;attempt++){
      if(floating?.token!==record.token)throw Error('本地浮窗连接已更换或关闭');
      const current=site.shell.check(record.token);
      if(current.status==='ready')return ready();
      if(current.status!=='loading'){const error=Error(current.message||'本地浮窗已关闭或模拟网页已改变');error.reason=current.reason;throw error;}
      await new Promise(resolve=>setTimeout(resolve,400));
    }
    const cleanup=site.shell.closeIfLoading(record.token);
    if(cleanup.status==='ready'&&floating?.token===record.token)return ready();
    if(cleanup.status!=='unavailable'&&floating?.token===record.token)floating=null;
    const error=Error(cleanup.status==='unavailable'?(cleanup.message||'本地浮窗不可用；保留原版故障说明，可关闭后重新打开。'):'本地浮窗尚未完成加载。'+(cleanup.status==='closed'?'已关闭未加载的空白窗口。':'未能确认空白窗口已关闭。')+'可重新打开；未发送消息，模拟网页草稿未改动。');error.reason=cleanup.reason;error.cleanupComplete=true;throw error;
  }catch(error){
    if(record&&!error.cleanupComplete){const cleanup=site?.shell.closeIfLoading?.(record.token);if(!['ready','unavailable'].includes(cleanup?.status)&&floating?.token===record.token)floating=null;if(cleanup?.status==='closed')error.message+='；已关闭未加载的空白窗口';if(cleanup?.reason&&!error.reason)error.reason=cleanup.reason;}
    status(error.message,true);log('浮窗加载失败',{message:error.message,...(error.reason?{reason:error.reason}:{}),boundary:'local_simulation'});throw error;
  }finally{floatingOpening=false;}
}
function authorizeFloating(token){return typeof token==='string'&&!!floating&&floating.token===token&&['ready','loading'].includes(mockFrame.contentWindow.__tmMockSite?.shell.check(token).status);}
async function floatingStatus(record){const token=typeof record==='string'?record:record?.token;return(await mock()).shell.check(token);}
async function closeFloating(token){const result=(await mock()).shell.close(token);if(floating?.token===token)floating=null;log('关闭浮窗',{status:result.status});return result;}
async function openManager(){show('manager');return{status:'opened'};}
async function simulateBlankFloating(){
  // Deliberate local-only fault injection. The product shell owns detection,
  // failure UI and later explicit reopening. Never undo this attribute here.
  const site=await mock(),pageUrl=new URL(mockFrame.src);
  if(!['127.0.0.1','localhost'].includes(pageUrl.hostname)||pageUrl.origin!==location.origin||pageUrl.pathname!=='/web/mock-site.html'||mockFrame.contentWindow.location.href!==pageUrl.href)throw Error('故障模拟仅允许当前本地模拟网页');
  if(!floating||site.shell.check(floating.token).status!=='ready')throw Error('请先打开并等待本地浮窗就绪，再模拟变白');
  const doc=mockFrame.contentDocument,host=doc?.querySelector('[data-text-memory-floating]'),frame=host?.shadowRoot?.querySelector('iframe');
  const expected=new URL('../product/floating.html',pageUrl);expected.searchParams.set('token',floating.token);
  if(!frame||frame.ownerDocument!==doc||frame.src!==expected.href||frame.hasAttribute('srcdoc'))throw Error('未找到属于本次本地浮窗的正常 iframe；未修改页面');
  frame.setAttribute('srcdoc','');
  log('模拟已打开浮窗变白',{reason:'local_srcdoc_override',boundary:'local_simulation',writes:1,sendsMessages:false,touchesDraft:false});
  status('已向本次本地浮窗写入一次空 srcdoc，等待原版外壳检测。故障模拟不会移除该属性或自动重开；未发送消息。');
  return{status:'injected',reason:'local_srcdoc_override'};
}
globalThis.__tmWebHost={target,pageCall,openFloating,floatingStatus,authorizeFloating,closeFloating,openManager,simulateBlankFloating,setAmbiguousEditor,disconnectFeedback,log,records,show,get floating(){return floating?structuredClone(floating):null;}};
$('manageView').addEventListener('click',()=>{managerFrame.src='./product/manager.html';managerFrame.classList.toggle('sidebar-preview',false);$('sidebarView').setAttribute('aria-pressed','false');show('manager');});
$('sidebarView').addEventListener('click',()=>{managerFrame.src='./product/sidepanel.html';managerFrame.classList.toggle('sidebar-preview',true);show('manager');$('manageView').setAttribute('aria-pressed','false');$('sidebarView').setAttribute('aria-pressed','true');});
$('focusPreview').addEventListener('click',()=>{const focused=$('focusPreview').getAttribute('aria-pressed')!=='true';document.body.classList.toggle('focused-preview',focused);$('focusPreview').setAttribute('aria-pressed',String(focused));$('focusPreview').textContent=focused?'显示验收工具':'专注界面预览';});
$('mockView').addEventListener('click',()=>show('mock'));
$('openFloating').addEventListener('click',async()=>{const button=$('openFloating');button.disabled=true;try{await openFloating();}catch(error){status(error.message,true);log('浮窗错误',{message:error.message});}finally{button.disabled=false;}});
$('blankFloating').addEventListener('click',async()=>{const button=$('blankFloating');button.disabled=true;try{await simulateBlankFloating();}catch(error){status(error.message,true);log('故障模拟未执行',{message:error.message,boundary:'local_simulation'});}finally{button.disabled=false;}});
$('ambiguousEditor').addEventListener('change',async()=>{const checkbox=$('ambiguousEditor');checkbox.disabled=true;try{await setAmbiguousEditor(checkbox.checked);status(checkbox.checked?'已增加真实兼容输入框；请在侧栏读取网页草稿，正式适配器应拒绝自动选择。':'已移除夹具增加的输入框；原始草稿保留，可重新读取。');}catch(error){checkbox.checked=!!ambiguousEditorFixture;status(error.message,true);}finally{checkbox.disabled=false;}});
$('disconnectFeedback').addEventListener('click',()=>{try{disconnectFeedback();}catch(error){status(error.message,true);}});
$('scenario').addEventListener('change',async()=>{(await mock()).setScenario($('scenario').value);log('切换回复场景',{scenario:$('scenario').value});});
$('toggleLog').addEventListener('click',()=>{const panel=$('testLog');panel.hidden=!panel.hidden;$('toggleLog').setAttribute('aria-expanded',String(!panel.hidden));});
$('closeLog').addEventListener('click',()=>{$('testLog').hidden=true;$('toggleLog').setAttribute('aria-expanded','false');});
$('clearLog').addEventListener('click',()=>{records.splice(0);$('eventList').replaceChildren();$('eventCount').textContent='0';});
mockReady.then(async()=>{(await mock()).setScenario($('scenario').value);log('模拟网页就绪',{sourceVersion:'0.12.1',modelCalls:0});});

// Test-only viewport sizing, without changing copied product code.
$('sidebarWidth').addEventListener('change',()=>{document.documentElement.style.setProperty('--preview-width',$('sidebarWidth').value+'px');});
$('simulateSiteGrant').addEventListener('change',()=>globalThis.__tmLocalFeedbackBridge?.layoutChanged());
