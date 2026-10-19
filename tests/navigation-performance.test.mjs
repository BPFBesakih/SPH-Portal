import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestQueue} from '../public/request-queue.js';
import {createNavigationQueue} from '../public/navigation-queue.js';
import {createSummaryResource} from '../public/summary-resource.js';
import {api,state} from '../public/api.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('menu requests pass queued notifications while preserving a single active lease',async()=>{
  const enqueue=createRequestQueue(),gate=deferred(),order=[];let active=0,maximum=0;
  const work=(name,wait)=>async()=>{active++;maximum=Math.max(maximum,active);order.push(name);if(wait)await wait;active--;return name;};
  const first=enqueue(work('active',gate.promise));await tick();
  const background=enqueue(work('notifications'),{background:true});
  const foreground=enqueue(work('menu')).then(()=>enqueue(work('menu-lookups')));
  gate.resolve();await Promise.all([first,foreground,background]);
  assert.deepEqual(order,['active','menu','menu-lookups','notifications']);assert.equal(maximum,1);
});

test('a failed API request does not stop later menu requests',async()=>{
  const enqueue=createRequestQueue();
  const failed=enqueue(()=>{throw new Error('offline');});
  const next=enqueue(()=>42);
  await assert.rejects(failed,/offline/);assert.equal(await next,42);
});

test('rapid navigation skips intermediate menus and prevents obsolete renders',async()=>{
  const navigation=createNavigationQueue(),gate=deferred(),started=[],rendered=[];
  const first=navigation.run(async current=>{started.push('first');await gate.promise;if(current())rendered.push('first');});await tick();
  const second=navigation.run(()=>{started.push('second');rendered.push('second');});
  const third=navigation.run(()=>{started.push('third');rendered.push('third');});
  gate.resolve();await Promise.all([first,second,third]);
  assert.deepEqual(started,['first','third']);assert.deepEqual(rendered,['third']);
  const last=deferred();const pending=navigation.run(async current=>{await last.promise;assert.equal(current(),false);});await tick();
  navigation.invalidate();last.resolve();await pending;
});

test('notification summaries deduplicate, expire, invalidate and isolate account changes',async t=>{
  let clock=1000,calls=0;const applied=[];
  t.mock.method(globalThis,'fetch',async()=>Response.json({revision:++calls}));
  state.me={user:{id:'first'}};
  const summary=createSummaryResource('announcements',data=>applied.push(data.revision),{now:()=>clock});
  const first=summary.load(),duplicate=summary.load();assert.equal(first,duplicate);
  await first;await summary.load({background:true});assert.equal(calls,1);
  clock+=60000;await summary.load({background:true});assert.equal(calls,2);
  summary.invalidate();await summary.load();assert.equal(calls,3);
  await summary.load({force:true});assert.equal(calls,4);
  state.me={user:{id:'second'}};await summary.load();assert.equal(calls,5);
  assert.deepEqual(applied,[1,2,3,4,5]);summary.reset();state.me=null;
});

test('an old in-flight summary cannot repopulate data after logout or reset',async t=>{
  const gate=deferred(),applied=[];
  t.mock.method(globalThis,'fetch',async()=>{await gate.promise;return Response.json({items:['old-account']});});
  state.me={user:{id:'old'}};
  const summary=createSummaryResource('announcements',data=>applied.push(data));
  const pending=summary.load();await tick();summary.reset();state.me=null;gate.resolve();
  assert.equal(await pending,null);assert.deepEqual(applied,[]);
});

test('failed background summaries back off while an explicit retry remains available',async t=>{
  let calls=0,clock=1000;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:'unavailable'},{status:503});});
  state.me={user:{id:'fixture'}};
  const summary=createSummaryResource('announcements',()=>{}, {now:()=>clock});
  await assert.rejects(summary.load({background:true}),/unavailable/);
  assert.equal(await summary.load({background:true}),null);assert.equal(calls,1);
  await assert.rejects(summary.load({force:true}),/unavailable/);assert.equal(calls,2);
  clock+=15000;await assert.rejects(summary.load({background:true}),/unavailable/);assert.equal(calls,3);
  summary.reset();state.me=null;
});

test('queued requests from a replaced account are discarded before reaching the server',async t=>{
  const gate=deferred(),calls=[];
  t.mock.method(globalThis,'fetch',async path=>{calls.push(path);await gate.promise;return Response.json({ok:true});});
  state.me={user:{id:'old'}};const first=api('users');await tick();
  const queued=api('announcements',{background:true});
  const rejection=assert.rejects(queued,{name:'AbortError'});
  state.me={user:{id:'new'}};gate.resolve();await first;await rejection;
  assert.deepEqual(calls,['/api/users']);state.me=null;
});
