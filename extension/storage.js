import {TABLES,stable,clone,requireThat} from './core/base.js';

const keyFor=(table,row)=>table==='templates'?`${row.id}@${row.version}`:row.id;
export class Repository {
  constructor(name='text-memory-extension-v2'){this.name=name;this.database=null;this.opening=null;this.openGeneration=0;}
  async open(){
    if(this.database)return this.database;
    if(this.opening)return this.opening;
    const generation=this.openGeneration;
    let abandoned=false;
    const opening=new Promise((resolve,reject)=>{
      const request=indexedDB.open(this.name,4);
      request.onupgradeneeded=()=>{for(const name of TABLES)if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name);};
      request.onerror=()=>{abandoned=true;reject(request.error);};
      request.onblocked=()=>{abandoned=true;reject(new Error('数据库升级被另一个旧面板阻塞，请关闭旧面板后重开'));};
      request.onsuccess=()=>{
        const db=request.result;
        if(abandoned||generation!==this.openGeneration){db.close();reject(new Error('数据库打开期间连接已关闭，请重试'));return;}
        const release=()=>{if(this.database===db)this.database=null;};
        db.onversionchange=()=>{db.close();release();};db.onclose=release;
        this.database=db;resolve(db);
      };
    });
    this.opening=opening;
    try{return await opening;}finally{if(this.opening===opening)this.opening=null;}
  }
  async snapshot(){const db=await this.open();return new Promise((resolve,reject)=>{
    const tx=db.transaction(TABLES,'readonly'),state={};
    for(const name of TABLES){const request=tx.objectStore(name).getAll();request.onsuccess=()=>{state[name]=request.result;};}
    tx.oncomplete=()=>resolve(state);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('读取中断'));
  });}
  async mutate(action){
    const db=await this.open();return new Promise((resolve,reject)=>{
      const tx=db.transaction(TABLES,'readwrite'),state={};let loaded=0,result,originalError;
      for(const name of TABLES){const request=tx.objectStore(name).getAll();request.onsuccess=()=>{
        state[name]=request.result;if(++loaded!==TABLES.length)return;
        const before=clone(state);
        try{
          result=action(state);requireThat(!result?.then,'事务内只允许同步业务操作');
          for(const table of TABLES){
            const store=tx.objectStore(table),old=new Map(before[table].map(row=>[keyFor(table,row),row]));
            const next=new Map(state[table].map(row=>[keyFor(table,row),row]));
            requireThat(next.size===state[table].length,'数据键重复');
            for(const [key,row]of next)if(!old.has(key)||stable(old.get(key))!==stable(row))store.put(row,key);
            for(const key of old.keys())if(!next.has(key))store.delete(key);
          }
        }catch(error){originalError=error;tx.abort();}
      };}
      tx.oncomplete=()=>{this.notify();resolve(result);};
      tx.onabort=()=>reject(originalError||tx.error||new Error('写入中断，已回滚'));
      tx.onerror=()=>{};
    });
  }
  notify(){try{const c=new BroadcastChannel('text-memory-changed');c.postMessage({changed:true});c.close();}catch{}}
  close(){this.openGeneration++;this.opening=null;this.database?.close();this.database=null;}
}
