import {state} from './api.js';
import {createSummaryResource} from './summary-resource.js';
const summary=createSummaryResource('leaves/notifications',value=>{state.leaveNotifications=value;document.dispatchEvent(new Event('leave-notices-changed'));},{ttl:20000});
export const loadLeaveNotifications=options=>summary.load(options);
export const invalidateLeaveNotifications=()=>summary.invalidate();
export function resetLeaveNotifications(){summary.reset();state.leaveNotifications=null;}
export const leaveNoticeCount=()=>state.leaveNotifications?.total||0;
export const leaveNoticeKeys=()=>state.leaveNotifications?.keys||[];
export function leaveNotices(){return leaveNoticeCount()?[{route:'leaves?tab=approvals',count:leaveNoticeCount(),title:'Cuti menunggu persetujuan Anda',note:'Pengajuan dan pembatalan pada tahap persetujuan Anda',ico:'calendar'}]:[];}
