# Domain: payroll_employee_lines

_Generated 2026-09-05 by `scripts/schema-map`. Do not edit by hand; run `npm run schema:map`._

[Back to overview](../README.md)

## Tables

| Table | Columns | RLS | Policies | Notes |
| --- | --- | --- | --- | --- |
| [payroll_employee_lines](../tables/payroll_employee_lines.md) | 16 | on | 1 |  |
| [payroll_hours_imports](../tables/payroll_hours_imports.md) | 14 | on | 1 |  |
| [payroll_periods](../tables/payroll_periods.md) | 10 | on | 1 |  |
| [payroll_run_lines](../tables/payroll_run_lines.md) | 17 | on | 1 |  |

## Relationships

Key columns only. Tables from other domains appear as stubs.

```mermaid
erDiagram
  payroll_employee_lines {
    string employee_id FK "-> users, null"
    string id PK
    string pay_code_id FK "-> payroll_pay_codes"
  }
  payroll_hours_imports {
    string employee_id FK "-> users, null"
    string employee_line_id FK "-> payroll_employee_lines, null"
    string id PK
    string period_id FK "-> payroll_periods"
  }
  payroll_periods {
    string id PK
    string period_start UK
  }
  payroll_run_lines {
    string employee_id FK "-> users, null"
    string employee_line_id FK "-> payroll_employee_lines, null"
    string id PK
    string period_id FK "-> payroll_periods"
  }
  payroll_pay_codes ||--o{ payroll_employee_lines : "pay_code_id"
  users |o--o{ payroll_employee_lines : "employee_id"
  payroll_employee_lines |o--o{ payroll_hours_imports : "employee_line_id"
  payroll_periods ||--o{ payroll_hours_imports : "period_id"
  users |o--o{ payroll_hours_imports : "employee_id"
  users |o..o{ payroll_periods : "created_by (inferred)"
  payroll_employee_lines |o--o{ payroll_run_lines : "employee_line_id"
  payroll_periods ||--o{ payroll_run_lines : "period_id"
  users |o--o{ payroll_run_lines : "employee_id"
```

## Connections to other domains

- [payroll_pay_codes](../tables/payroll_pay_codes.md) ([client_portal_users](../clusters/client_portal_users.md))
- [users](../tables/users.md) ([users](../clusters/users.md))
