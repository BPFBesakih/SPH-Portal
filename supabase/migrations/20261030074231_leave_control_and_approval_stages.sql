BEGIN;
CREATE TABLE portal.leave_controller_accounts (
 user_id uuid PRIMARY KEY REFERENCES public.app_users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE portal.leave_controller_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.leave_controller_accounts FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public.app_roles(code,name,description,is_system) VALUES
 ('LEAVE_CONTROLLER','Kontrol Cuti','Pengelolaan cuti untuk akun yang ditetapkan.',true)
 ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name;
INSERT INTO public.app_permissions(code,module_code,resource,action,description)
 VALUES('hr.leaves.manage','hr','hr.leaves','manage','Mengelola formulir dan kontrol cuti.') ON CONFLICT(code) DO NOTHING;
DELETE FROM public.app_role_permissions rp USING public.app_permissions p,public.app_roles r
 WHERE rp.permission_id=p.id AND rp.role_id=r.id AND p.resource='hr.leaves' AND r.code NOT IN ('SUPER_ADMIN','LEAVE_CONTROLLER');
INSERT INTO public.app_role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM public.app_roles r CROSS JOIN public.app_permissions p
 WHERE r.code IN ('SUPER_ADMIN','LEAVE_CONTROLLER') AND p.resource='hr.leaves' ON CONFLICT DO NOTHING;
ALTER TABLE portal.leave_requests ADD COLUMN approval_cycle integer NOT NULL DEFAULT 1 CHECK(approval_cycle>0);
CREATE TABLE portal.leave_approval_steps (
 request_id text NOT NULL REFERENCES portal.leave_requests(id), cycle_no integer NOT NULL CHECK(cycle_no>0),
 step_no integer NOT NULL CHECK(step_no BETWEEN 1 AND 2), purpose text NOT NULL CHECK(purpose IN ('APPROVAL','CANCELLATION')),
 approver_employee_id text NOT NULL REFERENCES portal.employees(id),
 state text NOT NULL CHECK(state IN ('WAITING','PENDING','APPROVED','REJECTED','CANCELLED')),
 decided_by uuid REFERENCES public.app_users(id), decided_at timestamptz, note text,
 verified_work_dates boolean NOT NULL DEFAULT false, verified_identity boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(request_id,cycle_no,step_no),
 UNIQUE(request_id,cycle_no,approver_employee_id)
);
CREATE INDEX leave_approval_steps_approver ON portal.leave_approval_steps(approver_employee_id,state);
CREATE INDEX leave_approval_steps_decider ON portal.leave_approval_steps(decided_by);
ALTER TABLE portal.leave_approval_steps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal.leave_approval_steps FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
