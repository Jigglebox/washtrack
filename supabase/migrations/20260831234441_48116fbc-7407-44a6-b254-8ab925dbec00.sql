CREATE SEQUENCE IF NOT EXISTS public.ticket_number_seq;

CREATE TABLE public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number text NOT NULL UNIQUE DEFAULT ('TKT-' || lpad(nextval('public.ticket_number_seq')::text, 6, '0')),
  submitted_by uuid NOT NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  work_date date,
  address text,
  employee_id uuid,
  comments text,
  photo_url text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tickets_status_check CHECK (status IN ('open','in_progress','closed'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tickets TO authenticated;
GRANT ALL ON public.tickets TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ticket_number_seq TO authenticated;
GRANT ALL ON SEQUENCE public.ticket_number_seq TO service_role;

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers and above can create tickets"
  ON public.tickets FOR INSERT TO authenticated
  WITH CHECK (submitted_by = auth.uid() AND public.has_role_or_higher(auth.uid(), 'manager'::app_role));

CREATE POLICY "View own tickets or all for finance and above"
  ON public.tickets FOR SELECT TO authenticated
  USING (submitted_by = auth.uid() OR public.has_role_or_higher(auth.uid(), 'finance'::app_role));

CREATE POLICY "Finance and above can update tickets"
  ON public.tickets FOR UPDATE TO authenticated
  USING (public.has_role_or_higher(auth.uid(), 'finance'::app_role))
  WITH CHECK (public.has_role_or_higher(auth.uid(), 'finance'::app_role));

CREATE POLICY "Admins can delete tickets"
  ON public.tickets FOR DELETE TO authenticated
  USING (public.has_role_or_higher(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_tickets_updated
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.ticket_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  position integer NOT NULL,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticket_line_items_position_check CHECK (position BETWEEN 1 AND 10),
  UNIQUE (ticket_id, position)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_line_items TO authenticated;
GRANT ALL ON public.ticket_line_items TO service_role;

ALTER TABLE public.ticket_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Line items follow ticket visibility"
  ON public.ticket_line_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = ticket_id
      AND (t.submitted_by = auth.uid() OR public.has_role_or_higher(auth.uid(), 'finance'::app_role))
  ));

CREATE POLICY "Ticket owner can add line items"
  ON public.ticket_line_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = ticket_id AND t.submitted_by = auth.uid()
  ));

CREATE TABLE public.ticket_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_replies TO authenticated;
GRANT ALL ON public.ticket_replies TO service_role;

ALTER TABLE public.ticket_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Replies follow ticket visibility"
  ON public.ticket_replies FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = ticket_id
      AND (t.submitted_by = auth.uid() OR public.has_role_or_higher(auth.uid(), 'finance'::app_role))
  ));

CREATE POLICY "Participants can reply to tickets"
  ON public.ticket_replies FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.id = ticket_id
        AND (t.submitted_by = auth.uid() OR public.has_role_or_higher(auth.uid(), 'finance'::app_role))
    )
  );

CREATE TABLE public.ticket_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  last_viewed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.ticket_views TO authenticated;
GRANT ALL ON public.ticket_views TO service_role;

ALTER TABLE public.ticket_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own ticket view marker"
  ON public.ticket_views FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users insert their own ticket view marker"
  ON public.ticket_views FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update their own ticket view marker"
  ON public.ticket_views FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());