import {supportedSites} from './core/sites.js';

export const SITE_PREFERENCE_KEY='textMemorySitePreference';
export function connectionSite(value){
  const key=String(value||'').toLowerCase();
  const aliases={chatgpt:'https://chatgpt.com',deepseek:'https://chat.deepseek.com',kimi:'https://www.kimi.com',grok:'https://grok.com',claude:'https://claude.ai',qianwen:'https://www.qianwen.com',gemini:'https://gemini.google.com'};
  return supportedSites.find(site=>site.origin===(aliases[key]||value)||site.name.toLowerCase()===key)||null;
}

// Called directly in a click handler so the permission request keeps its user gesture.
// Focusing a site never inserts a pack or sends a chat message.
export async function connectSite(value,{api=globalThis.chrome,beforeNavigate=null}={}){
  const site=connectionSite(value);
  if(!site)throw Error('请选择支持的 AI 网站');
  if(!api?.permissions?.request||!api?.tabs)throw Error('站点连接需要已安装的扩展；本地预览只演示配色和交互');
  const granted=await api.permissions.request({origins:[site.origin+'/*']});
  if(!granted)return{connected:false,site,message:`未获得 ${site.name} 的访问权限，原连接保持不变。`};
  if(beforeNavigate)await beforeNavigate();
  const tabs=await api.tabs.query({url:site.origin+'/*',currentWindow:true});
  // Reuse an existing tab without navigating it away from its conversation.
  const existing=tabs.find(tab=>tab.active&&!tab.incognito)||tabs.find(tab=>!tab.incognito);
  const opened=existing?await api.tabs.update(existing.id,{active:true}):await api.tabs.create({url:site.origin+(site.name==='Gemini'?'/app':'/'),active:true});
  if(!opened||!Number.isSafeInteger(opened.id))throw Error(`已授权 ${site.name}，但未能确认网页打开，请从浏览器手动打开`);
  let saved=true;
  try{await api.storage?.local?.set({[SITE_PREFERENCE_KEY]:{origin:site.origin}});}catch{saved=false;}
  return{connected:true,site,tabId:opened.id,reused:!!existing,message:`已打开 ${site.name}。选择任务后即可打开网页浮窗。${saved?'':'主题偏好暂未保存。'}`};
}
