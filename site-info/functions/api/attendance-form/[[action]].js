import {handleAttendanceForm} from '../../../lib/attendance-form.mjs';
export const onRequest=({request,env})=>handleAttendanceForm(request,env);
