import {api,state} from './api.js';

// Only small notification summaries are reused, in memory and per account.
// Menu data and authorization continue to be read from the server.
export function createSummaryResource(path,apply,{now=Date.now,ttl=60000,retry=15000}={}){
  let session=null,value=null,expires=0,retryAt=0,pending=null,generation=0;
  function reset(){generation++;session=null;value=null;expires=0;retryAt=0;pending=null;}
  return {
    reset,
    invalidate(){expires=0;retryAt=0;},
    load({force=false,background=false}={}){
      const current=state.me;
      if(!current)return Promise.resolve(null);
      if(session!==current){reset();session=current;}
      if(!force&&value&&now()<expires)return Promise.resolve(value);
      if(!force&&background&&now()<retryAt)return Promise.resolve(value);
      if(pending)return pending;
      const version=generation;
      const job=api(path,{background}).then(result=>{
        if(version!==generation||session!==current||state.me!==current)return null;
        value=result;expires=now()+ttl;retryAt=0;apply(result);return result;
      }).catch(error=>{
        if(version===generation&&session===current&&state.me===current)retryAt=now()+retry;
        throw error;
      }).finally(()=>{if(pending===job)pending=null;});
      pending=job;return job;
    }
  };
}
