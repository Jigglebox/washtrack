# Manager Tickets

A new ticket submission flow for managers and above, separate from weekly work entries, surfaced to office staff in a dedicated Tickets section of Messages with blue notification dots.

## What managers get

A "Submit Ticket" action (Manager Dashboard + Messages page) with two paths:

- **Photo ticket** — take or upload a photo and submit. Nothing else required; the ticket number is generated automatically.
- **Form ticket** — fill out:
  - Customer (client picker)
  - Date
  - Address (auto-filled from the selected location, editable)
  - Employee (user search, defaults to the submitting manager)
  - Line Items 1-10, description text only, add/remove rows
  - Comments
  - Optional photo attachment

Every ticket shows an auto ticket number in the format `TKT-000123`, visible to the manager and to office staff.

## What office staff get

- Messages page gains a **Tickets** tab/section alongside existing conversations.
- Ticket cards show number, customer, date, employee, submitter, and photo thumbnail; expanding shows line items, comments, and the full-size photo.
- Office staff can reply on a ticket thread and mark it Open / In Progress / Closed.
- **Blue** unread dot/badge for tickets (sidebar "Messages" item and the Tickets tab), kept separate from the existing red message badge.

## Managers' view

Managers see their own submitted tickets and any office replies in the same Tickets section.

## Technical notes

Database (one migration):
- `ticket_number` sequence + default so numbers are server-generated and gap-free in format `TKT-` + 6-digit padded value.
- `public.tickets`: `ticket_number` (unique text), `submitted_by`, `client_id`, `location_id`, `work_date`, `address`, `employee_id`, `comments`, `photo_url`, `status` (`open|in_progress|closed`), timestamps + updated_at trigger.
- `public.ticket_line_items`: `ticket_id`, `position` (1-10), `description`.
- `public.ticket_replies`: `ticket_id`, `user_id`, `body`.
- GRANTs for `authenticated` and `service_role` on all three; RLS enabled.
- Policies: insert by `has_role_or_higher(auth.uid(),'manager')` with `submitted_by = auth.uid()`; select own tickets, or any if `has_role_or_higher(...,'finance')`; update status finance+; line items/replies scoped through the parent ticket.
- `ticket_views` (or reuse the existing `user_message_views` pattern with a `ticket` key) to track the last-viewed timestamp for the blue unread count.

Storage:
- New private `ticket-photos` bucket with RLS on `storage.objects` mirroring ticket read access; signed URLs used for display.

Frontend:
- `src/components/tickets/SubmitTicketModal.tsx` — mode toggle (Photo / Form), `capture="environment"` file input for mobile camera, dynamic line-item rows.
- `src/components/tickets/TicketList.tsx` + `TicketCard.tsx` — collapsible cards reusing the existing Messages card styling.
- `src/hooks/useUnreadTicketCount.ts` — mirrors `useUnreadMessageCount`, powers the blue badge.
- `src/pages/Messages.tsx` — add Tickets section; `src/components/Layout.tsx` — render the blue ticket badge next to the existing red one; `src/pages/ManagerDashboard.tsx` — Submit Ticket entry point and recent tickets list.
