(() => {
  const VERSION='0.12.0';
  if(globalThis.__textMemoryFloatingShell?.version===VERSION)return;
  globalThis.__textMemoryFloatingShell?.dispose?.();
  let current=null;
  const clamp=(value,min,max)=>Math.max(min,Math.min(value,Math.max(min,max)));
  const viewport=()=>({width:Math.max(32,innerWidth),height:Math.max(32,innerHeight)});
  function paint(){
    if(!current)return;const view=viewport();
    // width/height retain the expanded preference. A viewport shrink or
    // temporary collapse must not destroy the user's chosen expanded size.
    current.paintedWidth=Math.min(current.width,view.width-16);current.paintedHeight=Math.min(current.collapsed?52:current.height,view.height-16);
    current.x=clamp(current.x,8,view.width-current.paintedWidth-8);current.y=clamp(current.y,8,view.height-current.paintedHeight-8);
    Object.assign(current.host.style,{left:current.x+'px',top:current.y+'px',width:current.paintedWidth+'px',height:current.paintedHeight+'px'});
  }
  function dispose(){
    if(!current)return;removeEventListener('message',current.receive);removeEventListener('resize',paint);removeEventListener('pagehide',dispose);
    current.observer?.disconnect();current.failureClose?.removeEventListener('click',current.closeFailure);
    current.host.remove();current=null;
  }
  const failureMessages={
    floating_document_replaced:'浮窗页面已被替换，当前无法继续使用。',
    floating_source_changed:'浮窗加载地址已变化，当前页面不可用。',
    floating_frame_restricted:'浮窗加载条件已变化，当前页面不可用。',
    floating_frame_removed:'浮窗页面已从原位置移除，当前无法继续使用。',
  };
  function unavailable(instance,reason){
    if(current!==instance||!instance.host.isConnected)return{status:'not_found'};
    if(instance.failure)return{...instance.failure};
    instance.ready=false;instance.failure={status:'unavailable',reason,message:failureMessages[reason]+'可关闭此窗口后从扩展侧栏继续；本次未自动重新加载或发送消息。'};
    // The error controls belong to the shell, so a replaced/inaccessible frame
    // cannot leave an uncloseable white rectangle. Keep its node and attributes
    // intact: this does not remove restrictions, reload it, or rewrite content.
    const card=document.createElement('section'),title=document.createElement('strong'),message=document.createElement('p'),close=document.createElement('button');
    card.setAttribute('role','alert');card.setAttribute('data-text-memory-frame-error',reason);
    Object.assign(card.style,{position:'absolute',inset:'0',boxSizing:'border-box',padding:'20px',overflow:'auto',background:'#fff8f7',color:'#71372f',font:'14px/1.6 system-ui,sans-serif',border:'1px solid #e7aaa0',borderRadius:'16px'});
    title.textContent='Text Memory · 浮窗暂不可用';message.textContent=instance.failure.message;close.textContent='关闭此浮窗';close.type='button';
    Object.assign(close.style,{padding:'9px 16px',border:'1px solid #ac4a3b',borderRadius:'8px',background:'#fff',color:'#71372f',font:'inherit',cursor:'pointer'});
    instance.closeFailure=event=>{if(event.isTrusted&&current===instance)dispose();};instance.failureClose=close;close.addEventListener('click',instance.closeFailure);
    card.append(title,message,close);instance.shadow.append(card);
    if(instance.collapsed){instance.collapsed=false;paint();}
    return{...instance.failure};
  }
  function inspect(instance,records=[]){
    if(current!==instance||!instance.host.isConnected)return{status:'not_found'};
    if(instance.failure)return{...instance.failure};
    const frame=instance.frame;
    // Empty srcdoc and sandbox attributes are meaningful. Check synchronously
    // at every shell API as well as on mutations, before accepting old ready
    // messages. Old values also catch an attribute briefly added then removed
    // in one turn, or a frame removed and reattached before the observer runs.
    let reason=frame.hasAttribute('srcdoc')?'floating_document_replaced':frame.getAttribute('src')!==instance.frameUrl?'floating_source_changed':frame.hasAttribute('sandbox')?'floating_frame_restricted':frame.parentNode!==instance.shadow?'floating_frame_removed':null;
    if(!reason)for(const record of records){
      if(record.type==='attributes'&&record.target===frame&&record.oldValue!==null){
        if(record.attributeName==='srcdoc')reason='floating_document_replaced';
        else if(record.attributeName==='sandbox')reason='floating_frame_restricted';
        else if(record.attributeName==='src'&&record.oldValue!==instance.frameUrl)reason='floating_source_changed';
      }else if(record.type==='childList'&&record.target===instance.shadow&&Array.from(record.removedNodes||[]).includes(frame))reason='floating_frame_removed';
      if(reason)break;
    }
    if(reason)return unavailable(instance,reason);
    return{status:instance.pageUrl!==location.href?'stale_target':instance.ready?'ready':'loading'};
  }
  function open(config){
    if(typeof config?.token!=='string'||! /^[a-f0-9]{64}$/.test(config.token)||config.pageUrl!==location.href)return{status:'stale_target',message:'网页已变化，请重新打开浮窗'};
    let url;try{url=new URL(config.url);}catch{return{status:'rejected'};}
    if(url.protocol!=='chrome-extension:'||url.host!==chrome.runtime.id||url.pathname!=='/floating.html'||url.search!=='?token='+config.token||url.hash)return{status:'rejected'};
    dispose();
    const host=document.createElement('div');host.setAttribute('data-text-memory-floating','');host.setAttribute('aria-label','Text Memory 网页浮窗');
    // The extension document draws the card below its transparent companion
    // area. An opaque or rounded shell would turn that area back into a panel
    // and clip the artwork; shell geometry remains a bounded drag/resize box.
    Object.assign(host.style,{position:'fixed',zIndex:'2147483647',display:'block',visibility:'visible',margin:'0',padding:'0',border:'0',borderRadius:'0',boxShadow:'none',overflow:'visible',background:'transparent'});
    const shadow=host.attachShadow({mode:'closed'}),frame=document.createElement('iframe');
    frame.src=url.href;frame.title='Text Memory 外置记忆对话';frame.setAttribute('allow','clipboard-write');
    Object.assign(frame.style,{width:'100%',height:'100%',display:'block',margin:'0',padding:'0',border:'0',borderRadius:'0',background:'transparent'});
    shadow.append(frame);
    const view=viewport();
    // Initial placement needs travel room in both directions. A fixed desktop
    // size otherwise clamps both axes to 8px on common laptop viewports. Do
    // not force desktop minimum dimensions into a viewport too small to fit
    // them; manual resizing below still uses its bounded practical minimums.
    const initialSize=(available,ratio,maximum)=>Math.max(16,Math.min(maximum,Math.floor(available*ratio),available-48));
    // Answer reading gets the vertical space first. Keep 24px above/below for
    // visible page context and dragging, while taller screens can show more
    // conversation instead of stopping at the former 880px desktop cap.
    // Narrow pages need the usable 300px chat width before extra drag margins.
    // Below 316px the real viewport still wins; the inner page also responds
    // below 300px instead of drawing an inaccessible off-frame right edge.
    const width=Math.max(initialSize(view.width,0.88,920),Math.min(300,view.width-16));
    const height=initialSize(view.height,0.94,1080);
    current={host,shadow,frame,frameUrl:url.href,token:config.token,pageUrl:config.pageUrl,origin:url.origin==='null'?'chrome-extension://'+url.host:url.origin,width,height,x:(view.width-width)/2,y:(view.height-height)/2,collapsed:false,ready:false,failure:null};
    const instance=current;
    const receive=event=>{
      if(current!==instance||!event.isTrusted||event.source!==frame.contentWindow||event.origin!==instance.origin)return;
      const data=event.data;if(!data||data.type!=='TEXT_MEMORY_FLOATING_LAYOUT'||Object.keys(data).some(key=>!['type','action','dx','dy'].includes(key)))return;
      if(inspect(instance).status==='unavailable')return;
      if(data.action==='ready'){instance.ready=true;return;}
      if(data.action==='move'){
        if(!Number.isFinite(data.dx)||!Number.isFinite(data.dy)||Math.abs(data.dx)>1000||Math.abs(data.dy)>1000)return;
        instance.x+=data.dx;instance.y+=data.dy;
      }else if(data.action==='resize'){
        if(instance.collapsed||!Number.isFinite(data.dx)||!Number.isFinite(data.dy)||Math.abs(data.dx)>1000||Math.abs(data.dy)>1000)return;
        const size=viewport(),maxWidth=size.width-instance.x-8,maxHeight=size.height-instance.y-8;
        instance.width=clamp(instance.paintedWidth+data.dx,Math.min(360,maxWidth),maxWidth);
        instance.height=clamp(instance.paintedHeight+data.dy,Math.min(420,maxHeight),maxHeight);
      }else if(data.action==='collapse'){if(!instance.collapsed)instance.y+=instance.paintedHeight-Math.min(52,viewport().height-16);instance.collapsed=true;}
      else if(data.action==='expand'){if(instance.collapsed)instance.y-=Math.min(instance.height,viewport().height-16)-Math.min(52,viewport().height-16);instance.collapsed=false;}
      else if(data.action==='close'){dispose();return;}
      else if(data.action==='center'){const size=viewport();instance.x=(size.width-Math.min(instance.width,size.width-16))/2;instance.y=size.height-Math.min(instance.collapsed?52:instance.height,size.height-16)-12;}
      else return;
      paint();
    };
    current.receive=receive;addEventListener('message',receive);addEventListener('resize',paint);addEventListener('pagehide',dispose);
    current.observer=new MutationObserver(records=>{if(current===instance)inspect(instance,records);});
    current.observer.observe(frame,{attributes:true,attributeFilter:['src','srcdoc','sandbox'],attributeOldValue:true});
    current.observer.observe(shadow,{childList:true});
    document.documentElement.append(host);paint();return{status:'mounted'};
  }
  function acceptPageUrl(config){
    if(!current||config?.token!==current.token||!current.host.isConnected)return{status:'not_found'};
    const health=inspect(current);if(health.status==='unavailable')return health;
    if(Object.keys(config).some(key=>!['token','pageUrl','fromUrl'].includes(key))||typeof config.pageUrl!=='string'||config.pageUrl!==location.href||(config.fromUrl!==undefined&&config.fromUrl!==current.pageUrl))return{status:'stale_target'};
    let next,previous;try{next=new URL(config.pageUrl);previous=new URL(current.pageUrl);}catch{return{status:'rejected'};}
    if(next.origin!==previous.origin||next.protocol!=='https:'||next.username||next.password)return{status:'rejected'};
    // This API is only called by an injected background script after session
    // authorization. No message action can set pageUrl or grant data access.
    current.pageUrl=config.pageUrl;return{status:'accepted'};
  }
  function closeIfLoading(token){
    if(!current||current.token!==token||!current.host.isConnected)return{status:'not_found'};
    const health=inspect(current);if(health.status==='unavailable'||current.ready)return health;
    dispose();return{status:'closed'};
  }
  globalThis.__textMemoryFloatingShell={version:VERSION,open,dispose,acceptPageUrl,closeIfLoading,close:token=>{if(current?.token===token){dispose();return{status:'closed'};}return{status:'not_found'};},check:token=>current?.token===token?inspect(current):{status:'not_found'}};
})();
