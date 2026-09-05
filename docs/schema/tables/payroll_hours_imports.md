# Table: payroll_hours_imports

_Generated 2026-09-05 by `scripts/schema-map`. Do not edit by hand; run `npm run schema:map`._

[Back to overview](../README.md) · Domain: [payroll_employee_lines](../clusters/payroll_employee_lines.md)

- Primary key: `id`
- RLS: enabled
- Defined in: `types.ts`, `20260901005118_4edf45d4-24b6-4f0b-8030-9002673617da.sql`

## Columns

| Column | Type | Null | Keys | References |
| --- | --- | --- | --- | --- |
| `created_at` | string |  |  |  |
| `department` | string | yes |  |  |
| `employee_id` | string | yes | FK | [users](../tables/users.md).id |
| `employee_line_id` | string | yes | FK | [payroll_employee_lines](../tables/payroll_employee_lines.md).id |
| `hours` | number |  |  |  |
| `id` | string |  | PK |  |
| `imported_by` | string | yes |  |  |
| `ot_hours` | number |  |  |  |
| `period_id` | string |  | FK | [payroll_periods](../tables/payroll_periods.md).id |
| `provider_employee_number` | string | yes |  |  |
| `raw_name` | string |  |  |  |
| `source_filename` | string | yes |  |  |
| `task_label` | string | yes |  |  |
| `updated_at` | string |  |  |  |

## Relationships

**References**

- [payroll_employee_lines](../tables/payroll_employee_lines.md) via `employee_line_id` (many-to-one, optional)
- [payroll_periods](../tables/payroll_periods.md) via `period_id` (many-to-one)
- [users](../tables/users.md) via `employee_id` (many-to-one, optional)

## Neighbourhood

```mermaid
erDiagram
  payroll_hours_imports {
    string created_at
    string department "null"
    string employee_id FK "-> users, null"
    string employee_line_id FK "-> payroll_employee_lines, null"
    number hours
    string id PK
    string imported_by "null"
    number ot_hours
    string period_id FK "-> payroll_periods"
    string provider_employee_number "null"
    string raw_name
    string source_filename "null"
    string task_label "null"
    string updated_at
  }
  payroll_employee_lines |o--o{ payroll_hours_imports : "employee_line_id"
  payroll_periods ||--o{ payroll_hours_imports : "period_id"
  users |o--o{ payroll_hours_imports : "employee_id"
```

## RLS policies

| Policy | Command | Roles | Using | With check | Calls | Source |
| --- | --- | --- | --- | --- | --- | --- |
| Finance+ manage hours imports | ALL | authenticated | `public.has_role_or_higher(auth.uid(), 'finance'::app_role)` | `public.has_role_or_higher(auth.uid(), 'finance'::app_role)` | `has_role_or_higher` | `20260901005118_4edf45d4-24b6-4f0b-8030-9002673617da.sql` |

## Triggers

| Trigger | When | Function | Function touches |
| --- | --- | --- | --- |
| `trg_payroll_hours_updated` | BEFORE UPDATE FOR EACH ROW | `set_updated_at()` |  |

## Used by code

**Frontend**

- `src/pages/payroll/PayrollDashboard.tsx`
