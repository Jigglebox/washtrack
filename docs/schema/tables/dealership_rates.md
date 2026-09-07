# Table: dealership_rates

_Generated 2026-09-07 by `scripts/schema-map`. Do not edit by hand; run `npm run schema:map`._

[Back to overview](../README.md) · Domain: [clients](../clusters/clients.md)

- Primary key: `id`
- RLS: enabled
- Defined in: `types.ts`, `20260618054621_0b47f4fa-4cea-4f03-92ac-680a88e98bc8.sql`

## Columns

| Column | Type | Null | Keys | References |
| --- | --- | --- | --- | --- |
| `client_id` | string |  | FK | [clients](../tables/clients.md).id |
| `created_at` | string |  |  |  |
| `created_by` | string | yes |  | [users](../tables/users.md).id (inferred) |
| `effective_date` | string |  |  |  |
| `id` | string |  | PK |  |
| `is_active` | boolean |  |  |  |
| `location_id` | string | yes | FK | [locations](../tables/locations.md).id |
| `notes` | string | yes |  |  |
| `rate_per_vehicle` | number |  |  |  |
| `updated_at` | string |  |  |  |

## Relationships

**References**

- [clients](../tables/clients.md) via `client_id` (many-to-one)
- [locations](../tables/locations.md) via `location_id` (many-to-one, optional)
- [users](../tables/users.md) via `created_by` (many-to-one, optional, **inferred**)

## Neighbourhood

```mermaid
erDiagram
  dealership_rates {
    string client_id FK "-> clients"
    string created_at
    string created_by "?-> users, null"
    string effective_date
    string id PK
    boolean is_active
    string location_id FK "-> locations, null"
    string notes "null"
    number rate_per_vehicle
    string updated_at
  }
  clients ||--o{ dealership_rates : "client_id"
  locations |o--o{ dealership_rates : "location_id"
  users |o..o{ dealership_rates : "created_by (inferred)"
```

## RLS policies

| Policy | Command | Roles | Using | With check | Calls | Source |
| --- | --- | --- | --- | --- | --- | --- |
| Admin can delete dealership rates | DELETE | authenticated | `public.has_role_or_higher(auth.uid(), 'admin'::app_role)` |  | `has_role_or_higher` | `20260618054621_0b47f4fa-4cea-4f03-92ac-680a88e98bc8.sql` |
| Authenticated can view dealership rates | SELECT | authenticated | `true` |  |  | `20260618054621_0b47f4fa-4cea-4f03-92ac-680a88e98bc8.sql` |
| Finance+ can insert dealership rates | INSERT | authenticated |  | `public.has_role_or_higher(auth.uid(), 'finance'::app_role)` | `has_role_or_higher` | `20260618054621_0b47f4fa-4cea-4f03-92ac-680a88e98bc8.sql` |
| Finance+ can update dealership rates | UPDATE | authenticated | `public.has_role_or_higher(auth.uid(), 'finance'::app_role)` |  | `has_role_or_higher` | `20260618054621_0b47f4fa-4cea-4f03-92ac-680a88e98bc8.sql` |

## Triggers

| Trigger | When | Function | Function touches |
| --- | --- | --- | --- |
| `trg_dealership_rates_updated` | BEFORE UPDATE FOR EACH ROW | `set_updated_at()` |  |

## Review notes

- **low** `connectedness/loose-links`: 1 link exist only by column name; the database does not enforce them, so deleting the target leaves dangling references. `created_by → users`

## Used by code

_No direct queries found in code._
