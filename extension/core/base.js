export const FORMAT = 'text-memory-backup';
export const VERSION = 5;
export const TABLES = ['libraries','entries','versions','sources','templates','rules','watches','packs','runs','events','tasks','taskVersions','rounds','extractionQueues'];
export const LIMITS = {entries:10000, bytes:20*1024*1024, content:100000, fields:40, packChars:100000, sources:2000};
export const clone = value => structuredClone(value);
export const now = () => new Date().toISOString();
export const id = prefix => `${prefix}_${crypto.randomUUID()}`;
export const norm = text => String(text ?? '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();
export const scopeMatches = (scope,requested) => !norm(scope)||norm(scope)===norm(requested);
export const equal = (a,b) => stable(a) === stable(b);
export function stable(value) {
  if (Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  if (value && typeof value === 'object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export async function hash(text) {
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
export function requireThat(condition,message,code='invalid_input') {
  if (!condition) { const error = new Error(message); error.code=code; throw error; }
}
export function string(value,name,max=1000,required=true) {
  requireThat(typeof value === 'string' && value.length<=max && (!required||value.trim()),`${name} 必须是${required?'非空':''}文本，最多 ${max} 字符`);
  return value;
}
export function isoDate(value) {
  if (!value) return '';
  requireThat(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'日期必须是有效的 YYYY-MM-DD');
  return value;
}
export function overlap(a,b) { return (!a.effectiveTo||!b.effectiveFrom||a.effectiveTo>b.effectiveFrom)&&(!b.effectiveTo||!a.effectiveFrom||b.effectiveTo>a.effectiveFrom); }
export function within(entry,at) { return (!entry.effectiveFrom||entry.effectiveFrom<=at)&&(!entry.effectiveTo||entry.effectiveTo>at); }
export function freshState() { return Object.fromEntries(TABLES.map(t=>[t,[]])); }
export const QUERY_TERM_LIMIT=512;
export function fieldTerms(text) {
  const out=[];
  for(const word of norm(text).match(/[\u3400-\u9fff]+|[\p{L}\p{N}_-]+/gu)||[]) {
    if(/^[\u3400-\u9fff]+$/.test(word)) {
      if(word.length===1)out.push(word);
      for(let i=0;i<word.length-1;i++)out.push(word.slice(i,i+2));
    }else out.push(word);
  }
  const terms=[...new Set(out)];
  // Preserve ordinary multi-part questions in full instead of throwing away
  // their middle topics. Very long queries still have a fixed scoring budget;
  // sample across the whole ordered term list, including both ends. Sampling
  // cannot guarantee every topic survives or provide semantic understanding.
  if(terms.length<=QUERY_TERM_LIMIT)return terms;
  return Array.from({length:QUERY_TERM_LIMIT},(_,index)=>terms[Math.floor(index*(terms.length-1)/(QUERY_TERM_LIMIT-1))]);
}
