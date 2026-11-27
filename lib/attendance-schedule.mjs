import {all,one} from './db.mjs';

export function scheduleTablesReady(db) {
 if (typeof db.query === 'function') {
  return Boolean(one(db, "SELECT to_regclass('portal.attendance_schedule_units') IS NOT NULL AS ready")?.ready);
 }
 return Boolean(one(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='attendance_schedule_units'"));
}

export const shiftFields = `s.code, s.name,
  substr(CAST(s.start_time AS TEXT),1,5) AS start_time,
  substr(CAST(s.end_time AS TEXT),1,5) AS end_time,
  substr(CAST(s.late_time AS TEXT),1,5) AS late_time, s.end_day_offset`;

// Acuan berdasarkan fungsi posisi. Jam dan batas terlambat dibaca dari master yang sama dengan jadwal tetap.
const positionShiftGroups = [
 // Sekretariat: acuan ini khusus Staf Pelayanan Internal. Kepala Urusan dan Koordinator memakai jadwal tetap.
 {positions:['BPB_S_P056'], shifts:['50001','50002']},
 // Operasional: tiket, administrasi kunjungan, dan keluhan berada di Urusan Pengelolaan Kunjungan.
 {positions:['BPB_OP_P044','BPB_OP_P069'], shifts:['20001','20002','20003','20004']},
 {positions:['BPB_OP_P045','BPB_OP_P070'], shifts:['21001','21002','21003']},
 {positions:['BPB_OP_P041','BPB_OP_P042','BPB_OP_P043','BPB_OP_P066','BPB_OP_P067','BPB_OP_P068'],
  shifts:['22001','22002','22003','22004']},
 // Keamanan wilayah melihat dua belas acuan. Pembagian per wilayah dan hari mengikuti penugasan.
 {positions:['BPB_PLK_P048','BPB_PLK_P049','BPB_PLK_P074','BPB_PLK_P075','BPB_PLK_P076','BPB_PLK_P077'],
  shifts:['30001','30002','30003','70000','70001','70002','70003','71000','71002','71003','72001','73000']},
 {positions:['BPB_PLK_P051','BPB_PLK_P079'], shifts:['40001','40002']},
 {positions:['BPB_PLK_P052','BPB_PLK_P080_STAF','BPB_PLK_P080_THL'], shifts:['60001','60002']},
 {positions:['BPB_PLK_PAR_KOORD'], shifts:['61001','61002']},
 {positions:['BPB_PLK_P054','BPB_PLK_P082_STAF','BPB_PLK_P082_THL'], shifts:['62001','62002']},
 {positions:['BPB_PLK_P053','BPB_PLK_P081_STAF','BPB_PLK_P081_THL'], shifts:['63001','63002','63003','63004','63005','63006']},
];
export const positionShiftPairs = positionShiftGroups.flatMap(({positions,shifts}) =>
 positions.flatMap(position => shifts.map(shift => [position,shift])));
const rotatingPositions = new Set(positionShiftPairs.map(([code]) => code));

export function loadFixedSchedules(db, from, to, employeeId=null) {
 if (!scheduleTablesReady(db)) return null;
 const placements = all(db, `SELECT ep.employee_id, CAST(ep.valid_from AS TEXT) AS valid_from,
  CAST(ep.valid_to AS TEXT) AS valid_to, p.code, CAST(u.starts_on AS TEXT) AS starts_on, u.org_unit_id
  FROM employee_placements ep JOIN positions p ON p.id=ep.position_id
  LEFT JOIN (SELECT s.org_unit_id, s.starts_on FROM attendance_schedule_units s
   JOIN org_units o ON o.id=s.org_unit_id WHERE o.is_active=1) u ON u.org_unit_id=p.org_unit_id
  WHERE ep.is_primary=1 AND ep.valid_from<=? AND (ep.valid_to IS NULL OR ep.valid_to>=?)
  ${employeeId?'AND ep.employee_id=?':''}`, to, from, ...(employeeId?[employeeId]:[]));
 const byEmployee = new Map();
 for (const row of placements) {
  if (!byEmployee.has(row.employee_id)) byEmployee.set(row.employee_id, []);
  byEmployee.get(row.employee_id).push(row);
 }
 const weekdays = new Map();
 for (const {org_unit_id,weekday_no,...shift} of all(db, `SELECT w.org_unit_id,w.weekday_no,${shiftFields}
  FROM attendance_schedule_weekdays w JOIN attendance_schedule_shifts s ON s.code=w.shift_code`)) {
  weekdays.set(`${org_unit_id}/${weekday_no}`, shift);
 }
 const holidays = new Map(), years = new Set();
 for (const row of all(db, 'SELECT CAST(work_date AS TEXT) AS day,name FROM attendance_schedule_holidays WHERE work_date>=? AND work_date<=?',
  from.slice(0,4)+'-01-01',to.slice(0,4)+'-12-31')) {
  holidays.set(row.day,row.name);
  years.add(row.day.slice(0,4));
 }
 return {byEmployee,weekdays,holidays,years};
}

export function fixedScheduleOn(calendar,employeeId,day) {
 const matches = calendar?.byEmployee.get(employeeId)?.filter(p=>p.valid_from<=day && (!p.valid_to || p.valid_to>=day));
 if (matches?.length!==1) return null;
 const placement=matches[0];
 if (!placement.org_unit_id || placement.starts_on>day || rotatingPositions.has(placement.code)) return null;
 const weekday = new Date(day+'T00:00:00Z').getUTCDay() || 7;
 const shift = calendar.weekdays.get(`${placement.org_unit_id}/${weekday}`);
 const holiday = calendar.holidays.get(day);
 const day_type = holiday?'HOLIDAY':!shift?'WEEKLY_OFF':calendar.years.has(day.slice(0,4))?'WORK':'CALENDAR_PENDING';
 return {day_type,holiday_name:holiday||null,shift:day_type==='WORK'?shift:null};
}

export function arrivalTiming(calendar, employeeId, day, inAt) {
 if (!inAt) return null;
 const shift=fixedScheduleOn(calendar,employeeId,day)?.shift;
 if (!shift) return null;
 const arrival=Math.floor(Date.parse(inAt)/60000);
 const atMinute=time=>Date.parse(`${day}T${time}:00+08:00`)/60000;
 const late=arrival>=atMinute(shift.late_time);
 return {late,minutes:late?Math.max(0,arrival-atMinute(shift.start_time)):0,start_time:shift.start_time,late_time:shift.late_time};
}
