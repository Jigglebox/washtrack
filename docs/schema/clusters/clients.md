# Domain: clients

_Generated 2026-09-07 by `scripts/schema-map`. Do not edit by hand; run `npm run schema:map`._

[Back to overview](../README.md)

## Tables

| Table | Columns | RLS | Policies | Notes |
| --- | --- | --- | --- | --- |
| [clients](../tables/clients.md) | 15 | on | 3 |  |
| [dealership_location_requests](../tables/dealership_location_requests.md) | 17 | on | 4 |  |
| [dealership_rates](../tables/dealership_rates.md) | 10 | on | 4 |  |
| [dealership_wash_batches](../tables/dealership_wash_batches.md) | 10 | on | 4 |  |

## Relationships

Key columns only. Tables from other domains appear as stubs.

```mermaid
erDiagram
  clients {
    string id PK
  }
  dealership_location_requests {
    string created_client_id FK "-> clients, null"
    string created_location_id FK "-> locations, null"
    string id PK
    string matched_client_id FK "-> clients, null"
  }
  dealership_rates {
    string client_id FK "-> clients"
    string id PK
    string location_id FK "-> locations, null"
  }
  dealership_wash_batches {
    string client_id FK "-> clients"
    string id PK
    string location_id FK "-> locations"
  }
  clients |o--o{ dealership_location_requests : "created_client_id"
  clients |o--o{ dealership_location_requests : "matched_client_id"
  locations |o--o{ dealership_location_requests : "created_location_id"
  users ||..o{ dealership_location_requests : "requested_by (inferred)"
  users |o..o{ dealership_location_requests : "reviewed_by (inferred)"
  clients ||--o{ dealership_rates : "client_id"
  locations |o--o{ dealership_rates : "location_id"
  users |o..o{ dealership_rates : "created_by (inferred)"
  clients ||--o{ dealership_wash_batches : "client_id"
  locations ||--o{ dealership_wash_batches : "location_id"
  users ||..o{ dealership_wash_batches : "employee_id (inferred)"
  clients ||--o{ locations : "client_id"
  clients ||--o{ rate_configs : "client_id"
  clients |o--o{ tickets : "client_id"
```

## Connections to other domains

- [locations](../tables/locations.md) ([locations](../clusters/locations.md))
- [rate_configs](../tables/rate_configs.md) ([client_portal_users](../clusters/client_portal_users.md))
- [tickets](../tables/tickets.md) ([tickets](../clusters/tickets.md))
- [users](../tables/users.md) ([users](../clusters/users.md))
