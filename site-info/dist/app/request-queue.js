// A portal session has one lease. Keep requests serial, but let menu data go
// before notification refreshes that have not started yet.
export function createRequestQueue(){
  const foreground=[],background=[];let running=false;
  async function drain(){
    if(running)return;running=true;
    try{
      while(foreground.length||background.length){
        const job=(foreground.length?foreground:background).shift();
        try{job.resolve(await job.send());}catch(error){job.reject(error);}
        // A page may enqueue its next dependent request after this one resolves.
        await Promise.resolve();
      }
    }finally{running=false;}
  }
  return (send,{background:lowPriority=false}={})=>new Promise((resolve,reject)=>{
    (lowPriority?background:foreground).push({send,resolve,reject});
    queueMicrotask(drain);
  });
}
