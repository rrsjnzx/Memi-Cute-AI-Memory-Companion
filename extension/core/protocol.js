import {requireThat,string} from './base.js';

const forbidden=new Set(['__proto__','constructor','prototype']);
const markers=new Set(['TEXT-MEMORY-UPDATE','TEXT-MEMORY-SEARCH']);

// Explain marker structure only. Do not alter, decode, extract, or validate the
// JSON payload here; the existing prepare/execute gates retain that authority.
export function inspectMemoryReply(text){
  const invalid=(reason,message)=>({status:'invalid',kind:null,reason,message});
  if(typeof text!=='string')return invalid('non_text','接收内容必须是文本。请读取 AI 回复，或粘贴实际的记忆更新或检索区段。');
  if(text.length>100000)return invalid('too_large','接收内容超过 100000 字符。请只保留一个实际回执区段后重试，不要粘贴完整对话或资料包。');
  if(!text.trim())return{status:'empty',kind:null,reason:'empty',message:'接收区还是空的。请先读取 AI 回复，或粘贴一个记忆更新或检索区段。'};
  // JavaScript multiline anchors also treat U+2028/U+2029 as line boundaries.
  // Those characters may occur literally inside valid JSON strings. Inspect
  // physical LF/CRLF lines so payload text cannot manufacture extra markers.
  const lines=text.split('\n');
  if(lines.some(line=>/^[^\S\r\n\u2028\u2029]*(?:END-)?TEXT-MEMORY-PACK(?:[ \t]+[^\r\n]*)?[ \t]*\r?$/.test(line)))return invalid('echoed_pack','这里包含资料包的 TEXT-MEMORY-PACK 包装。请使用 AI 本轮实际提出的更新或检索回执，不要把包内格式示例当作回复。');
  const all=[];
  for(let index=0;index<lines.length;index++){const match=/^[^\S\r\n\u2028\u2029]*(END-)?TEXT-MEMORY-(UPDATE|SEARCH)[ \t]*\r?$/.exec(lines[index]);if(match){match.index=index;all.push(match);}}
  if(!all.length){
    // Recognize common visible wrapping/escaping without decoding or rewriting
    // the user's text. A protocol name in prose is not itself a valid marker.
    if(/TEXT(?:-|\\-|&#(?:45|x2d);|&hyphen;)MEMORY(?:-|\\-|&#(?:45|x2d);|&hyphen;)(?:UPDATE|SEARCH)/i.test(text))return invalid('formatted_markers','看到了记忆协议名称，但没有可识别的独立标记行。请将开始与结束标记各放一行，检查行尾反斜杠、Markdown 加粗、HTML 标签或转义字符；然后重新预览。');
    return invalid('no_protocol','这段内容不是可处理的记忆协议。请读取 AI 实际返回的 TEXT-MEMORY-UPDATE 或 TEXT-MEMORY-SEARCH 区段，并包含对应结束标记。');
  }
  const starts=all.filter(match=>!match[1]),ends=all.filter(match=>match[1]),types=new Set(all.map(match=>match[2]));
  if(starts.length===1&&ends.length===1&&starts[0][2]!==ends[0][2])return invalid('marker_mismatch','开始与结束标记的类型不一致。请核对同一个实际回执，UPDATE 对应 END-TEXT-MEMORY-UPDATE，SEARCH 对应 END-TEXT-MEMORY-SEARCH。');
  if(types.size>1)return invalid('mixed_types','接收区同时包含更新与检索标记。请先核对并保留其中一个完整的实际回执，再分别处理。');
  if(starts.length>1||ends.length>1)return invalid('duplicate_marker','同类型的开始或结束标记出现不止一次。请核对这些区段，只保留一个开始标记及其对应的结束标记后重试。');
  if(!starts.length)return invalid('missing_begin','找到了结束标记，但缺少独立的开始标记。请补齐同一实际回执的开头，并检查标记是否带有 Markdown 或转义字符。');
  if(!ends.length)return invalid('missing_end','找到了开始标记，但缺少独立的结束标记。请等待回复完整，或补齐同一实际回执的结尾后重试。');
  if(ends[0].index<starts[0].index)return invalid('reversed_markers','结束标记出现在开始标记前面。请按开始标记、JSON 内容、对应结束标记的顺序粘贴同一个实际回执。');
  const kind=starts[0][2]==='UPDATE'?'update':'search';
  return{status:'ready',kind,reason:'ready',message:kind==='update'?'已识别一个完整的记忆更新区段。下一步预览并校验 JSON、任务版本与资料包 ID。':'已识别一个完整的记忆检索区段。下一步校验请求，并核对允许检索的任务资料库。'};
}

export function strictObjectKeys(value,allowed,label,{optional=[]}={}){
  requireThat(value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype,`${label} 必须是 JSON 对象`);
  requireThat(Object.keys(value).every(key=>allowed.includes(key)&&!forbidden.has(key)),`${label} 包含不支持或保留的字段`);
  requireThat(allowed.filter(key=>!optional.includes(key)).every(key=>Object.hasOwn(value,key)),`${label} 缺少必填字段`);
}

function strictJSON(text,label){
  let value;try{value=JSON.parse(text);}catch{throw Error(`${label}必须使用严格 JSON，不能包含注释或尾随逗号`);}
  // JSON.parse accepts duplicate keys. Reject them so one visible protocol
  // block cannot have two competing meanings in different JSON consumers.
  const tokens=text.match(/"(?:[^"\\]|\\[\s\S])*"|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)||[];
  let index=0;
  function walk(depth=0){
    requireThat(depth<=8,`${label} JSON 嵌套过深`);
    const token=tokens[index++];
    if(token==='{'){
      const keys=new Set();
      while(tokens[index]!=='}'){
        const key=JSON.parse(tokens[index++]);
        requireThat(!keys.has(key)&&!forbidden.has(key),`${label} JSON 存在重复键或保留键`);keys.add(key);
        index++;walk(depth+1);if(tokens[index]===',')index++;
      }index++;
    }else if(token==='['){while(tokens[index]!==']'){walk(depth+1);if(tokens[index]===',')index++;}index++;}
  }
  walk();return value;
}

export function parseMemoryProtocol(text,marker,label){
  requireThat(markers.has(marker),'不支持的记忆协议');
  string(text,`${label}文本`,100000);
  const starts=[...text.matchAll(new RegExp(`^\\s*${marker}[ \\t]*\\r?$`,'gm'))];
  const ends=[...text.matchAll(new RegExp(`^\\s*END-${marker}[ \\t]*\\r?$`,'gm'))];
  requireThat(starts.length===1&&ends.length===1,`请提供恰好一个 ${marker} 至 END-${marker} 独立区段`);
  const start=starts[0].index+starts[0][0].length,end=ends[0].index;
  requireThat(end>start,`${label}区段顺序无效`);
  return strictJSON(text.slice(start,end).trim(),label);
}
