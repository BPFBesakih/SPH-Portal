// Page loaders share state. Finish the active loader, skip obsolete clicks,
// and render only the last requested menu.
export function createNavigationQueue(){
  let latest=0,tail=Promise.resolve();
  return {
    run(load){
      const version=++latest,isCurrent=()=>version===latest;
      const job=tail.then(()=>isCurrent()?load(isCurrent):undefined);
      tail=job.catch(()=>{});return job;
    },
    invalidate(){latest++;}
  };
}
