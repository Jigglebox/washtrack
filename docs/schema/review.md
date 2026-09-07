# Review: is everything wired in?

_Generated 2026-09-07 by `scripts/schema-map`. Do not edit by hand; run `npm run schema:map`._

[Back to overview](README.md)

Each finding is a place where a piece of the system does not follow the conventions the rest of the system uses, or is not connected to anything. Findings are not verdicts: many will be deliberate. The point is that each one gets looked at once.

## Conventions this review tests against

- Roles: `employee`, `manager`, `finance`, `admin`, `super_admin` (from `app_role`)
- Shared permission helpers used by existing access rules: `has_role_or_higher()`, `has_role()`, `is_super_admin()`, `get_portal_user_id()`, `portal_has_location()`
- Role assignments live in: `user_roles`
- "Own record" checks (`auth.uid() = some_column`) count as part of the model.

## Fix or confirm (high): 4

### permissions/adhoc-role-check (1)

An access rule that checks roles by reading the role table itself instead of calling the shared helper functions. Two ways of answering "is this person an admin?" will eventually disagree.

| Where | What | Evidence |
| --- | --- | --- |
| audit_log: Managers and admins can view audit logs ([audit_log](tables/audit_log.md)) | This rule checks roles by hand instead of using the shared helpers (has_role_or_higher(), has_role(), is_super_admin()). If the role model changes, this one will be missed. | `EXISTS ( SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role IN ('manager', 'admin', 'super_admin', 'finance…` |

### permissions/unguarded-edge-function (2)

A server-side function that holds the master key and never checks who called it.

| Where | What | Evidence |
| --- | --- | --- |
| create-portal-user | Runs with the service-role key (bypasses every access rule) and never checks who is calling. Anyone with the project URL can call it. | `supabase/functions/create-portal-user/index.ts` |
| update-cutoff-date | Runs with the service-role key (bypasses every access rule) and never checks who is calling. Anyone with the project URL can call it. | `supabase/functions/update-cutoff-date/index.ts` |

### permissions/write-without-rule (1)

A page writes to a table, but no rule on that table allows that kind of write for normal users.

| Where | What | Evidence |
| --- | --- | --- |
| src/lib/cutoff.ts ([system_settings_audit](tables/system_settings_audit.md)) | Code updates into `system_settings_audit` but no access rule on `system_settings_audit` allows UPDATE for app users. Either this write always fails, or it only works through a privileged path. | `src/lib/cutoff.ts → system_settings_audit.update()` |

## Check (medium): 4

### connectedness/unused-table (1)

A table nothing reads or writes.

| Where | What | Evidence |
| --- | --- | --- |
| manager_approval_requests ([manager_approval_requests](tables/manager_approval_requests.md)) | No page, edge function, database function, rule or automatic action reads or writes this table. It may be dead, or something was built but never wired up. |  |

### permissions/edge-function-no-role-check (3)

A server-side function that holds the master key, checks that the caller is logged in, but not what they are allowed to do.

| Where | What | Evidence |
| --- | --- | --- |
| ensure-portal-user | Runs with the service-role key and checks that the caller is logged in, but not what role they have. Fine only if every logged-in user may do this. | `supabase/functions/ensure-portal-user/index.ts` |
| record-portal-login | Runs with the service-role key and checks that the caller is logged in, but not what role they have. Fine only if every logged-in user may do this. | `supabase/functions/record-portal-login/index.ts` |
| submit-portal-onboarding | Runs with the service-role key and checks that the caller is logged in, but not what role they have. Fine only if every logged-in user may do this. | `supabase/functions/submit-portal-onboarding/index.ts` |

## Tidy (low): 23

### connectedness/lookalike-tables (1)

Two tables with almost the same columns, which often means a concept was rebuilt instead of reused.

| Where | What | Evidence |
| --- | --- | --- |
| error_report_replies ~ ticket_replies ([error_report_replies](tables/error_report_replies.md)) | These two tables share 67% of their columns. Check whether one duplicates the other's purpose. | `body, created_at, id, user_id` |

### connectedness/loose-links (11)

Links that exist only by naming convention, with nothing enforcing them.

| Where | What | Evidence |
| --- | --- | --- |
| activity_logs ([activity_logs](tables/activity_logs.md)) | 1 link exist only by column name; the database does not enforce them, so deleting the target leaves dangling references. | `user_id → users` |
| dealership_location_requests ([dealership_location_requests](tables/dealership_location_requests.md)) | 2 links exist only by column name; the database does not enforce them, so deleting the target leaves dangling references. | `requested_by → users; reviewed_by → users` |
| dealership_rates ([dealership_rates](tables/dealership_rates.md)) | 1 link exist only by column name; the database does not enforce them, so deleting the target leaves dangling references. | `created_by → users` |
| dealership_wash_batches ([dealership_wash_batches](tables/dealership_wash_batches.md)) | 1 link exist only by column name; the database does not enforce them, so deleting the target leaves dangling references. | `employee_id → users` |
| employee_comments ([employee_comments](tables/employee_comments.md)) | 2 links exist only by column name; the database does not enforce them, so deleting the target leaves dangling references. | `location_id → locations; employee_id → users` |
| error_report_replies ([error_report_replies](tables/error_report_replies.md)) | 1 link exist only by column name; the database does not enforce them, so deleting the target leaves dangling references. | `user_id → users` |
| payroll_periods ([payroll_periods](tables/payroll_periods.md)) | 1 link exist only by column name; the database does not enforce them, so deleting the target leaves dangling references. | `created_by → users` |
| ticket_replies ([ticket_replies](tables/ticket_replies.md)) | 1 link exist only by column name; the database does not enforce them, so deleting the target leaves dangling references. | `user_id → users` |
| ticket_views ([ticket_views](tables/ticket_views.md)) | 1 link exist only by column name; the database does not enforce them, so deleting the target leaves dangling references. | `user_id → users` |
| tickets ([tickets](tables/tickets.md)) | 2 links exist only by column name; the database does not enforce them, so deleting the target leaves dangling references. | `employee_id → users; submitted_by → users` |
| user_message_views ([user_message_views](tables/user_message_views.md)) | 1 link exist only by column name; the database does not enforce them, so deleting the target leaves dangling references. | `user_id → users` |

### connectedness/uninvoked-edge-function (3)

A server-side function no page calls.

| Where | What | Evidence |
| --- | --- | --- |
| _shared | No page calls this edge function. It may be triggered by a schedule or webhook; if not, it is disconnected. | `supabase/functions/_shared/welcome-email.ts` |
| send-error-report-email | No page calls this edge function. It may be triggered by a schedule or webhook; if not, it is disconnected. | `supabase/functions/send-error-report-email/index.ts` |
| update-cutoff-date | No page calls this edge function. It may be triggered by a schedule or webhook; if not, it is disconnected. | `supabase/functions/update-cutoff-date/index.ts` |

### connectedness/unreferenced-function (6)

A database function nothing calls.

| Where | What | Evidence |
| --- | --- | --- |
| audit_wash_entries | Not called from any page, edge function, rule, trigger or other function. Possibly left over from an earlier version. | `20251031033503_58d57205-49cf-441e-bd45-c1d307483c5d.sql` |
| audit_work_entries | Not called from any page, edge function, rule, trigger or other function. Possibly left over from an earlier version. | `20251220205355_2c0edbc1-49ba-4bfc-863d-6d6f4d45cb7a.sql` |
| get_applicable_rate | Not called from any page, edge function, rule, trigger or other function. Possibly left over from an earlier version. | `20251220205355_2c0edbc1-49ba-4bfc-863d-6d6f4d45cb7a.sql` |
| get_super_admin_id | Not called from any page, edge function, rule, trigger or other function. Possibly left over from an earlier version. |  |
| get_users_for_managers | Not called from any page, edge function, rule, trigger or other function. Possibly left over from an earlier version. |  |
| is_portal_user | Not called from any page, edge function, rule, trigger or other function. Possibly left over from an earlier version. | `20260624221350_0abfecd5-51ce-493c-9711-b5544a85d673.sql` |

### consistency/updated-at-not-maintained (2)

A table with an updated_at column that nothing keeps current, unlike its siblings.

| Where | What | Evidence |
| --- | --- | --- |
| report_templates ([report_templates](tables/report_templates.md)) | Has an updated_at column but no automatic action keeps it current, unlike 12 other tables. |  |
| system_settings ([system_settings](tables/system_settings.md)) | Has an updated_at column but no automatic action keeps it current, unlike 12 other tables. |  |

## For the record (info): 13

### connectedness/unreferenced-function (3)

A database function nothing calls.

| Where | What | Evidence |
| --- | --- | --- |
| disable_inactive_portal_users | Not called from code, rules, triggers or other functions. Looks like a scheduled or maintenance job; confirm something schedules it. | `20260624214004_8a349c83-7751-43a6-8c27-1ece902bed41.sql` |
| get_last_monday | Not called from code, rules, triggers or other functions. Looks like a scheduled or maintenance job; confirm something schedules it. | `20251230164748_968a63f0-76e6-456f-923b-1b5936aa8f10.sql` |
| purge_old_activity_logs | Not called from code, rules, triggers or other functions. Looks like a scheduled or maintenance job; confirm something schedules it. | `20260310213103_7482e75b-65b1-4c70-9359-5a70f21c133f.sql` |

### consistency/drift (4)

Places where the repo and the database disagree about what exists.

| Where | What | Evidence |
| --- | --- | --- |
| repo vs database | View `users_safe_view` is in types.ts but no migration defines it (defined via the dashboard). |  |
| repo vs database | FK `employee_comments_location_id_fkey` (employee_comments.location_id -> locations) is in migrations but not in types.ts. It may have been dropped, or types.ts is stale. |  |
| repo vs database | Function `get_super_admin_id` is exposed in types.ts but no migration defines it (created via the dashboard). |  |
| repo vs database | Function `get_users_for_managers` is exposed in types.ts but no migration defines it (created via the dashboard). |  |

### permissions/open-policy (6)

A rule that allows an action unconditionally. Not a problem by itself; listed so each one is a conscious decision.

| Where | What | Evidence |
| --- | --- | --- |
| audit_log: System can insert audit logs ([audit_log](tables/audit_log.md)) | Unconditional INSERT access for authenticated. Fine if intended; listed so it is a decision, not an accident. |  |
| dealership_rates: Authenticated can view dealership rates ([dealership_rates](tables/dealership_rates.md)) | Unconditional SELECT access for authenticated. Fine if intended; listed so it is a decision, not an accident. |  |
| system_settings_audit: All authenticated users can read audit trail ([system_settings_audit](tables/system_settings_audit.md)) | Unconditional SELECT access for public. Fine if intended; listed so it is a decision, not an accident. |  |
| system_settings_audit: System can insert audit records ([system_settings_audit](tables/system_settings_audit.md)) | Unconditional INSERT access for public. Fine if intended; listed so it is a decision, not an accident. |  |
| system_settings: All authenticated users can read system settings ([system_settings](tables/system_settings.md)) | Unconditional SELECT access for public. Fine if intended; listed so it is a decision, not an accident. |  |
| work_types: Everyone can read work_types ([work_types](tables/work_types.md)) | Unconditional SELECT access for public. Fine if intended; listed so it is a decision, not an accident. |  |
