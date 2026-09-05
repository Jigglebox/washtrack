# Table: payroll_work_type_map

_Generated 2026-09-05 by `scripts/schema-map`. Do not edit by hand; run `npm run schema:map`._

[Back to overview](../README.md) · Domain: [client_portal_users](../clusters/client_portal_users.md)

- Primary key: `id`
- RLS: enabled
- Defined in: `types.ts`, `20260901005118_4edf45d4-24b6-4f0b-8030-9002673617da.sql`

## Columns

| Column | Type | Null | Keys | References |
| --- | --- | --- | --- | --- |
| `created_at` | string |  |  |  |
| `id` | string |  | PK |  |
| `location_id` | string | yes | FK | [locations](../tables/locations.md).id |
| `pay_code_id` | string |  | FK | [payroll_pay_codes](../tables/payroll_pay_codes.md).id |
| `task_label` | string | yes |  |  |
| `updated_at` | string |  |  |  |
| `work_type_id` | string |  | FK | [work_types](../tables/work_types.md).id |

## Relationships

**References**

- [locations](../tables/locations.md) via `location_id` (many-to-one, optional)
- [payroll_pay_codes](../tables/payroll_pay_codes.md) via `pay_code_id` (many-to-one)
- [work_types](../tables/work_types.md) via `work_type_id` (many-to-one)

## Neighbourhood

```mermaid
erDiagram
  payroll_work_type_map {
    string created_at
    string id PK
    string location_id FK "-> locations, null"
    string pay_code_id FK "-> payroll_pay_codes"
    string task_label "null"
    string updated_at
    string work_type_id FK "-> work_types"
  }
  locations |o--o{ payroll_work_type_map : "location_id"
  payroll_pay_codes ||--o{ payroll_work_type_map : "pay_code_id"
  work_types ||--o{ payroll_work_type_map : "work_type_id"
```

## RLS policies

| Policy | Command | Roles | Using | With check | Calls | Source |
| --- | --- | --- | --- | --- | --- | --- |
| Finance+ manage payroll map | ALL | authenticated | `public.has_role_or_higher(auth.uid(), 'finance'::app_role)` | `public.has_role_or_higher(auth.uid(), 'finance'::app_role)` | `has_role_or_higher` | `20260901005118_4edf45d4-24b6-4f0b-8030-9002673617da.sql` |

## Triggers

| Trigger | When | Function | Function touches |
| --- | --- | --- | --- |
| `trg_payroll_map_updated` | BEFORE UPDATE FOR EACH ROW | `set_updated_at()` |  |

## Used by code

**Frontend**

- `src/pages/payroll/PayrollDashboard.tsx`
