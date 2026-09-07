# Domain: tickets

_Generated 2026-09-07 by `scripts/schema-map`. Do not edit by hand; run `npm run schema:map`._

[Back to overview](../README.md)

## Tables

| Table | Columns | RLS | Policies | Notes |
| --- | --- | --- | --- | --- |
| [ticket_line_items](../tables/ticket_line_items.md) | 5 | on | 2 |  |
| [ticket_replies](../tables/ticket_replies.md) | 5 | on | 2 |  |
| [tickets](../tables/tickets.md) | 13 | on | 4 |  |

## Relationships

Key columns only. Tables from other domains appear as stubs.

```mermaid
erDiagram
  ticket_line_items {
    string id PK
    string ticket_id FK "-> tickets"
  }
  ticket_replies {
    string id PK
    string ticket_id FK "-> tickets"
  }
  tickets {
    string client_id FK "-> clients, null"
    string id PK
    string location_id FK "-> locations, null"
    string ticket_number UK
  }
  tickets ||--o{ ticket_line_items : "ticket_id"
  tickets ||--o{ ticket_replies : "ticket_id"
  users ||..o{ ticket_replies : "user_id (inferred)"
  clients |o--o{ tickets : "client_id"
  locations |o--o{ tickets : "location_id"
  users |o..o{ tickets : "employee_id (inferred)"
  users ||..o{ tickets : "submitted_by (inferred)"
```

## Connections to other domains

- [clients](../tables/clients.md) ([clients](../clusters/clients.md))
- [locations](../tables/locations.md) ([locations](../clusters/locations.md))
- [users](../tables/users.md) ([users](../clusters/users.md))
