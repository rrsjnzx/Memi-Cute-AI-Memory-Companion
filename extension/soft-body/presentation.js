// Presentation state only. No storage, page access, inference or business calls.
export const SEMANTIC_STATES=Object.freeze(['idle','attentive','expectant','rest','loading','thinking','validating','awaiting_result','save_success','package_success','insert_success','send_success','copy_success','conflict_resolved','task_success','missing_field','target_unselected','page_not_ready','permission_required','conflict_detected','unverified','partial_success','network_error','write_error','insert_error','parse_error','permission_error','timeout','canceled']);
// Neutral is an unconnected fallback, not an eighth catalog persona.
export const PERSONAS=Object.freeze(['chatgpt','deepseek','gemini','claude','grok','kimi','qianwen','neutral']);
export const STATUS_TEXT=Object.freeze({idle:'等待操作',attentive:'正在关注',expectant:'准备操作',rest:'暂时休息',loading:'正在读取或连接',thinking:'正在整理资料',validating:'正在核验',awaiting_result:'等待实际结果',save_success:'已保存到本地库',package_success:'资料包已生成，尚未发送',insert_success:'已插入草稿，尚未发送',send_success:'已核实网页发送效果',copy_success:'已复制到剪贴板',conflict_resolved:'已保存冲突处理选择',task_success:'本次必要步骤已完成',missing_field:'请补全必填内容',target_unselected:'请先选择目标站点',page_not_ready:'目标页面尚未就绪',permission_required:'等待网页访问授权',conflict_detected:'资料有冲突，等待处理',unverified:'操作结果尚未确认',partial_success:'部分完成，请查看原提示',network_error:'连接异常，结果待核实',write_error:'写入未确认，请查看原因',insert_error:'未能确认插入，请检查草稿',parse_error:'内容未能识别，请检查格式',permission_error:'网页访问权限不足',timeout:'等待超时，结果未确认',canceled:'已停止本次操作',send_requested:'已调用发送，等待回复',draft_already_present:'此资料已在草稿中，未重复加入',saved_refresh_pending:'资料已保存，界面刷新未完成',copied_tracking_pending:'已复制，交付记录未保存',stopped_waiting:'已停止等待，后台结果未确认',core_draft_updated:'重要记忆草稿已修改，保存任务后生效',site_connected:'已授权并打开站点，尚未发送',operation_completed:"本次操作已完成",operation_failed:"操作未完成，请查看原因",editor_unsupported:"当前网页输入框不兼容，未执行写入",floating_opened:"网页浮窗已打开",draft_read:"已读取当前网页草稿",page_bound:"已绑定当前网页与所选资料库",access_paused:"网页访问已暂停",draft_restored:"已恢复写入前草稿",web_check_passed:"本次网页自检通过，未发送消息",functional_check_passed:"本次隔离功能验收通过",restart_check_passed:"本次重启数据核验通过",saved_report_read:"已读取保存的检查记录，未重新运行",view_updated:"界面已更新；资料以保存结果为准",reply_received:"已接收网页回复，待核对记忆",download_requested:"已请求下载，等待浏览器保存",target_ambiguous:'检测到多个目标，请明确选择',empty_result:'已完成检查，当前没有匹配内容',feedback_connection_lost:'反馈连接已断开，业务结果仍需原处核对',feedback_reconnecting:'正在重新连接反馈显示',feedback_reconnected:'反馈显示已重新接通',repeat_click:'操作仍在进行，重复触发已拦截'});
const successes=new Set(['save_success','package_success','insert_success','send_success','copy_success','conflict_resolved','task_success']);
const processing=new Set(['loading','thinking','validating','awaiting_result']);
const neutral=new Set(['idle','attentive','expectant','rest']);
const phases=new Set(['enter','main','hold','recover']);
const snapshotKeys=['contextKey','operationId','attemptId','eventId','revision','personaId','semanticState','recipeId','phase','startedAt','duration','feedbackVisible','statusCode'];
const safeId=value=>typeof value==='string'&&value.length>0&&value.length<=160&&!/[\u0000-\u001f\u007f]/u.test(value);
const copy=value=>structuredClone(value);
const specialStatuses={send_requested:'awaiting_result',draft_already_present:'insert_success',saved_refresh_pending:'partial_success',copied_tracking_pending:'partial_success',stopped_waiting:'unverified',core_draft_updated:'task_success',site_connected:'task_success',operation_completed:'task_success',operation_failed:'insert_error',editor_unsupported:'insert_error',floating_opened:'task_success',draft_read:'task_success',page_bound:'task_success',access_paused:'task_success',draft_restored:'task_success',web_check_passed:'task_success',functional_check_passed:'task_success',restart_check_passed:'task_success',saved_report_read:'task_success',view_updated:'task_success',reply_received:'task_success',download_requested:'awaiting_result',target_ambiguous:'target_unselected',empty_result:'task_success',feedback_connection_lost:'network_error',feedback_reconnecting:'loading',feedback_reconnected:'task_success'};
const statusMatches=(semantic,code)=>code===semantic||specialStatuses[code]===semantic||code==='repeat_click'&&processing.has(semantic);
export function validPresentationSnapshot(value){return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===snapshotKeys.length&&snapshotKeys.every(key=>Object.hasOwn(value,key))&&['contextKey','operationId','attemptId','eventId','recipeId'].every(key=>safeId(value[key]))&&Number.isSafeInteger(value.revision)&&value.revision>0&&PERSONAS.includes(value.personaId)&&SEMANTIC_STATES.includes(value.semanticState)&&phases.has(value.phase)&&Number.isFinite(value.startedAt)&&value.startedAt>=0&&Number.isFinite(value.duration)&&value.duration>=0&&value.duration<=60000&&typeof value.feedbackVisible==='boolean'&&Object.hasOwn(STATUS_TEXT,value.statusCode)&&statusMatches(value.semanticState,value.statusCode)&&(!value.feedbackVisible||!neutral.has(value.semanticState));}
export function canUseRubEmotion(snapshot){return !!snapshot&&!snapshot.feedbackVisible&&(neutral.has(snapshot.semanticState)||successes.has(snapshot.semanticState)||snapshot.semanticState==='canceled');}
export function createPresentationState({contextKey,personaId,resolveRecipe,now=0}){
  if(!safeId(contextKey)||!PERSONAS.includes(personaId)||typeof resolveRecipe!=='function')throw Error('Invalid presentation context');
  const snapshot={contextKey,operationId:'idle',attemptId:'idle',eventId:'idle',revision:1,personaId,semanticState:'idle',recipeId:resolveRecipe(personaId,'idle'),phase:'hold',startedAt:now,duration:0,feedbackVisible:false,statusCode:'idle'};
  if(!validPresentationSnapshot(snapshot))throw Error('Invalid idle recipe');
  return{snapshot,seen:[],attempts:[],terminal:false,blocked:false,dismissed:false,startedAt:now};
}
// Events come from explicit operation callbacks, never from DOM wording.
export function reducePresentation(state,event,{now,resolveRecipe}){
  if(!state||!event||event.contextKey!==state.snapshot.contextKey||!safeId(event.eventId)||!Number.isFinite(now)||now<0||state.seen.includes(event.eventId))return state;
  const old=state.snapshot;let next;
  if(event.type==='begin'){
    if(!safeId(event.operationId)||!safeId(event.attemptId)||state.attempts.includes(event.attemptId))return state;
    const semantic=processing.has(event.semanticState)?event.semanticState:'loading';
    const statusCode=event.statusCode!=='repeat_click'&&Object.hasOwn(STATUS_TEXT,event.statusCode)&&statusMatches(semantic,event.statusCode)?event.statusCode:semantic;
    next={...old,operationId:event.operationId,attemptId:event.attemptId,semanticState:semantic,recipeId:resolveRecipe(old.personaId,semantic,{statusCode,operationId:event.operationId}),phase:'enter',startedAt:now,duration:0,feedbackVisible:false,statusCode};
  }else if(event.type==='repeat'){
    // A business guard intercepted this same still-running attempt. Do not
    // begin/end an operation, reset its wait clock, or resolve an existing error.
    if(event.operationId!==old.operationId||event.attemptId!==old.attemptId||event.evidence!=='confirmed'||state.terminal||!processing.has(old.semanticState))return state;
    next={...old,recipeId:resolveRecipe(old.personaId,old.semanticState,{statusCode:'repeat_click',operationId:old.operationId}),statusCode:'repeat_click',phase:'enter',startedAt:now,duration:0,feedbackVisible:true};
  }else if(event.type==='result'){
    if(event.operationId!==old.operationId||event.attemptId!==old.attemptId||!SEMANTIC_STATES.includes(event.semanticState)||neutral.has(event.semanticState))return state;
    let semantic=event.semanticState;
    if(successes.has(semantic)&&event.evidence!=='confirmed')semantic='unverified';
    if(state.blocked&&successes.has(semantic)&&event.resolved!==true)return state;
    if(state.terminal&&processing.has(semantic))return state;
    const statusCode=event.statusCode!=='repeat_click'&&semantic===event.semanticState&&Object.hasOwn(STATUS_TEXT,event.statusCode)&&statusMatches(semantic,event.statusCode)?event.statusCode:semantic;
    // Stopping a wait does not prove an operation was canceled.
    if(semantic==='canceled'&&event.evidence!=='confirmed')semantic='unverified';
    next={...old,semanticState:semantic,recipeId:resolveRecipe(old.personaId,semantic,{statusCode,operationId:event.operationId}),phase:'enter',startedAt:now,duration:successes.has(semantic)||semantic==='canceled'?2560:0,feedbackVisible:true,statusCode:semantic==='unverified'&&event.semanticState==='canceled'?'stopped_waiting':statusCode};
  }else if(event.type==='advance'){
    const elapsed=Math.max(0,now-old.startedAt);
    if(processing.has(old.semanticState)&&!state.terminal){
      if(state.dismissed)return state;
      const visible=now-state.startedAt>=180;
      const semantic=now-state.startedAt>=6000?'awaiting_result':old.semanticState;
      next={...old,semanticState:semantic,recipeId:semantic===old.semanticState?old.recipeId:resolveRecipe(old.personaId,semantic),statusCode:semantic===old.semanticState?old.statusCode:semantic,feedbackVisible:visible,phase:visible?'hold':'enter'};
    }else if(old.feedbackVisible){
      if(old.duration&&elapsed>=old.duration){next={...old,semanticState:'idle',recipeId:resolveRecipe(old.personaId,'idle'),phase:'hold',feedbackVisible:false,statusCode:'idle',duration:0};}
      else next={...old,phase:old.duration&&elapsed>=2400?'recover':elapsed>=320?'hold':elapsed>=100?'main':'enter'};
    }else return state;
    if(next.feedbackVisible===old.feedbackVisible&&next.phase===old.phase&&next.semanticState===old.semanticState)return state;
  }else if(event.type==='dismiss'){
    if(event.revision!==old.revision||!old.feedbackVisible)return state;
    next={...old,feedbackVisible:false,phase:'hold'};
  }else return state;
  next.eventId=event.eventId;next.revision=old.revision+1;
  if(!validPresentationSnapshot(next))return state;
  return{snapshot:next,seen:[...state.seen,event.eventId].slice(-128),attempts:event.type==='begin'?[...state.attempts,event.attemptId].slice(-128):state.attempts,terminal:event.type==='begin'?false:event.type==='result'?!processing.has(next.semanticState):state.terminal,blocked:event.type==='begin'?false:event.type==='result'?!successes.has(next.semanticState)&&next.semanticState!=='canceled'&&!processing.has(next.semanticState):state.blocked,dismissed:event.type==='dismiss'?true:['begin','result','repeat'].includes(event.type)?false:state.dismissed,startedAt:event.type==='begin'?now:state.startedAt};
}
export function createPresentationController({contextKey,personaId,resolveRecipe,now=()=>Date.now(),id=()=>crypto.randomUUID(),onChange=()=>{}}){
  let state=createPresentationState({contextKey,personaId,resolveRecipe,now:now()}),disposed=false;
  function dispatch(event){if(disposed)return null;const next=reducePresentation(state,{contextKey,eventId:id(),...event},{now:now(),resolveRecipe});if(next!==state){state=next;onChange(copy(state.snapshot));}return copy(state.snapshot);}
  return{getSnapshot:()=>copy(state.snapshot),begin:({operationId=id(),attemptId=id(),semanticState='loading',statusCode=''}={})=>{dispatch({type:'begin',operationId,attemptId,semanticState,statusCode});return{contextKey,operationId,attemptId};},result:(ticket,result)=>dispatch({...ticket,type:'result',...result}),repeat:(ticket,{evidence}={})=>dispatch({...ticket,type:'repeat',evidence}),advance:()=>dispatch({type:'advance'}),dismiss:(revision=state.snapshot.revision)=>dispatch({type:'dismiss',revision}),dispatch,dispose:()=>{disposed=true;}};
}
