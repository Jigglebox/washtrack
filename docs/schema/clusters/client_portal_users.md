# Domain: client_portal_users

_Generated 2026-09-07 by `scripts/schema-map`. Do not edit by hand; run `npm run schema:map`._

[Back to overview](../README.md)

## Tables

| Table | Columns | RLS | Policies | Notes |
| --- | --- | --- | --- | --- |
| [client_portal_access_requests](../tables/client_portal_access_requests.md) | 10 | on | 4 |  |
| [client_portal_location_access](../tables/client_portal_location_access.md) | 5 | on | 3 | junction |
| [client_portal_users](../tables/client_portal_users.md) | 18 | on | 5 |  |
| [payroll_pay_codes](../tables/payroll_pay_codes.md) | 8 | on | 1 |  |
| [payroll_work_type_map](../tables/payroll_work_type_map.md) | 7 | on | 1 |  |
| [rate_configs](../tables/rate_configs.md) | 9 | on | 4 |  |
| [wash_requests](../tables/wash_requests.md) | 9 | on | 6 |  |
| [work_items](../tables/work_items.md) | 5 | on | 4 |  |
| [work_logs](../tables/work_logs.md) | 8 | on | 4 |  |
| [work_types](../tables/work_types.md) | 6 | on | 2 |  |

## Relationships

Key columns only. Tables from other domains appear as stubs.

```mermaid
erDiagram
  auth_users["auth.users"] {
    uuid id PK
  }
  client_portal_access_requests {
    string id PK
    string location_id FK "-> locations"
    string portal_user_id FK "-> client_portal_users"
    string reviewed_by FK "-> auth.users, null"
  }
  client_portal_location_access {
    string granted_by FK "-> auth.users, null"
    string id PK
    string location_id FK "-> locations"
    string portal_user_id FK "-> client_portal_users"
  }
  client_portal_users {
    string approved_by FK "-> auth.users, null"
    string auth_user_id FK, UK "-> auth.users"
    string id PK
  }
  payroll_pay_codes {
    string id PK
  }
  payroll_work_type_map {
    string id PK
    string location_id FK "-> locations, null"
    string pay_code_id FK "-> payroll_pay_codes"
    string work_type_id FK "-> work_types"
  }
  rate_configs {
    string client_id FK "-> clients"
    string id PK
    string location_id FK "-> locations"
    string work_type_id FK "-> work_types"
  }
  wash_requests {
    string fulfilled_work_log_id FK "-> work_logs, null"
    string id PK
    string location_id FK "-> locations"
    string portal_user_id FK "-> client_portal_users"
    string work_item_id FK "-> work_items"
  }
  work_items {
    string id PK
    string rate_config_id FK "-> rate_configs"
  }
  work_logs {
    string employee_id FK "-> users"
    string id PK
    string rate_config_id FK "-> rate_configs, null"
    string work_item_id FK "-> work_items, null"
  }
  work_types {
    string id PK
    string name UK
  }
  auth_users |o--o{ client_portal_access_requests : "reviewed_by"
  client_portal_users ||--o{ client_portal_access_requests : "portal_user_id"
  locations ||--o{ client_portal_access_requests : "location_id"
  auth_users |o--o{ client_portal_location_access : "granted_by"
  client_portal_users ||--o{ client_portal_location_access : "portal_user_id"
  locations ||--o{ client_portal_location_access : "location_id"
  auth_users |o--o{ client_portal_users : "approved_by"
  auth_users ||--o{ client_portal_users : "auth_user_id"
  payroll_pay_codes ||--o{ payroll_employee_lines : "pay_code_id"
  locations |o--o{ payroll_work_type_map : "location_id"
  payroll_pay_codes ||--o{ payroll_work_type_map : "pay_code_id"
  work_types ||--o{ payroll_work_type_map : "work_type_id"
  clients ||--o{ rate_configs : "client_id"
  locations ||--o{ rate_configs : "location_id"
  work_types ||--o{ rate_configs : "work_type_id"
  client_portal_users ||--o{ wash_requests : "portal_user_id"
  locations ||--o{ wash_requests : "location_id"
  work_items ||--o{ wash_requests : "work_item_id"
  work_logs |o--o{ wash_requests : "fulfilled_work_log_id"
  rate_configs ||--o{ work_items : "rate_config_id"
  rate_configs |o--o{ work_logs : "rate_config_id"
  users ||--o{ work_logs : "employee_id"
  work_items |o--o{ work_logs : "work_item_id"
```

## Connections to other domains

- `auth.users`
- [clients](../tables/clients.md) ([clients](../clusters/clients.md))
- [locations](../tables/locations.md) ([locations](../clusters/locations.md))
- [payroll_employee_lines](../tables/payroll_employee_lines.md) ([payroll_employee_lines](../clusters/payroll_employee_lines.md))
- [users](../tables/users.md) ([users](../clusters/users.md))
