// Public catalogue explanations, not measurements or acceptance claims.
// Keep every V2.1 row; V3 can restrict when it is safe to display one at runtime.
import {V2_STATES, EXPRESSIONS, PERSONAS} from './catalog.js';

const bodyStates=new Set(['idle','notice','tap','gentle_rub','press_hold','stretch','rapid_rub','overstimulated','release_dazed','sleepy','wake','peek','blocked_rub']);
const runtimeNotes=Object.freeze({
  idle:'没有正在进行的操作或待处理反馈时。', notice:'在空闲时将指针移入顶部本体框。', tap:'轻点顶部颜表情或“轻点”按钮。',
  greeting:'连接站点的实际授权与打开操作成功后。', focused:'实际按钮操作开始后。', waiting:'按钮操作持续 6 秒仍未返回结果，或正在等待实际回执。',
  success:'保存、复制、插入等操作得到确认结果。', great_success:'资料包或本次流程收到完成回执；提示文字仍说明真实完成范围。',
  retry_success:'同一保存／复制／插入操作先失败，再重试并得到成功回执；或保存冲突处理选择。',
  missing_input:'业务校验返回缺少必填内容。', permission_required:'实际权限请求等待授权或被拒绝。', target_ambiguous:'实际页面适配器返回 ambiguous_target 等目标不明确回执；不从提示文字推断。',
  unsupported:'真实适配器返回当前网页输入框不兼容。', conflict:'资料包诊断明确包含 blocking 的 conflict 项，或既有冲突操作回执要求处理。', connection_lost:'收到反馈端口断开、发送失败或外侧反馈断连的明确事件；不声称记忆写入失败，不用等待时长猜断网。',
  failure:'实际操作返回失败。', unknown_result:'无法确认写入结果、回执缺失或等待超时。', cancelled:'确认取消；仅停止等待而结果未知时仍显示未知。',
  empty:'用户发起的检查已完成且结构化 rows 确认为空；不把未填输入、空包失败或读取失败当作空结果。',
  reconnecting:'用户点击重新连接反馈后，真实连接尝试已开始；首次连接与自动后台加载不冒充重连。',
  repeat_click:'业务忙碌锁确实拦截同一操作的重复触发；保留原 attempt 和运行状态，不重执行业务或提前结束。',
  blocked_rub:'V3 优先：错误、冲突、权限、未知或部分完成时揉本体，按本角色原设计叠加局部受力反应；保留当前业务脸、颜文字与反馈同步，不切换成完整 blocked_rub 脸。',
  partial_success:'部分步骤确认完成，另有未完成或未确认的步骤。',
  gentle_rub:'有效轻揉累计约 1.2 秒。', press_hold:'按住本体约 0.7 秒。', stretch:'向一侧拉开并稳定约 0.4 秒。',
  rapid_rub:'有效快揉累计约 3.6 秒。', overstimulated:'同次有效快揉累计约 7.2 秒；静止等待不累计。',
  release_dazed:'松开正在揉搓的本体后逐渐回神。', sleepy:'空闲至少 30 秒，且无在途操作、无未解决问题。',
  wake:'休息时轻点本体；真实业务开始时直接优先显示处理中。', peek:'空闲时每第三次轻点的小变体，始终留在本体框内。',
});
export const EXPRESSION_AVAILABILITY=Object.freeze(V2_STATES.map(state=>Object.freeze({
  stateId:state.id,name:state.name,mode:bodyStates.has(state.id)?'body':'operation',
  rendering:state.id==='blocked_rub'?'body_geometry':'full_expression',description:runtimeNotes[state.id],
})));
const byState=new Map(EXPRESSION_AVAILABILITY.map(row=>[row.stateId,row]));
export function expressionAvailability(stateId){return byState.get(stateId)||null;}
export function atlasEntries({personaId='',mode='',query=''}={}){
  const search=String(query).trim().toLocaleLowerCase();
  return EXPRESSIONS.filter(entry=>(!personaId||entry.personaId===personaId)&&(!mode||byState.get(entry.stateId)?.mode===mode)&&(!search||[entry.id,entry.sourceStateName,entry.richText,PERSONAS.find(p=>p.id===entry.personaId)?.label].join(' ').toLocaleLowerCase().includes(search)));
}
export function atlasCounts(personaId=''){
  const entries=atlasEntries({personaId});
  return {total:entries.length,distinctText:new Set(entries.map(entry=>entry.richText)).size,
    operation:entries.filter(entry=>byState.get(entry.stateId)?.mode==='operation').length,
    body:entries.filter(entry=>byState.get(entry.stateId)?.mode==='body').length,
    previewOnly:entries.filter(entry=>byState.get(entry.stateId)?.mode==='preview_only').length};
}
