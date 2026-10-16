import {handlePortal} from '../../lib/portal-auth.mjs';
export function onRequest({request,env}){return handlePortal(request,env);}
