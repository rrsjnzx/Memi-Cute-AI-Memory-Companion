// Presentation only. Site authorization and the actual conversation target are
// owned by the caller; selecting artwork never changes a tab or sends content.
import {COMPANION_CATALOG} from './companion-catalog.js';
export const SITE_THEMES = Object.freeze({
  chatgpt: {name:'ChatGPT', short:'G', origin:'https://chatgpt.com', companion:true},
  deepseek: {name:'DeepSeek', short:'D', origin:'https://chat.deepseek.com', companion:true},
  claude: {name:'Claude', short:'C', origin:'https://claude.ai', companion:true},
  kimi: {name:'Kimi', short:'K', origin:'https://www.kimi.com', companion:true},
  grok: {name:'Grok', short:'X', origin:'https://grok.com', companion:true},
  qianwen: {name:'千问', short:'千', origin:'https://www.qianwen.com', companion:true},
  gemini: {name:'Gemini', short:'✦', origin:'https://gemini.google.com', companion:false},
});

export function normalizeSite(value) {
  const text=String(value?.site||value?.origin||value?.name||value||'').trim().toLowerCase();
  const aliases={gpt:'chatgpt','chat gpt':'chatgpt','deep seek':'deepseek',qwen:'qianwen','千问':'qianwen'};
  if(SITE_THEMES[text])return text;
  if(aliases[text])return aliases[text];
  try{
    const url=new URL(text);
    const match=Object.entries(SITE_THEMES).find(([,site])=>site.origin===url.origin);
    return match?.[0]||'neutral';
  }catch{return 'neutral';}
}

function hostFor(root){return root.documentElement||root;}
function all(root,selector){return [...root.querySelectorAll(selector)];}
function setDataIfChanged(node,key,value){if(node.dataset[key]!==value)node.dataset[key]=value;}
function poseCount(site){const catalog=COMPANION_CATALOG[site];return Math.max(catalog?.top?.length||0,catalog?.side?.length||0);}
function poseKey(site){return `companionPose${site[0]?.toUpperCase()||''}${site.slice(1)}`;}
function poseIndex(host,site){const n=Number(host.dataset[poseKey(site)]);return Number.isSafeInteger(n)&&n>=0?n:0;}
function setPoseGeometry(node,pose){
  node?.style?.setProperty('--companion-ratio',String(pose.width/pose.height));
  node?.style?.setProperty('--companion-anchor-x',String(pose.anchorX));
  node?.style?.setProperty('--companion-anchor-y',String(pose.anchorY));
}

export function cycleCompanions({root=globalThis.document}={}) {
  const host=hostFor(root),site=normalizeSite(host.dataset.site),count=poseCount(site);
  if(!count)return 0;
  const next=(poseIndex(host,site)+1)%count;
  host.dataset[poseKey(site)]=String(next);
  applySiteTheme(site,{root,connected:host.dataset.siteConnected==='true'});
  return next;
}

export function applySiteTheme(site,{root=globalThis.document,connected=false,companions}={}) {
  if(!root)return 'neutral';
  const key=normalizeSite(site),theme=SITE_THEMES[key],host=hostFor(root);
  if(companions===undefined)companions=host.dataset.companions!=='hidden';
  // Attribute mutation observers also fire for same-value assignments. A normal
  // refresh must not look like a destination change to the soft-body client.
  setDataIfChanged(host,'site',key);
  setDataIfChanged(host,'siteConnected',String(Boolean(connected)));
  setDataIfChanged(host,'companions',companions?'shown':'hidden');
  for(const label of all(root,'[data-site-name]'))label.textContent=theme?.name||'选择 AI，接续任务';
  for(const label of all(root,'[data-site-mark]'))label.textContent=theme?.short||'TM';
  for(const art of all(root,'[data-companion]')){
    const variant=art.dataset.companion==='top'?'top':'side';
    const poses=COMPANION_CATALOG[key]?.[variant]||[];
    const offset=Math.max(0,Math.floor(Number(art.dataset.companionOffset)||0));
    const pose=poses[(poseIndex(host,key)+offset)%poses.length];
    const frame=art.closest?.('[data-companion-frame]');
    art.hidden=!pose||!companions;
    if(frame){
      frame.dataset.companionVisible=String(!art.hidden);
      if(frame.hasAttribute('data-companion-only'))frame.hidden=art.hidden;
    }
    if(pose){
      const src=new URL(`./${pose.file}`,import.meta.url).href;
      if(art.getAttribute('src')!==src)art.setAttribute('src',src);
      art.dataset.companionEdge=pose.edge;
      setPoseGeometry(art,pose);
      if(frame){frame.dataset.companionEdge=pose.edge;setPoseGeometry(frame,pose);}
      if(frame?.dataset.companionSurface==='floating'){
        host.style?.setProperty('--floating-art-anchor-y',String(pose.anchorY));
        host.style?.setProperty('--floating-art-ratio',String(pose.width/pose.height));
      }
    }else art.removeAttribute('src');
  }
  for(const control of all(root,'[data-toggle-companions]')){
    control.setAttribute('aria-pressed',String(companions));
    control.textContent=companions?'隐藏形象':'显示形象';
  }
  for(const control of all(root,'[data-cycle-companions]')){
    const count=poseCount(key);
    control.hidden=!theme?.companion;
    control.disabled=count<2||!companions;
    control.textContent='换形象';
    control.setAttribute('aria-label',`${theme?.name||'当前站点'} 换形象，当前第 ${count?poseIndex(host,key)%count+1:0} 组，共 ${count} 组`);
    control.setAttribute('title',count>1?'切换本站另一组姿势；不会自动轮播':'本站暂只有一组形象');
  }
  for(const control of all(root,'[data-companion-size]')){
    control.value=host.dataset.companionSize==='large'?'large':'standard';
    control.disabled=!companions||!theme?.companion;
  }
  return key;
}

export function mountSitePicker({root=globalThis.document,onConnect,applyTheme=true}={}) {
  let state={site:'neutral',connected:false,busy:false,message:'',error:false,applyTheme},companions=hostFor(root).dataset.companions!=='hidden',disposed=false;
  let feedbackTimer=null,feedbackRevision=0,attemptRevision=0,connecting=false;
  const bindings=[];
  const bind=(node,event,handler)=>{node.addEventListener(event,handler);bindings.push(()=>node.removeEventListener(event,handler));};
  const status=root.querySelector('#site-connection-status');
  const buttons=all(root,'[data-connect-site]');
  const panel=root.querySelector('#site-connection-panel');
  function clearFeedback(){
    clearTimeout(feedbackTimer);feedbackTimer=null;feedbackRevision++;
    for(const button of buttons)delete button.dataset.feedback;
  }
  function flashFeedback(button,result){
    clearFeedback();
    if(disposed)return;
    const revision=feedbackRevision;
    button.dataset.feedback=result;
    feedbackTimer=setTimeout(()=>{
      if(disposed||revision!==feedbackRevision)return;
      feedbackTimer=null;delete button.dataset.feedback;
    },1200);
  }
  function setState(next={}) {
    if(disposed)return;
    const nextSite=normalizeSite(next.site??state.site);
    if(nextSite!==state.site||next.busy===true)clearFeedback();
    state={...state,...next,site:nextSite};
    companions=hostFor(root).dataset.companions!=='hidden';
    if(state.applyTheme!==false)applySiteTheme(state.site,{root,connected:state.connected,companions});
    for(const button of buttons){
      const chosen=button.dataset.connectSite===state.site;
      button.setAttribute('aria-pressed',String(chosen));
      button.dataset.connected=String(chosen&&state.connected);
      button.disabled=state.busy;
    }
    if(status){
      status.textContent=state.message||(state.busy?'正在请求站点连接…':state.connected?`已获得 ${SITE_THEMES[state.site]?.name||'所选站点'} 访问权限。`:'选择站点后连接；任务和记忆仍保存在本地。');
      status.dataset.state=state.busy?'busy':state.error?'error':state.connected?'connected':'idle';
    }
    panel?.setAttribute('aria-busy',String(state.busy));
  }
  for(const button of buttons)bind(button,'click',()=>{
    if(disposed||state.busy||connecting||typeof onConnect!=='function')return;
    const key=normalizeSite(button.dataset.connectSite),site=SITE_THEMES[key];
    if(!site)return;
    const select=root.querySelector('#connect-site-origin');
    if(select&&[...select.options].some(option=>option.value===site.origin))select.value=site.origin;
    clearFeedback();
    const attempt=++attemptRevision;connecting=true;
    // Call synchronously in the trusted click gesture before any asynchronous
    // work so optional-site permission prompts retain their user activation.
    let result;
    try{result=onConnect(key,site);}catch(error){result=Promise.reject(error);}
    setState({busy:true,error:false,message:`正在连接 ${site.name}…`});
    Promise.resolve(result).then(value=>{
      if(disposed||attempt!==attemptRevision)return;
      connecting=false;
      const connected=value===true||value?.connected===true;
      setState(connected?{site:key,connected:true,busy:false,error:false,message:value?.message||''}:{busy:false,error:true,message:value?.message||`尚未连接 ${site.name}，任务仍留在本地。`});
      flashFeedback(button,connected?'success':'error');
    }).catch(error=>{
      if(disposed||attempt!==attemptRevision)return;
      connecting=false;
      setState({busy:false,error:true,message:error?.message||`连接 ${site.name} 未完成，请重试。`});
      flashFeedback(button,'error');
    });
  });
  for(const button of all(root,'[data-toggle-companions]'))bind(button,'click',()=>{
    companions=hostFor(root).dataset.companions==='hidden';
    const displayed=state.applyTheme===false?hostFor(root).dataset.site:state.site;
    applySiteTheme(displayed,{root,connected:state.applyTheme===false?hostFor(root).dataset.siteConnected==='true':state.connected,companions});
  });
  for(const button of all(root,'[data-cycle-companions]'))bind(button,'click',()=>cycleCompanions({root}));
  for(const control of all(root,'[data-companion-size]'))bind(control,'change',()=>{
    hostFor(root).dataset.companionSize=control.value==='large'?'large':'standard';
  });
  for(const art of all(root,'[data-companion]'))bind(art,'error',()=>{
    art.hidden=true;const frame=art.closest?.('[data-companion-frame]');
    if(frame){frame.dataset.companionVisible='false';if(frame.hasAttribute('data-companion-only'))frame.hidden=true;}
  });
  // Clear feedback left by an older mount/version before restoring selection.
  clearFeedback();setState();
  return {setState,destroy(){
    if(disposed)return;
    disposed=true;attemptRevision++;connecting=false;clearFeedback();
    for(const button of buttons)button.disabled=false;
    panel?.setAttribute('aria-busy','false');
    for(const unbind of bindings)unbind();
  }};
}
