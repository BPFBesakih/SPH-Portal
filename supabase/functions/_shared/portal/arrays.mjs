// Sequential execution preserves mutation order and short-circuit checks on a
// single PostgreSQL transaction connection.
export async function asyncMap(items,fn){const out=[];for(let i=0;i<items.length;i++)out.push(await fn(items[i],i,items));return out;}
export async function asyncFilter(items,fn){const out=[];for(let i=0;i<items.length;i++)if(await fn(items[i],i,items))out.push(items[i]);return out;}
export async function asyncSome(items,fn){for(let i=0;i<items.length;i++)if(await fn(items[i],i,items))return true;return false;}
export async function asyncEvery(items,fn){for(let i=0;i<items.length;i++)if(!await fn(items[i],i,items))return false;return true;}
export async function asyncFind(items,fn){for(let i=0;i<items.length;i++)if(await fn(items[i],i,items))return items[i];}
export async function asyncForEach(items,fn){for(let i=0;i<items.length;i++)await fn(items[i],i,items);}
export async function asyncReduce(items,fn,initial){let i=0,value=initial;if(arguments.length<3){if(!items.length)throw new TypeError('Empty reduce');value=items[i++];}for(;i<items.length;i++)value=await fn(value,items[i],i,items);return value;}
