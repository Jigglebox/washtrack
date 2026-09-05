# Domain: locations

_Generated 2026-09-05 by `scripts/schema-map`. Do not edit by hand; run `npm run schema:map`._

[Back to overview](../README.md)

## Tables

| Table | Columns | RLS | Policies | Notes |
| --- | --- | --- | --- | --- |
| [locations](../tables/locations.md) | 9 | on | 4 | hub |
| [user_locations](../tables/user_locations.md) | 5 | on | 3 | junction |

## Relationships

Key columns only. Tables from other domains appear as stubs.

```mermaid
erDiagram
  locations {
    string client_id FK "-> clients"
    string id PK
  }
  user_locations {
    string id PK
    string location_id FK "-> locations"
    string user_id FK "-> users"
  }
  locations ||--o{ client_portal_access_requests : "location_id"
  locations ||--o{ client_portal_location_access : "location_id"
  locations |o--o{ dealership_location_requests : "created_location_id"
  locations |o--o{ dealership_rates : "location_id"
  locations ||--o{ dealership_wash_batches : "location_id"
  locations |o..o{ employee_comments : "location_id (inferred)"
  clients ||--o{ locations : "client_id"
  locations |o--o{ payroll_work_type_map : "location_id"
  locations ||--o{ rate_configs : "location_id"
  locations |o--o{ tickets : "location_id"
  locations ||--o{ user_locations : "location_id"
  users ||--o{ user_locations : "user_id"
  locations |o--o{ users : "location_id"
  locations ||--o{ wash_requests : "location_id"
```

## Connections to other domains

- [client_portal_access_requests](../tables/client_portal_access_requests.md) ([client_portal_users](../clusters/client_portal_users.md))
- [client_portal_location_access](../tables/client_portal_location_access.md) ([client_portal_users](../clusters/client_portal_users.md))
- [clients](../tables/clients.md) ([clients](../clusters/clients.md))
- [dealership_location_requests](../tables/dealership_location_requests.md) ([clients](../clusters/clients.md))
- [dealership_rates](../tables/dealership_rates.md) ([clients](../clusters/clients.md))
- [dealership_wash_batches](../tables/dealership_wash_batches.md) ([clients](../clusters/clients.md))
- [employee_comments](../tables/employee_comments.md) ([employee_comments](../clusters/employee_comments.md))
- [payroll_work_type_map](../tables/payroll_work_type_map.md) ([client_portal_users](../clusters/client_portal_users.md))
- [rate_configs](../tables/rate_configs.md) ([client_portal_users](../clusters/client_portal_users.md))
- [tickets](../tables/tickets.md) ([tickets](../clusters/tickets.md))
- [users](../tables/users.md) ([users](../clusters/users.md))
- [wash_requests](../tables/wash_requests.md) ([client_portal_users](../clusters/client_portal_users.md))
