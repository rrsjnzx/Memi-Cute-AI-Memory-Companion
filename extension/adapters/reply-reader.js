(() => {
  const VERSION='0.12.0',MAX_TEXT=100000,STABLE_MS=1000;
  if(globalThis.__textMemoryReplyReader?.version===VERSION)return;
  // These are public-DOM contracts and unverified selector candidates, not a
  // claim that the current production websites expose all of these attributes.
  const sites={'chatgpt.com':'chatgpt','chat.deepseek.com':'deepseek','www.kimi.com':'kimi','grok.com':'grok','claude.ai':'claude','www.qianwen.com':'qianwen','gemini.google.com':'gemini'};
  const roleAttributes=['data-message-author-role','data-message-role','data-author-role'];
  const deepseekAssistantSelector='.ds-virtual-list-visible-items > [data-virtual-list-item-key] > .ds-message > .ds-markdown.ds-assistant-message-main-content';
  const deepseekUserSelector='.ds-virtual-list-visible-items > [data-virtual-list-item-key] > .ds-message.d29f3d7d';
  const qianwenAssistantSelector='.chat-answers-card-wrap[data-chat-answers-wrap]';
  const qianwenUserSelector='.chat-question-card-wrap[data-chat-question-wrap]';
  const qianwenBodyCandidateSelector='.answer-common-card[data-mt=""] > .markdown-pc-special-class[translate="no"] > .qk-markdown.qk-markdown-react';
  const qianwenBodySelector=qianwenBodyCandidateSelector+'.qk-markdown-complete';
  const qianwenUserBodySelector='.message-card-wrap.question[data-mt="text/plain"] > .question-text-card';
  const genericSelectors=[...roleAttributes.map(name=>`[${name}]`),'[data-role="assistant"]','[data-role="user"]','[data-role="tool"]','[data-testid="assistant-message"]','[data-testid="assistant-response"]','[data-testid="user-message"]','.font-claude-response','[data-testid="transcript-row"][data-perf-row="human"]'];
  // New-site roles are identified only by the observed conversation wrappers.
  // Generic attributes still detect conflicting authors inside those wrappers.
  const selectors=location.hostname==='www.qianwen.com'?[qianwenAssistantSelector,qianwenUserSelector]:[...genericSelectors,...(location.hostname==='chat.deepseek.com'?[deepseekAssistantSelector,deepseekUserSelector]:[])];
  const ignoredTags=new Set(['INPUT','TEXTAREA','SELECT','BUTTON','SCRIPT','STYLE','NOSCRIPT','TEMPLATE']);
  const blockTags=new Set(['DIV','P','PRE','BLOCKQUOTE','LI','UL','OL','SECTION','ARTICLE','H1','H2','H3','H4','TABLE','TR']);
  const reserved=new Set(['__proto__','constructor','prototype']);
  let observation=null,displayObservation=null,diagnosticObservation=null,sequence=0,nodeSequence=0;
  const nodeKeys=new WeakMap();
  const fail=(status,reason,message,details={})=>({status,reason,message,...details});
  const reject=(reason,message)=>{const error=Error(message);error.reason=reason;throw error;};
  function verificationShown(){
    return[...document.querySelectorAll('iframe[id="baxia-dialog-content"]')].some(frame=>{
      if(!frame.getClientRects().length)return false;
      for(let node=frame;node;node=node.parentElement){const style=globalThis.getComputedStyle?.(node);if(node.hidden||node.getAttribute?.('aria-hidden')==='true'||node.hasAttribute?.('inert')||style?.display==='none'||['hidden','collapse'].includes(style?.visibility))return false;}
      return true;
    });
  }
  function role(node){
    const values=roleAttributes.map(name=>node.getAttribute?.(name)).filter(Boolean);
    const candidate=node.getAttribute?.('data-role');if(candidate)values.push(candidate);
    const testId=node.getAttribute?.('data-testid');if(['assistant-message','assistant-response'].includes(testId))values.push('assistant');
    if(testId==='user-message')values.push('user');
    // Read-only DOM observation on 2026-09-06 identified this assistant wrapper
    // on Claude. This is selector evidence, not extension workflow acceptance.
    if(location.hostname==='claude.ai'&&node.classList?.contains('font-claude-response'))values.push('assistant');
    // The observed human transcript row is an ordering barrier in the strict
    // interface. Display opt-in may verify its current user pack. Keep reading the inner assistant wrapper so
    // row-level accessibility headings cannot contaminate its protocol.
    if(location.hostname==='claude.ai'&&testId==='transcript-row'&&node.getAttribute('data-perf-row')==='human')values.push('user');
    // Read-only public-DOM observation on 2026-09-07, not a real extension run:
    // DeepSeek's visible virtual-list rows expose separate main-answer and
    // thinking siblings. Trust only this exact main-answer hierarchy. The
    // observed user class is an ordering barrier. Display opt-in reads only
    // its separately verified direct collapsible-text child below.
    if(location.hostname==='chat.deepseek.com'){
      if(node.matches?.(deepseekAssistantSelector))values.push('assistant');
      if(node.matches?.(deepseekUserSelector))values.push('user');
    }
    if(location.hostname==='www.qianwen.com'){
      if(node.matches?.(qianwenAssistantSelector))values.push('assistant');
      if(node.matches?.(qianwenUserSelector))values.push('user');
    }
    const distinct=[...new Set(values.map(value=>value.toLowerCase()))];return distinct.length>1?'conflicting':distinct[0]||null;
  }
  function surfaceIgnored(node){
    if(node.nodeType!==1)return false;
    const editable=node.getAttribute('contenteditable');
    const style=globalThis.getComputedStyle?.(node);
    return ignoredTags.has(node.tagName)||node.isContentEditable||editable!==null&&editable.toLowerCase()!=='false'||
      node.hidden||style?.display==='none'||['hidden','collapse'].includes(style?.visibility)||node.getAttribute('aria-hidden')==='true'||node.hasAttribute('data-text-memory-self-test')||node.hasAttribute('data-text-memory-injected')||
      location.hostname==='chat.deepseek.com'&&node.classList?.contains('ds-think-content');
  }
  function ignored(node){return surfaceIgnored(node)||['user','tool','system','developer','conflicting'].includes(role(node));}
  function eligibleMessage(node){
    if(!['assistant','user','tool','system','developer','conflicting'].includes(role(node))||!node.isConnected||!node.getClientRects().length)return false;
    for(let current=node;current;current=current.parentElement)if(surfaceIgnored(current))return false;
    if(location.hostname==='www.qianwen.com'&&(node.matches(qianwenAssistantSelector)||node.matches(qianwenUserSelector)))for(let parent=node.parentElement;parent;parent=parent.parentElement)if(role(parent)&&role(parent)!==role(node))return false;
    return true;
  }
  function messages(){
    let nodes=[...document.querySelectorAll(selectors.join(','))].filter(eligibleMessage);
    if(location.hostname==='chat.deepseek.com'){
      const mainAnswers=nodes.filter(node=>node.matches(deepseekAssistantSelector));
      // If future markup also labels an outer row as assistant, still read
      // only the observed main body. Explicit user/conflicting ancestors stay
      // authoritative barriers and cannot be discarded by this projection.
      nodes=nodes.filter(node=>role(node)!=='assistant'||!mainAnswers.some(body=>body!==node&&node.contains(body)));
    }
    // A nested rendering wrapper is part of the same message, not another
    // response. Retain its outer authoritative assistant container.
    return nodes.filter(node=>!nodes.some(other=>other!==node&&other.contains(node)));
  }
  function latestMessage(){return messages().at(-1)||null;}
  function assistantBody(root){
    // ChatGPT's observed LI wrapper includes an accessibility role heading
    // outside this explicit body (2026-09-07). Keep the LI as the authoritative
    // message/order/streaming boundary, but never parse its surrounding chrome.
    const qianwen=location.hostname==='www.qianwen.com'&&root.matches(qianwenAssistantSelector);
    if(!qianwen&&(location.hostname!=='chatgpt.com'||!root.matches('li[data-message-role="assistant"]')))return root;
    const bodies=[...root.querySelectorAll(qianwen?qianwenBodyCandidateSelector:'[data-assistant-markdown]')].filter(node=>{
      if(!node.isConnected||!node.getClientRects().length)return false;
      for(let current=node;current&&current!==root;current=current.parentElement)if(ignored(current))return false;
      return true;
    });
    if(!bodies.length)reject('assistant_body_missing','最新回复的正文区域尚未显示，请等待页面完成渲染');
    if(bodies.length!==1)reject('assistant_body_ambiguous','最新回复存在多个正文区域，已停止自动选择，请核对原网页');
    if(qianwen&&!bodies[0].classList.contains('qk-markdown-complete'))reject('assistant_body_missing','千问正文尚未出现已观察到的完成标记，请等待页面完成渲染');
    return bodies[0];
  }
  function readText(root,author='assistant'){
    let count=0,visits=0;const parts=[];
    const append=value=>{count+=value.length;if(count>MAX_TEXT)reject('text_limit','最新回复超过 100000 字符，请手动提供单个协议区段');parts.push(value);};
    function walk(node,depth){
      if(++visits>50000||depth>128)reject('dom_limit','最新回复结构过大，请手动提供单个协议区段');
      if(node.nodeType===3){append(node.textContent||'');return;}
      if(node.nodeType!==1||(author==='assistant'?ignored(node):surfaceIgnored(node)||role(node)&&role(node)!=='user'||location.hostname==='chat.deepseek.com'&&node.classList?.contains('ds-collapsible-text-toggle-button')))return;
      if(node!==root&&node.getAttribute('aria-hidden')==='true')return;
      if(node.tagName==='BR'){append('\n');return;}
      const block=blockTags.has(node.tagName);if(block&&parts.length&&parts.at(-1)!=='\n')append('\n');
      for(const child of node.childNodes)walk(child,depth+1);
      if(block&&parts.length&&parts.at(-1)!=='\n')append('\n');
    }
    walk(root,0);return parts.join('').replace(/\r\n?/g,'\n').trim();
  }
  function streaming(root){
    const explicit=node=>node.getAttribute?.('aria-busy')==='true'||node.getAttribute?.('data-is-streaming')==='true'||node.getAttribute?.('data-streaming')==='true'||location.hostname==='claude.ai'&&node.getAttribute?.('data-perf-row-streaming')==='true';
    for(let node=root;node;node=node.parentElement)if(explicit(node))return true;
    if([...root.querySelectorAll('[aria-busy="true"],[data-is-streaming="true"],[data-streaming="true"],[data-perf-row-streaming="true"]')].some(node=>explicit(node)&&node.getClientRects().length))return true;
    const observedQianwenStop=location.hostname==='www.qianwen.com'&&[...document.querySelectorAll('button[aria-label="停止回答"]')].some(node=>node.getClientRects().length&&!node.hidden&&node.getAttribute('aria-hidden')!=='true'&&!node.disabled&&node.getAttribute('aria-disabled')!=='true');
    return observedQianwenStop||[...document.querySelectorAll('button[data-testid="stop-button"],button[aria-label="Stop generating"],button[aria-label="Stop response"],button[aria-label="停止生成"]')].some(node=>node.getClientRects().length&&!node.hidden&&node.getAttribute('aria-hidden')!=='true');
  }
  function generationCheck(root){
    const attributes=new Set();
    for(let node=root;node;node=node.parentElement)for(const name of ['data-is-streaming','data-streaming','aria-busy',...(location.hostname==='claude.ai'?['data-perf-row-streaming']:[])])if(node.getAttribute?.(name)==='false')attributes.add(name);
    return{basis:attributes.size?'explicit_false':'no_observed_busy_signal',attributes:[...attributes],stableSamples:2,minIntervalMs:STABLE_MS};
  }
  function strictJSON(text){
    let parsed;try{parsed=JSON.parse(text);}catch{reject('invalid_json','回复协议必须使用完整严格 JSON');}
    const tokens=text.match(/"(?:[^"\\]|\\[\s\S])*"|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)||[];let index=0;
    function walk(depth=0){
      if(depth>8)reject('invalid_json','回复协议 JSON 嵌套过深');
      const token=tokens[index++];
      if(token==='{'){const keys=new Set();while(tokens[index]!=='}'){const key=JSON.parse(tokens[index++]);if(keys.has(key)||reserved.has(key))reject('invalid_json','回复协议含重复字段或保留字段');keys.add(key);index++;walk(depth+1);if(tokens[index]===',')index++;}index++;}
      else if(token==='['){while(tokens[index]!==']'){walk(depth+1);if(tokens[index]===',')index++;}index++;}
    }
    walk();return parsed;
  }
  function fields(value,keys,optional=[]){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)&&!optional.includes(key))||keys.some(key=>!Object.hasOwn(value,key)))reject('invalid_fields','回复协议字段不完整或包含未知字段');}
  function string(value,max,empty=false){if(typeof value!=='string'||value.length>max||!empty&&!value.trim())reject('invalid_fields','回复协议文字字段为空或超过上限');}
  function withoutProtocol(text,start,end){
    let from=start.index,to=end.index+end[0].length;
    // A rendered code element normally has no literal Markdown fences. If the
    // assistant did output fences as text, remove them only when the verified
    // protocol is their sole non-whitespace content. Never search across prose
    // or consume a neighbouring code block.
    const before=text.slice(0,from),after=text.slice(to);
    const opening=before.match(/(?:^|\n)[ \t]*(`{3,}|~{3,})([^\n]*)\n(?:[ \t]*\n)*$/);
    const closing=after.match(/^(?:[ \t]*\n)+[ \t]*(`{3,}|~{3,})[ \t]*(?=\n|$)/);
    // The adjacent fence could instead close an earlier ordinary code block.
    // Track preceding literal fences so that case is kept verbatim as prose.
    let activeFence=null;
    for(const line of before.matchAll(/^[^\n]*(?:\n|$)/gm)){
      const fence=line[0].replace(/\n$/,'').match(/^[ \t]*(`{3,}|~{3,})(.*)$/);if(!fence)continue;
      if(activeFence){if(fence[1][0]===activeFence.mark[0]&&fence[1].length>=activeFence.mark.length&&!fence[2].trim())activeFence=null;}
      else if(fence[1][0]!=='`'||!fence[2].includes('`'))activeFence={index:line.index,mark:fence[1]};
    }
    if(opening&&closing&&opening[1][0]===closing[1][0]&&closing[1].length>=opening[1].length&&
      activeFence?.index===opening.index+(opening[0].startsWith('\n')?1:0)){
      from=opening.index+(opening[0].startsWith('\n')?1:0);to+=closing[0].length;
    }
    return(text.slice(0,from)+text.slice(to)).trim();
  }
  function parse(text,expected){
    // Echoing a delivered pack can repeat its example UPDATE/SEARCH. Such a
    // template is source material, never an actual assistant memory receipt.
    if(/^[ \t]*(?:END-)?TEXT-MEMORY-PACK(?:[ \t]+[^\n]*)?[ \t]*$/m.test(text))return fail('invalid_reply','echoed_pack','最新回复回显了资料包包装，不能把包内格式示例当成记忆更新；请使用 AI 实际提出的单个回执');
    const markers=[...text.matchAll(/^[ \t]*(END-)?TEXT-MEMORY-(UPDATE|SEARCH)[ \t]*$/gm)];
    if(!markers.length)return fail('waiting','no_protocol','网页已显示 AI 回答，但尚无完整记忆区段；任务记忆尚未更新');
    const starts=markers.filter(match=>!match[1]),ends=markers.filter(match=>match[1]);
    if(starts.length>1||ends.length>1)return fail('ambiguous','multiple_protocols','最新 AI 回复含多个或混合协议，请仅保留一个完整区段');
    if(starts.length!==1||ends.length!==1)return fail('waiting','incomplete_protocol','最新 AI 回复的记忆协议尚未完整');
    const start=starts[0],end=ends[0];if(start[2]!==end[2]||end.index<start.index)return fail('ambiguous','marker_mismatch','回复协议标记类型或顺序不一致');
    const kind=start[2],payload=strictJSON(text.slice(start.index+start[0].length,end.index).trim());
    fields(payload,kind==='SEARCH'?['taskId','baseVersion','packId','query']:['taskId','baseVersion','packId','progress','openQuestions','facts']);
    string(payload.taskId,200);string(payload.packId,199);if(!Number.isSafeInteger(payload.baseVersion)||payload.baseVersion<1)reject('invalid_fields','回复任务版本必须是正整数');
    if(kind==='SEARCH')string(payload.query,2000);
    else{
      string(payload.progress,12000,true);string(payload.openQuestions,12000,true);
      if(!Array.isArray(payload.facts)||payload.facts.length>20)reject('invalid_fields','新增记忆候选最多 20 条');
      for(const fact of payload.facts){
        // This transport does not know the authoritative pack version. Carry
        // bounded optional extraction fields to the core, which alone decides
        // whether v3 is authorized and whether a quote was actually provided.
        fields(fact,['title','content','aliases'],['evidence','assessment']);string(fact.title,300);string(fact.content,10000);
        if(!Array.isArray(fact.aliases)||fact.aliases.length>20)reject('invalid_fields','候选别名最多 20 个');fact.aliases.forEach(alias=>string(alias,200));
        if(Object.hasOwn(fact,'assessment')&&!['supported','uncertain','conflict'].includes(fact.assessment))reject('invalid_fields','提炼自评必须是 supported、uncertain 或 conflict');
        if(Object.hasOwn(fact,'evidence')){
          if(!Array.isArray(fact.evidence)||fact.evidence.length>3)reject('invalid_fields','每条候选最多 3 处原文引用');
          for(const evidence of fact.evidence){
            fields(evidence,['sourceId','version','quote']);string(evidence.sourceId,200);string(evidence.quote,4000,true);
            if(!Number.isSafeInteger(evidence.version)||evidence.version<1)reject('invalid_fields','引用来源版本必须是正整数');
          }
        }
      }
    }
    if(payload.taskId!==expected.taskId)return fail('stale_reply','task_mismatch','这条回复属于另一个任务。请切回对应任务，或同步当前资料后让 AI 继续回答。');
    if(payload.baseVersion!==expected.baseVersion)return fail('stale_reply','version_mismatch',`AI 回复使用任务 v${payload.baseVersion}，当前任务是 v${expected.baseVersion}。请同步当前资料后让 AI 按当前版本继续回答。`);
    if(payload.packId!==expected.packId)return fail('stale_reply','pack_mismatch','AI 回复中的资料包与当前轮次不一致。请同步当前资料后让 AI 继续回答。');
    return{kind,text:text.slice(start.index,end.index+end[0].length).trim(),answerText:withoutProtocol(text,start,end)};
  }
  function safeAuthor(node,author){
    if(role(node)!==author)return false;
    for(let parent=node.parentElement;parent;parent=parent.parentElement)if(surfaceIgnored(parent)||role(parent)&&role(parent)!==author)return false;
    // Same-author rendering wrappers are allowed; a visible opposite-author
    // descendant cannot manufacture an assistant reply or user-pack pairing.
    return![...node.querySelectorAll([...selectors,...genericSelectors].join(','))].filter(eligibleMessage).some(child=>role(child)!==author);
  }
  function displayUserRoot(node){
    if(location.hostname==='www.qianwen.com'){
      if(!node.matches(qianwenUserSelector))return null;
      const bodies=[...node.querySelectorAll(qianwenUserBodySelector)].filter(body=>body.isConnected&&body.getClientRects().length&&!surfaceIgnored(body));
      if(bodies.length!==1)return null;
      for(let current=bodies[0];current&&current!==node;current=current.parentElement)if(surfaceIgnored(current)||role(current)&&role(current)!=='user')return null;
      return bodies[0];
    }
    if(location.hostname!=='chat.deepseek.com')return node;
    const rows=[...(node.matches(deepseekUserSelector)?[node]:[]),...node.querySelectorAll(deepseekUserSelector)];
    if(rows.length!==1)return null;
    const wrappers=[...rows[0].childNodes].filter(child=>child.nodeType===1&&child.tagName==='DIV'&&child.classList.contains('fbb737a4'));
    if(wrappers.length!==1||surfaceIgnored(wrappers[0]))return null;
    const contents=[...wrappers[0].childNodes].filter(child=>child.nodeType===1&&child.classList.contains('ds-collapsible-text')&&!child.classList.contains('ds-collapsible-text-toggle-button'));
    return contents.length===1&&!surfaceIgnored(contents[0])?contents[0]:null;
  }
  function pairedUser(node,expected,ordered){
    const index=ordered.indexOf(node);let user=null;
    for(let i=index-1;i>=0;i--){const author=role(ordered[i]);if(['conflicting','tool','system','developer'].includes(author))return null;if(author==='user'){user=ordered[i];break;}}
    if(!user||!safeAuthor(user,'user'))return null;
    if(location.hostname==='www.qianwen.com'&&user.getAttribute('data-chat-question-wrap')!==node.getAttribute('data-chat-answers-wrap'))return null;
    const root=displayUserRoot(user);if(!root)return null;
    const text=readText(root,'user'),lines=text.split('\n'),markers=[];
    const markerPattern=location.hostname==='www.qianwen.com'?/^[ \t\u00a0]*(END-)?TEXT-MEMORY-PACK(?:[ \t\u00a0]+([^\n]*))?[ \t\u00a0]*$/:/^[ \t]*(END-)?TEXT-MEMORY-PACK(?:[ \t]+([^\n]*))?[ \t]*$/;
    for(let i=0;i<lines.length;i++){const match=markerPattern.exec(lines[i]);if(match)markers.push({end:!!match[1],id:(match[2]||'').trim(),index:i});}
    if(markers.length!==2||markers[0].end||!markers[1].end||markers.some(marker=>marker.id!==expected.packId)||!lines.slice(markers[0].index+1,markers[1].index).join('\n').trim())return null;
    return{node:user,text};
  }
  function displayPrefix(text,index){
    let prefix=text.slice(0,index),active=null;
    for(const line of prefix.matchAll(/^[^\n]*(?:\n|$)/gm)){
      const fence=line[0].replace(/\n$/,'').match(/^[ \t]*(`{3,}|~{3,})(.*)$/);if(!fence)continue;
      if(active){if(fence[1][0]===active.mark[0]&&fence[1].length>=active.mark.length&&!fence[2].trim())active=null;}
      else if(fence[1][0]!=='`'||!fence[2].includes('`'))active={index:line.index,end:line.index+line[0].length,mark:fence[1]};
    }
    if(active&&!prefix.slice(active.end).trim())prefix=prefix.slice(0,active.index);
    return prefix.trim();
  }
  const displayProbe=value=>value.trim().replace(/\\([_-])/g,'$1').replace(/&#(?:45|x2d);/gi,'-').replace(/^[>*_`~ \t]+/,'').replace(/[*_`~\\]+$/,'');
  // Invalid JSON is kept only for diagnosis. Match top-level identities without
  // repairing its syntax; malformed/stale/template material is never accepted.
  function rejectedReplyBlock(full,expected){
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
  function memoryObjects(full){
    const regions=[];let start=-1,depth=0,quoted=false,escaped=false;
    const record=end=>{
      const value=full.slice(start,end),keys=new Set();
      for(const match of value.matchAll(/("(?:[^"\\]|\\[\s\S])*")\s*:/g)){try{keys.add(JSON.parse(match[1]));}catch{}}
      const identities=['taskId','baseVersion','packId'].filter(key=>keys.has(key)).length;
      // A generic business/code example containing a single taskId is not a
      // memory receipt. Markerless payloads need a recognizable combination.
      if(identities>=2||identities>=1&&['progress','openQuestions','facts','query'].some(key=>keys.has(key)))regions.push({start,end,value});
    };
    for(let i=0;i<full.length;i++){
      const char=full[i];if(start<0){if(char==='{'){start=i;depth=1;quoted=false;escaped=false;}continue;}
      if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
      if(char==='"')quoted=true;else if(char==='{')depth++;else if(char==='}'&&!--depth){record(i+1);start=-1;}
    }
    if(start>=0)record(full.length);return regions;
  }
  function displayIdentityConflict(full,expected){
    // Rejection only: even an unfinished/invalid receipt can already identify
    // a different round. It must not borrow the current user pack's pairing.
    // This never repairs or accepts malformed JSON as a memory update.
    const candidates=memoryObjects(full).map(region=>region.value);let start=null;
    for(const line of full.matchAll(/^[^\n]*(?:\n|$)/gm)){
      const probe=displayProbe(line[0]),marker=/(END-)?TEXT-MEMORY-(?:UPDATE|SEARCH)/.exec(probe);if(!marker)continue;
      if(!marker[1]&&start===null)start=line.index;
      if(marker[1]&&start!==null){candidates.push(full.slice(start,line.index+line[0].length));start=null;}
    }
    if(start!==null)candidates.push(full.slice(start));
    for(const candidate of candidates)for(const match of candidate.matchAll(/("(?:[^"\\]|\\[\s\S])*")\s*:\s*("(?:[^"\\]|\\[\s\S])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/g)){
      let key,value;try{key=JSON.parse(match[1]);value=JSON.parse(match[2]);}catch{continue;}
      if(['taskId','baseVersion','packId'].includes(key)&&value!==expected[key])return true;
    }
    return false;
  }
  function displayText(full){
    let text=full;
    // This is a display-only redactor, never a protocol repair/parser. Complete
    // exact blocks are removed. Damaged or streaming markers conservatively
    // stop display at their first line, so later prose may be withheld.
    for(let pass=0;pass<100;pass++){
      const lines=[...text.matchAll(/^[^\n]*(?:\n|$)/gm)],last=lines.findLastIndex(line=>line[0].trim()),objects=memoryObjects(text);let changed=false;
      for(let i=0;i<lines.length;i++){
        const raw=lines[i][0].replace(/\n$/,''),clean=raw.trim(),exact=/^[ \t]*(END-)?TEXT-MEMORY-(UPDATE|SEARCH)[ \t]*$/.exec(raw);
        const probe=displayProbe(clean);
        const partial=i===last&&probe&&['TEXT-MEMORY-UPDATE','TEXT-MEMORY-SEARCH','END-TEXT-MEMORY-UPDATE','END-TEXT-MEMORY-SEARCH'].some(marker=>marker.startsWith(probe));
        const suspect=exact||/TEXT-?MEMORY(?:-|\s|$)/i.test(probe)||partial;
        // Also withhold markerless memory JSON once its identifying keys are
        // visible. We do not decode it or expose it as an accepted receipt.
        const memoryJSON=objects.find(region=>region.start>=lines[i].index&&region.start<lines[i].index+lines[i][0].length);
        if(!suspect&&!memoryJSON)continue;
        if(exact&&!exact[1]){
          let end=null;
          for(let j=i+1;j<lines.length;j++){
            const marker=/^[ \t]*(END-)?TEXT-MEMORY-(UPDATE|SEARCH)[ \t]*$/.exec(lines[j][0].replace(/\n$/,''));
            if(marker){if(marker[1]&&marker[2]===exact[2]){marker.index=lines[j].index;end=marker;}break;}
          }
          if(end){exact.index=lines[i].index;text=withoutProtocol(text,exact,end);changed=true;break;}
        }
        let from=lines[i].index;
        if(memoryJSON&&!suspect)from=memoryJSON.start;
        return displayPrefix(text,from);
      }
      if(!changed)return text.trim();
    }
    return'';
  }
  async function readMemory(request){
    const call=++sequence,expected=request?.expected?{...request.expected}:null,url=location.href,adapter=sites[location.hostname];
    const reset=result=>{observation=null;return result;};
    if(!adapter)return reset(fail('unsupported','site','本站尚未提供回复读取候选适配，可手动粘贴协议'));
    if(adapter==='qianwen'&&verificationShown())return reset(fail('unsupported','site_verification','千问正在要求网页人机验证，请先在原网页完成验证，再继续读取回复'));
    if(adapter==='gemini')return reset(fail('unsupported','reply_not_observed','此站输入框已适配，但尚未核实真实回复区域；请复制 AI 回复到侧栏，不能将输入框适配当成自动读回通过'));
    if(!expected||typeof expected.taskId!=='string'||!expected.taskId.trim()||expected.taskId.length>200||typeof expected.packId!=='string'||!expected.packId.trim()||expected.packId.length>199||!Number.isSafeInteger(expected.baseVersion)||expected.baseVersion<1)return reset(fail('invalid_reply','expected_identity','请先选择当前已交付的任务资料包'));
    if(document.visibilityState==='hidden')return reset(fail('stale_target','hidden','目标网页已切换到后台，请切回要读取的 AI 网页'));
    const expectedKey=JSON.stringify([expected.taskId,expected.baseVersion,expected.packId]),node=latestMessage();
    if(!node)return reset(fail('unsupported','assistant_not_found','当前网页没有可识别的已显示回复，可能尚未渲染或页面结构已变化；不能据此判断 AI 是否已回答'));
    if(role(node)!=='assistant')return reset(fail('waiting','awaiting_assistant','当前网页尚未显示可读取的 AI 正文；若其他端已能看到回答，请恢复此网页显示后再检查'));
    try{
      const body=assistantBody(node),full=readText(body);
      if(!full)return reset(streaming(node)?fail('waiting','streaming','网页仍明确显示正在生成，请稍候'):fail('waiting','empty_reply','网页回复区域仍为空，尚无正文可读取；这不是记忆格式错误，请先核对原网页显示'));
      const parsed=parse(full,expected);
      if(parsed.status)return reset(parsed);
      if(streaming(node))return reset(fail('waiting','streaming','网页仍明确显示正在生成，请稍候'));
      const timestamp=Date.now();
      if(!observation||observation.node!==node||observation.body!==body||observation.url!==url||observation.expectedKey!==expectedKey||observation.full!==full||timestamp<observation.since){observation={node,body,url,expectedKey,full,since:timestamp};return fail('waiting','stabilizing','协议已完整，正在复核回复是否稳定',{retryAfterMs:STABLE_MS});}
      const stableForMs=timestamp-observation.since;if(stableForMs<STABLE_MS)return fail('waiting','stabilizing','回复尚未稳定，请稍候',{retryAfterMs:STABLE_MS-stableForMs});
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(parsed.text));
      if(call!==sequence)return fail('waiting','superseded','已有更新的回复读取请求');
      if(location.href!==url||document.visibilityState==='hidden')return reset(fail('stale_target','navigation','页面或会话已改变，请重新连接当前网页'));
      if(latestMessage()!==node||assistantBody(node)!==body||readText(body)!==full||streaming(node))return reset(fail('waiting','changed','回复刚发生变化，请重新复核'));
      if(!nodeKeys.has(node))nodeKeys.set(node,`reply_${++nodeSequence}`);
      const qianwen=adapter==='qianwen',selector=qianwen?qianwenAssistantSelector+' '+qianwenBodySelector:body!==node?'li[data-message-role="assistant"] [data-assistant-markdown]':selectors.find(value=>node.matches(value));
      return{status:'reply_ready',kind:parsed.kind,text:parsed.text,answerText:parsed.answerText,fingerprint:Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join(''),stableForMs,
        source:{adapter,author:'assistant',selector,sourceEvidence:qianwen?'observed_dom_2026_09_08':body!==node||node.matches(deepseekAssistantSelector)&&location.hostname==='chat.deepseek.com'?'observed_dom_2026_09_07':selector==='.font-claude-response'?'observed_dom_2026_09_06':'candidate_unverified',messageKey:nodeKeys.get(node),generationCheck:generationCheck(node)},note:'仅检查公开 DOM 中完整协议与两次稳定读回；不保证模型已结束生成，仍须用户核对。'};
    }catch(error){return reset(fail(error.reason==='assistant_body_missing'?'waiting':error.reason==='assistant_body_ambiguous'?'ambiguous':['text_limit','dom_limit'].includes(error.reason)?'too_large':'invalid_reply',error.reason||'dom_read',error.message||'回复读取失败，请手动粘贴协议'));}
  }
  async function read(request){
    const include=request?.includeDisplay===true,expected=request?.expected?{...request.expected}:null,url=location.href,call=sequence+1;
    let initialNode=null,initialBody=null;if(include){try{initialNode=latestMessage();if(initialNode)initialBody=assistantBody(initialNode);}catch{}}
    let result=await readMemory(request);
    // Opt-in consumers must not fall back to the older, less conservative
    // answerText field when display redaction removes everything or pairing
    // fails. The non-opt-in strict interface remains unchanged.
    if(include&&result.status==='reply_ready')result={...result,answerText:''};
    const omit=()=>{displayObservation=null;diagnosticObservation=null;return result;};
    if(!include||call!==sequence||location.href!==url||document.visibilityState==='hidden'||!expected||!['reply_ready','waiting','invalid_reply','ambiguous'].includes(result.status)||result.reason==='expected_identity')return omit();
    try{
      const ordered=messages(),node=ordered.at(-1);if(!node||node!==initialNode||!safeAuthor(node,'assistant'))return omit();
      const body=assistantBody(node);if(body!==initialBody)return omit();const full=readText(body);if(!full)return omit();
      let parsed;try{parsed=parse(full,expected);}catch{parsed=null;}
      if(parsed?.status==='stale_reply'||displayIdentityConflict(full,expected))return omit();
      const user=parsed&&!parsed.status?null:pairedUser(node,expected,ordered),pairing=parsed&&!parsed.status?'protocol':user?'user_pack':null;
      if(!pairing)return omit();
      const text=displayText(full),busy=streaming(node),timestamp=Date.now(),key=JSON.stringify([expected.taskId,expected.baseVersion,expected.packId]);
      if(location.href!==url||document.visibilityState==='hidden'||latestMessage()!==node||assistantBody(node)!==body||readText(body)!==full)return omit();
      const previous=displayObservation;
      if(busy||!previous||previous.node!==node||previous.body!==body||previous.url!==url||previous.expectedKey!==key||previous.text!==text||previous.pairing!==pairing||previous.userNode!==user?.node||previous.userText!==user?.text||previous.busy||timestamp<previous.since)displayObservation={node,body,url,expectedKey:key,text,pairing,userNode:user?.node,userText:user?.text,busy,since:timestamp};
      const phase=busy?'streaming':timestamp-displayObservation.since>=STABLE_MS?'stable':'settling';
      if(!nodeKeys.has(node))nodeKeys.set(node,`reply_${++nodeSequence}`);
      const candidate=result.status==='invalid_reply'&&result.reason==='invalid_json'&&!busy&&pairing==='user_pack'?rejectedReplyBlock(full,expected):null;
      const previousDiagnostic=diagnosticObservation;
      if(!candidate)diagnosticObservation=null;
      else if(!previousDiagnostic||previousDiagnostic.node!==node||previousDiagnostic.body!==body||previousDiagnostic.url!==url||previousDiagnostic.expectedKey!==key||previousDiagnostic.full!==full||previousDiagnostic.userNode!==user?.node||previousDiagnostic.userText!==user?.text||timestamp<previousDiagnostic.since)diagnosticObservation={node,body,url,expectedKey:key,full,userNode:user?.node,userText:user?.text,since:timestamp};
      const rejected=candidate&&timestamp-diagnosticObservation.since>=STABLE_MS?candidate:null;
      const output=result.status==='invalid_reply'&&result.reason==='invalid_json'&&(busy||candidate&&!rejected)?fail('waiting',busy?'streaming':'diagnostic_stabilizing',busy?'网页仍在生成，尚不保存异常记忆区段':'记忆区段暂不能解析，正在复核原文是否稳定',{retryAfterMs:STABLE_MS}):result;
      return{...output,...(result.status==='reply_ready'?{answerText:text}:{}),display:{text,phase,pairing,messageKey:nodeKeys.get(node)},...(rejected?{diagnostic:{text:rejected.text,phase:'stable',pairing:'user_pack',messageKey:nodeKeys.get(node)}}:{})};
    }catch{return omit();}
  }
  globalThis.__textMemoryReplyReader={version:VERSION,read};
})();
