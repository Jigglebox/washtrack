# Table: payroll_pay_codes

_Generated 2026-09-05 by `scripts/schema-map`. Do not edit by hand; run `npm run schema:map`._

[Back to overview](../README.md) · Domain: [client_portal_users](../clusters/client_portal_users.md)

- Primary key: `id`
- Unique: `code`, `department`
- RLS: enabled
- Defined in: `types.ts`, `20260901005118_4edf45d4-24b6-4f0b-8030-9002673617da.sql`

## Columns

| Column | Type | Null | Keys | References |
| --- | --- | --- | --- | --- |
| `code` | string |  |  |  |
| `created_at` | string |  |  |  |
| `default_pay_type` | string |  |  |  |
| `department` | string |  |  |  |
| `description` | string | yes |  |  |
| `id` | string |  | PK |  |
| `is_active` | boolean |  |  |  |
| `updated_at` | string |  |  |  |

## Relationships

**Referenced by**

- [payroll_employee_lines](../tables/payroll_employee_lines.md) via `payroll_employee_lines.pay_code_id` (one-to-many)
- [payroll_work_type_map](../tables/payroll_work_type_map.md) via `payroll_work_type_map.pay_code_id` (one-to-many)

## Neighbourhood

```mermaid
erDiagram
  payroll_pay_codes {
    string code
    string created_at
    string default_pay_type
    string department
    string description "null"
    string id PK
    boolean is_active
    string updated_at
  }
  payroll_pay_codes ||--o{ payroll_employee_lines : "pay_code_id"
  payroll_pay_codes ||--o{ payroll_work_type_map : "pay_code_id"
```

## RLS policies

| Policy | Command | Roles | Using | With check | Calls | Source |
| --- | --- | --- | --- | --- | --- | --- |
| Finance+ manage pay codes | ALL | authenticated | `public.has_role_or_higher(auth.uid(), 'finance'::app_role)` | `public.has_role_or_higher(auth.uid(), 'finance'::app_role)` | `has_role_or_higher` | `20260901005118_4edf45d4-24b6-4f0b-8030-9002673617da.sql` |

## Triggers

| Trigger | When | Function | Function touches |
| --- | --- | --- | --- |
| `trg_payroll_pay_codes_updated` | BEFORE UPDATE FOR EACH ROW | `set_updated_at()` |  |

## Used by code

**Frontend**

- `src/pages/payroll/PayrollDashboard.tsx`
