# Table: payroll_run_lines

_Generated 2026-09-05 by `scripts/schema-map`. Do not edit by hand; run `npm run schema:map`._

[Back to overview](../README.md) · Domain: [payroll_employee_lines](../clusters/payroll_employee_lines.md)

- Primary key: `id`
- RLS: enabled
- Defined in: `types.ts`, `20260901005118_4edf45d4-24b6-4f0b-8030-9002673617da.sql`

## Columns

| Column | Type | Null | Keys | References |
| --- | --- | --- | --- | --- |
| `code` | string |  |  |  |
| `created_at` | string |  |  |  |
| `department` | string |  |  |  |
| `display_name` | string |  |  |  |
| `employee_id` | string | yes | FK | [users](../tables/users.md).id |
| `employee_line_id` | string | yes | FK | [payroll_employee_lines](../tables/payroll_employee_lines.md).id |
| `id` | string |  | PK |  |
| `notes` | string | yes |  |  |
| `ot_hours` | number |  |  |  |
| `pay_type` | string |  |  |  |
| `period_id` | string |  | FK | [payroll_periods](../tables/payroll_periods.md).id |
| `provider_employee_number` | string | yes |  |  |
| `quantity` | number |  |  |  |
| `rate` | number |  |  |  |
| `sort_order` | number |  |  |  |
| `task_label` | string |  |  |  |
| `updated_at` | string |  |  |  |

## Relationships

**References**

- [payroll_employee_lines](../tables/payroll_employee_lines.md) via `employee_line_id` (many-to-one, optional)
- [payroll_periods](../tables/payroll_periods.md) via `period_id` (many-to-one)
- [users](../tables/users.md) via `employee_id` (many-to-one, optional)

## Neighbourhood

```mermaid
erDiagram
  payroll_run_lines {
    string code
    string created_at
    string department
    string display_name
    string employee_id FK "-> users, null"
    string employee_line_id FK "-> payroll_employee_lines, null"
    string id PK
    string notes "null"
    number ot_hours
    string pay_type
    string period_id FK "-> payroll_periods"
    string provider_employee_number "null"
    number quantity
    number rate
    number sort_order
    string task_label
    string updated_at
  }
  payroll_employee_lines |o--o{ payroll_run_lines : "employee_line_id"
  payroll_periods ||--o{ payroll_run_lines : "period_id"
  users |o--o{ payroll_run_lines : "employee_id"
```

## RLS policies

| Policy | Command | Roles | Using | With check | Calls | Source |
| --- | --- | --- | --- | --- | --- | --- |
| Finance+ manage run lines | ALL | authenticated | `public.has_role_or_higher(auth.uid(), 'finance'::app_role)` | `public.has_role_or_higher(auth.uid(), 'finance'::app_role)` | `has_role_or_higher` | `20260901005118_4edf45d4-24b6-4f0b-8030-9002673617da.sql` |

## Triggers

| Trigger | When | Function | Function touches |
| --- | --- | --- | --- |
| `trg_payroll_run_lines_updated` | BEFORE UPDATE FOR EACH ROW | `set_updated_at()` |  |

## Used by code

**Frontend**

- `src/pages/payroll/PayrollDashboard.tsx`
