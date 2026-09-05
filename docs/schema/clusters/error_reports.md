# Domain: error_reports

_Generated 2026-09-05 by `scripts/schema-map`. Do not edit by hand; run `npm run schema:map`._

[Back to overview](../README.md)

## Tables

| Table | Columns | RLS | Policies | Notes |
| --- | --- | --- | --- | --- |
| [error_report_replies](../tables/error_report_replies.md) | 5 | on | 2 |  |
| [error_reports](../tables/error_reports.md) | 12 | on | 4 |  |

## Relationships

Key columns only. Tables from other domains appear as stubs.

```mermaid
erDiagram
  auth_users["auth.users"] {
    uuid id PK
  }
  error_report_replies {
    string id PK
    string report_id FK "-> error_reports"
  }
  error_reports {
    string id PK
    string reported_by FK "-> auth.users"
    string responded_by FK "-> auth.users, null"
  }
  error_reports ||--o{ error_report_replies : "report_id"
  users ||..o{ error_report_replies : "user_id (inferred)"
  auth_users ||--o{ error_reports : "reported_by"
  auth_users |o--o{ error_reports : "responded_by"
```

## Connections to other domains

- `auth.users`
- [users](../tables/users.md) ([users](../clusters/users.md))
