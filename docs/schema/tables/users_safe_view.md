# View: users_safe_view

_Generated 2026-09-07 by `scripts/schema-map`. Do not edit by hand; run `npm run schema:map`._

[Back to overview](../README.md)

- Primary key: `id`
- Defined in: `types.ts`

## Columns

| Column | Type | Null | Keys | References |
| --- | --- | --- | --- | --- |
| `assigned_clients` | string_array | yes |  |  |
| `available_days` | string_array | yes |  |  |
| `average_wash_time_minutes` | number | yes |  |  |
| `certifications` | string_array | yes |  |  |
| `client_access_level` | string | yes |  |  |
| `created_at` | string | yes |  |  |
| `default_shift` | string | yes |  |  |
| `email` | string | yes |  |  |
| `employee_id` | string | yes |  |  |
| `hire_date` | string | yes |  |  |
| `id` | string | yes | PK |  |
| `is_active` | boolean | yes |  |  |
| `last_training_date` | string | yes |  |  |
| `location_id` | string | yes |  |  |
| `manager_id` | string | yes |  |  |
| `max_daily_washes` | number | yes |  |  |
| `name` | string | yes |  |  |
| `notes` | string | yes |  |  |
| `on_vacation` | boolean | yes |  |  |
| `performance_rating` | number | yes |  |  |
| `preferred_language` | string | yes |  |  |
| `profile_photo_url` | string | yes |  |  |
| `quality_score_average` | number | yes |  |  |
| `role` | string | yes |  |  |
| `tags` | string_array | yes |  |  |
| `termination_date` | string | yes |  |  |
| `total_washes_completed` | number | yes |  |  |
| `training_completed` | string_array | yes |  |  |
| `vacation_until` | string | yes |  |  |

## Relationships

_No relationships found._

## RLS policies

_None. Row level security is not enabled._

## Used by code

**Frontend**

- `src/components/UserSearchInput.tsx`
- `src/pages/CreateUser.tsx`
- `src/pages/payroll/PayrollDashboard.tsx`
