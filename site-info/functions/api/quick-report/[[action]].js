import {handleQuickReport} from '../../../lib/quick-report.mjs';
export const onRequest=({request,env})=>handleQuickReport(request,env);
