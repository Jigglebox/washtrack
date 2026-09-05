# Domain: employee_comments

_Generated 2026-09-05 by `scripts/schema-map`. Do not edit by hand; run `npm run schema:map`._

[Back to overview](../README.md)

## Tables

| Table | Columns | RLS | Policies | Notes |
| --- | --- | --- | --- | --- |
| [employee_comments](../tables/employee_comments.md) | 9 | on | 4 |  |
| [message_reads](../tables/message_reads.md) | 4 | on | 2 | junction |
| [message_replies](../tables/message_replies.md) | 5 | on | 4 |  |

## Relationships

Key columns only. Tables from other domains appear as stubs.

```mermaid
erDiagram
  employee_comments {
    string id PK
    string recipient_id FK "-> users, null"
  }
  message_reads {
    string comment_id FK "-> employee_comments"
    string id PK
    string user_id FK "-> users"
  }
  message_replies {
    string comment_id FK "-> employee_comments"
    string id PK
    string user_id FK "-> users"
  }
  locations |o..o{ employee_comments : "location_id (inferred)"
  users ||..o{ employee_comments : "employee_id (inferred)"
  users |o--o{ employee_comments : "recipient_id"
  employee_comments ||--o{ message_reads : "comment_id"
  users ||--o{ message_reads : "user_id"
  employee_comments ||--o{ message_replies : "comment_id"
  users ||--o{ message_replies : "user_id"
```

## Connections to other domains

- [locations](../tables/locations.md) ([locations](../clusters/locations.md))
- [users](../tables/users.md) ([users](../clusters/users.md))
