# Table: ticket_replies

_Generated 2026-09-05 by `scripts/schema-map`. Do not edit by hand; run `npm run schema:map`._

[Back to overview](../README.md) · Domain: [tickets](../clusters/tickets.md)

- Primary key: `id`
- RLS: enabled
- Defined in: `types.ts`, `20260831234441_48116fbc-7407-44a6-b254-8ab925dbec00.sql`

## Columns

| Column | Type | Null | Keys | References |
| --- | --- | --- | --- | --- |
| `body` | string |  |  |  |
| `created_at` | string |  |  |  |
| `id` | string |  | PK |  |
| `ticket_id` | string |  | FK | [tickets](../tables/tickets.md).id |
| `user_id` | string |  |  | [users](../tables/users.md).id (inferred) |

## Relationships

**References**

- [tickets](../tables/tickets.md) via `ticket_id` (many-to-one)
- [users](../tables/users.md) via `user_id` (many-to-one, **inferred**)

## Neighbourhood

```mermaid
erDiagram
  ticket_replies {
    string body
    string created_at
    string id PK
    string ticket_id FK "-> tickets"
    string user_id "?-> users"
  }
  tickets ||--o{ ticket_replies : "ticket_id"
  users ||..o{ ticket_replies : "user_id (inferred)"
```

## RLS policies

| Policy | Command | Roles | Using | With check | Calls | Source |
| --- | --- | --- | --- | --- | --- | --- |
| Participants can reply to tickets | INSERT | authenticated | `` | `user_id = auth.uid() AND EXISTS ( SELECT 1 FROM public.tickets t WHERE t.id = ticket_id AND (t.submitted_by = auth.uid(…` | `has_role_or_higher` | `20260831234441_48116fbc-7407-44a6-b254-8ab925dbec00.sql` |
| Replies follow ticket visibility | SELECT | authenticated | `EXISTS ( SELECT 1 FROM public.tickets t WHERE t.id = ticket_id AND (t.submitted_by = auth.uid() OR public.has_role_or_h…` |  | `has_role_or_higher` | `20260831234441_48116fbc-7407-44a6-b254-8ab925dbec00.sql` |

## Used by code

**Frontend**

- `src/components/tickets/TicketList.tsx`
