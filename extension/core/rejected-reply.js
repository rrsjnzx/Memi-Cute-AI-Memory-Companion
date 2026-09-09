// Read-only recovery filter. It identifies an invalid block's binding without
// repairing JSON or authorizing it as a memory update. The adapter has the same
// small filter because its injected reader cannot import extension modules.
export function rejectedReplyBlock(full,expected){
  if(typeof full!=='string'||full.length>100000||!expected||/^[ \t]*(?:END-)?TEXT-MEMORY-PACK(?:[ \t]+[^\n]*)?[ \t]*\r?$/m.test(full))return null;
  const markers=[...full.matchAll(/^[ \t]*(END-)?TEXT-MEMORY-(UPDATE|SEARCH)[ \t]*\r?$/gm)];
  if(markers.length!==2||markers[0][1]||!markers[1][1]||markers[0][2]!==markers[1][2])return null;
  const [start,end]=markers,json=full.slice(start.index+start[0].length,end.index).trim();
  const tokens=json.match(/"(?:[^"\\]|\\[\s\S])*"|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\S/g)||[];
  if(tokens[0]!=='{'||tokens.at(-1)!=='}')return null;
  let depth=0;const found=new Map();
  for(let index=0;index<tokens.length;index++){
    const token=tokens[index];
    if(token==='{'||token==='['){depth++;continue;}
    if(token==='}'||token===']'){depth--;if(depth<0||depth===0&&index!==tokens.length-1)return null;continue;}
    if(token[0]!=='"'||tokens[index+1]!==':')continue;
    let key;try{key=JSON.parse(token);}catch{return null;}
    if(!['taskId','baseVersion','packId'].includes(key))continue;
    if(depth!==1||found.has(key))return null;
    let value;try{value=JSON.parse(tokens[index+2]);}catch{return null;}
    if(value!==expected[key])return null;found.set(key,value);
  }
  if(depth!==0||found.size!==3)return null;
  return{text:full.slice(start.index,end.index+end[0].length).trim(),kind:start[2]};
}
