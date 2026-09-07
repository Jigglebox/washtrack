# RLS policy matrix

_Generated 2026-09-07 by `scripts/schema-map`. Do not edit by hand; run `npm run schema:map`._

[Back to overview](README.md)

Number of policies per command on each table, and the helper functions those policies call. Details are on each table page.

| Table | RLS | ALL | SELECT | INSERT | UPDATE | DELETE | Helpers |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [activity_logs](tables/activity_logs.md) | on | 0 | 1 | 1 | 0 | 0 | `is_super_admin` |
| [audit_log](tables/audit_log.md) | on | 0 | 1 | 1 | 0 | 0 |  |
| [client_portal_access_requests](tables/client_portal_access_requests.md) | on | 0 | 2 | 1 | 1 | 0 | `has_role_or_higher`, `get_portal_user_id`, `is_portal_approved` |
| [client_portal_location_access](tables/client_portal_location_access.md) | on | 1 | 2 | 0 | 0 | 0 | `has_role_or_higher`, `get_portal_user_id` |
| [client_portal_users](tables/client_portal_users.md) | on | 0 | 2 | 1 | 1 | 1 | `has_role_or_higher` |
| [clients](tables/clients.md) | on | 1 | 2 | 0 | 0 | 0 | `has_role_or_higher` |
| [dealership_location_requests](tables/dealership_location_requests.md) | on | 0 | 1 | 1 | 1 | 1 | `has_role_or_higher` |
| [dealership_rates](tables/dealership_rates.md) | on | 0 | 1 | 1 | 1 | 1 | `has_role_or_higher` |
| [dealership_wash_batches](tables/dealership_wash_batches.md) | on | 0 | 1 | 1 | 1 | 1 | `has_role_or_higher` |
| [employee_comments](tables/employee_comments.md) | on | 0 | 3 | 1 | 0 | 0 | `has_role_or_higher` |
| [error_report_replies](tables/error_report_replies.md) | on | 0 | 1 | 1 | 0 | 0 | `is_super_admin` |
| [error_reports](tables/error_reports.md) | on | 0 | 2 | 1 | 1 | 0 | `is_super_admin` |
| [locations](tables/locations.md) | on | 1 | 3 | 0 | 0 | 0 | `has_role_or_higher`, `portal_has_location` |
| [manager_approval_requests](tables/manager_approval_requests.md) | on | 0 | 3 | 1 | 1 | 0 | `has_role` |
| [message_reads](tables/message_reads.md) | on | 0 | 1 | 1 | 0 | 0 | `has_role_or_higher` |
| [message_replies](tables/message_replies.md) | on | 0 | 2 | 2 | 0 | 0 | `has_role_or_higher` |
| [payroll_employee_lines](tables/payroll_employee_lines.md) | on | 1 | 0 | 0 | 0 | 0 | `has_role_or_higher` |
| [payroll_hours_imports](tables/payroll_hours_imports.md) | on | 1 | 0 | 0 | 0 | 0 | `has_role_or_higher` |
| [payroll_pay_codes](tables/payroll_pay_codes.md) | on | 1 | 0 | 0 | 0 | 0 | `has_role_or_higher` |
| [payroll_periods](tables/payroll_periods.md) | on | 1 | 0 | 0 | 0 | 0 | `has_role_or_higher` |
| [payroll_run_lines](tables/payroll_run_lines.md) | on | 1 | 0 | 0 | 0 | 0 | `has_role_or_higher` |
| [payroll_work_type_map](tables/payroll_work_type_map.md) | on | 1 | 0 | 0 | 0 | 0 | `has_role_or_higher` |
| [rate_configs](tables/rate_configs.md) | on | 1 | 2 | 0 | 1 | 0 | `has_role_or_higher` |
| [report_templates](tables/report_templates.md) | on | 0 | 1 | 1 | 1 | 1 | `has_role`, `has_role_or_higher`, `can_delete_report_template` |
| [system_settings](tables/system_settings.md) | on | 0 | 1 | 1 | 1 | 0 | `has_role` |
| [system_settings_audit](tables/system_settings_audit.md) | on | 0 | 1 | 1 | 0 | 0 |  |
| [ticket_line_items](tables/ticket_line_items.md) | on | 0 | 1 | 1 | 0 | 0 | `has_role_or_higher` |
| [ticket_replies](tables/ticket_replies.md) | on | 0 | 1 | 1 | 0 | 0 | `has_role_or_higher` |
| [ticket_views](tables/ticket_views.md) | on | 0 | 1 | 1 | 1 | 0 |  |
| [tickets](tables/tickets.md) | on | 0 | 1 | 1 | 1 | 1 | `has_role_or_higher` |
| [user_locations](tables/user_locations.md) | on | 1 | 2 | 0 | 0 | 0 | `has_role_or_higher` |
| [user_message_views](tables/user_message_views.md) | on | 0 | 1 | 1 | 1 | 0 |  |
| [user_roles](tables/user_roles.md) | on | 0 | 2 | 2 | 3 | 3 | `has_role`, `has_role_or_higher` |
| [users](tables/users.md) | on | 0 | 3 | 2 | 3 | 0 | `has_role`, `has_role_or_higher`, `is_super_admin` |
| [wash_requests](tables/wash_requests.md) | on | 1 | 3 | 1 | 0 | 1 | `has_role_or_higher`, `get_portal_user_id`, `portal_has_location` |
| [work_items](tables/work_items.md) | on | 1 | 2 | 1 | 0 | 0 | `has_role_or_higher` |
| [work_logs](tables/work_logs.md) | on | 1 | 2 | 1 | 0 | 0 | `has_role`, `has_role_or_higher` |
| [work_types](tables/work_types.md) | on | 1 | 1 | 0 | 0 | 0 | `has_role_or_higher` |

## Storage policies

| Policy | On | Command | Using | With check |
| --- | --- | --- | --- | --- |
| Authenticated users can upload error reports | `storage.objects` | INSERT | `` | `bucket_id = 'error-reports'` |
| Managers can upload ticket photos | `storage.objects` | INSERT | `` | `bucket_id = 'ticket-photos' AND public.has_role_or_higher(auth.uid(), 'manager'::app_role) AND (storage.foldername(name…` |
| Super admins can view error reports | `storage.objects` | SELECT | `bucket_id = 'error-reports' AND public.is_super_admin(auth.uid())` |  |
| Users can view their own error report screenshots | `storage.objects` | SELECT | `bucket_id = 'error-reports' AND (storage.foldername(name))[1] = auth.uid()::text` |  |
| View own or all ticket photos for finance and above | `storage.objects` | SELECT | `bucket_id = 'ticket-photos' AND ( (storage.foldername(name))[1] = auth.uid()::text OR public.has_role_or_higher(auth.ui…` |  |
