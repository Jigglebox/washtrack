# Domain: auth.users

_Generated 2026-09-07 by `scripts/schema-map`. Do not edit by hand; run `npm run schema:map`._

[Back to overview](../README.md)

## Tables

| Table | Columns | RLS | Policies | Notes |
| --- | --- | --- | --- | --- |
| [manager_approval_requests](../tables/manager_approval_requests.md) | 10 | on | 5 |  |
| [report_templates](../tables/report_templates.md) | 12 | on | 4 |  |
| [user_roles](../tables/user_roles.md) | 4 | on | 10 |  |

## Relationships

Key columns only. Tables from other domains appear as stubs.

```mermaid
erDiagram
  auth_users["auth.users"] {
    uuid id PK
  }
  manager_approval_requests {
    string employee_id FK "-> auth.users"
    string id PK
    string manager_id FK "-> auth.users"
    string reviewed_by FK "-> auth.users, null"
  }
  report_templates {
    string created_by FK "-> auth.users, null"
    string id PK
    string template_name UK
  }
  user_roles {
    string id PK
    string user_id FK "-> auth.users"
  }
  auth_users ||--o{ manager_approval_requests : "employee_id"
  auth_users ||--o{ manager_approval_requests : "manager_id"
  auth_users |o--o{ manager_approval_requests : "reviewed_by"
  auth_users |o--o{ report_templates : "created_by"
  auth_users ||--o{ user_roles : "user_id"
```

## Connections to other domains

- `auth.users`
