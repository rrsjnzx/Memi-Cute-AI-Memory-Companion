import {norm} from './base.js';
import {templateFor} from './library.js';

// This disposable index accelerates the existing substring matcher. It is not
// a semantic index and never caches eligibility, permissions, or source checks.
export const KEYWORD_INDEX_LIMITS=Object.freeze({snapshots:2,entries:10_000,characters:8_000_000,grams:65_536,postings:500_000});
const snapshotTokens=new WeakMap(),recent=new Map();
export function clearKeywordIndexCache(){recent.clear();}

function rawComponents(state,entry){
  const template=templateFor(state,entry),fields=template?Object.fromEntries(Object.entries(entry.fields).filter(([key])=>template.fields.find(f=>f.name===key)?.match!==false)):entry.fields;
  return [entry.title,entry.aliases.join(' '),entry.tags.join(' '),JSON.stringify(fields),entry.content];
}
function compile(position,raw){
  return {position,raw,texts:raw.map(norm),identifiers:new Set(norm(raw[0]+' '+raw[1]).match(/[a-z0-9_]+(?:-[a-z0-9_]+)*/g)||[])};
}
function buildPostings(rows){
  const postings=new Map();let count=0;
  for(const row of rows){
    const grams=new Set();
    for(const text of row.texts)for(let i=0;i<text.length;i++){
      grams.add(text[i]);if(i+1<text.length)grams.add(text.slice(i,i+2));
      // Bound temporary unique grams as well as retained postings.
      if(grams.size>KEYWORD_INDEX_LIMITS.grams)return null;
    }
    for(const gram of grams){
      if(++count>KEYWORD_INDEX_LIMITS.postings)return null;
      let positions=postings.get(gram);
      if(!positions){if(postings.size>=KEYWORD_INDEX_LIMITS.grams)return null;postings.set(gram,positions=new Set());}
      positions.add(row.position);
    }
  }
  return {postings,count};
}
function candidates(postings,terms){
  if(!postings)return null; // No prefilter; the exact matcher still runs.
  const result=new Set();
  for(const term of terms){
    let smallest=null,missing=false;
    for(let i=0;i<Math.max(1,term.length-1);i++){
      const list=postings.get(term.length===1?term:term.slice(i,i+2));
      if(!list){missing=true;break;}
      if(!smallest||list.size<smallest.size)smallest=list;
    }
    if(!missing&&smallest)for(const position of smallest)result.add(position);
  }
  return result;
}

/** Entries are already checked for the current query; positions refer to the
 * current state.entries array, not IDs. Comparing raw values catches in-place
 * edits, reordered rows, same-ID snapshots, and mutable template match flags.
 * No full-body hash or normalization is needed on an unchanged warm query.
 */
export function prepareKeywordIndex(state,eligible){
  let token=snapshotTokens.get(state);if(!token){token={};snapshotTokens.set(state,token);}
  const ownPrevious=recent.get(token);
  // Repository snapshots are structured clones. A different state object may
  // reuse the most recent index only after every eligible position and raw
  // component has been compared; IDs or versions alone are never sufficient.
  const previous=ownPrevious||[...recent.values()].at(-1),rows=[];let changed=!previous||previous.rows.length!==eligible.length,characters=0,retainedCharacters=0;
  for(let i=0;i<eligible.length;i++){
    const {entry,position}=eligible[i],raw=rawComponents(state,entry),old=previous?.rows[i];
    const same=old?.position===position&&raw.every((text,n)=>text===old.raw[n]);
    const row=same?old:compile(position,raw);rows.push(row);changed||=!same;
    const normalizedLength=row.texts.reduce((n,text)=>n+text.length,0);characters+=normalizedLength;
    retainedCharacters+=normalizedLength+raw.reduce((n,text)=>n+String(text??'').length,0);
  }
  const cacheable=retainedCharacters<=KEYWORD_INDEX_LIMITS.characters&&rows.length<=KEYWORD_INDEX_LIMITS.entries;
  let cached;
  if(!changed)cached=previous;
  else{
    const built=cacheable?buildPostings(rows):null;
    cached={rows,byPosition:new Map(rows.map(row=>[row.position,row])),postings:built?.postings||null,count:built?.count||0,characters};
  }
  recent.delete(token);
  // Oversized snapshots are scanned and discarded, never retained in the LRU.
  if(cacheable){recent.set(token,cached);while(recent.size>KEYWORD_INDEX_LIMITS.snapshots)recent.delete(recent.keys().next().value);}
  return {rowAt:position=>cached.byPosition.get(position),candidates:terms=>candidates(cached.postings,terms),
    stats:{mode:cached.postings?'indexed':'scan',cache:!cacheable?'uncached':ownPrevious?(changed?'updated':'reused'):changed?'cold':'reused_snapshot',entries:rows.length,characters,retainedCharacters,grams:cached.postings?.size||0,postings:cached.count}};
}
