
-- Pay code catalog
CREATE TABLE public.payroll_pay_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL,
  department TEXT NOT NULL,
  default_pay_type TEXT NOT NULL DEFAULT 'Unit',
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code, department)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_pay_codes TO authenticated;
GRANT ALL ON public.payroll_pay_codes TO service_role;
ALTER TABLE public.payroll_pay_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance+ manage pay codes" ON public.payroll_pay_codes FOR ALL TO authenticated
  USING (public.has_role_or_higher(auth.uid(), 'finance'::app_role))
  WITH CHECK (public.has_role_or_higher(auth.uid(), 'finance'::app_role));

-- Recurring employee pay lines (the payroll roster)
CREATE TABLE public.payroll_employee_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  provider_employee_number TEXT,
  pay_code_id UUID NOT NULL REFERENCES public.payroll_pay_codes(id) ON DELETE RESTRICT,
  department TEXT NOT NULL,
  task_label TEXT NOT NULL,
  rate NUMERIC NOT NULL DEFAULT 0,
  pay_type TEXT NOT NULL DEFAULT 'Unit',
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payroll_employee_lines_employee ON public.payroll_employee_lines(employee_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_employee_lines TO authenticated;
GRANT ALL ON public.payroll_employee_lines TO service_role;
ALTER TABLE public.payroll_employee_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance+ manage employee pay lines" ON public.payroll_employee_lines FOR ALL TO authenticated
  USING (public.has_role_or_higher(auth.uid(), 'finance'::app_role))
  WITH CHECK (public.has_role_or_higher(auth.uid(), 'finance'::app_role));

-- Work type -> pay code mapping
CREATE TABLE public.payroll_work_type_map (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  work_type_id UUID NOT NULL REFERENCES public.work_types(id) ON DELETE CASCADE,
  location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE,
  pay_code_id UUID NOT NULL REFERENCES public.payroll_pay_codes(id) ON DELETE CASCADE,
  task_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_payroll_map_unique ON public.payroll_work_type_map(work_type_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_work_type_map TO authenticated;
GRANT ALL ON public.payroll_work_type_map TO service_role;
ALTER TABLE public.payroll_work_type_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance+ manage payroll map" ON public.payroll_work_type_map FOR ALL TO authenticated
  USING (public.has_role_or_higher(auth.uid(), 'finance'::app_role))
  WITH CHECK (public.has_role_or_higher(auth.uid(), 'finance'::app_role));

-- Weekly pay periods
CREATE TABLE public.payroll_periods (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  check_date DATE,
  status TEXT NOT NULL DEFAULT 'draft',
  locked_at TIMESTAMPTZ,
  locked_by UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (period_start)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_periods TO authenticated;
GRANT ALL ON public.payroll_periods TO service_role;
ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance+ manage pay periods" ON public.payroll_periods FOR ALL TO authenticated
  USING (public.has_role_or_higher(auth.uid(), 'finance'::app_role))
  WITH CHECK (public.has_role_or_higher(auth.uid(), 'finance'::app_role));

-- Imported hours from the outside timekeeping system
CREATE TABLE public.payroll_hours_imports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period_id UUID NOT NULL REFERENCES public.payroll_periods(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  employee_line_id UUID REFERENCES public.payroll_employee_lines(id) ON DELETE SET NULL,
  raw_name TEXT NOT NULL,
  provider_employee_number TEXT,
  department TEXT,
  task_label TEXT,
  hours NUMERIC NOT NULL DEFAULT 0,
  ot_hours NUMERIC NOT NULL DEFAULT 0,
  source_filename TEXT,
  imported_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payroll_hours_period ON public.payroll_hours_imports(period_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_hours_imports TO authenticated;
GRANT ALL ON public.payroll_hours_imports TO service_role;
ALTER TABLE public.payroll_hours_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance+ manage hours imports" ON public.payroll_hours_imports FOR ALL TO authenticated
  USING (public.has_role_or_higher(auth.uid(), 'finance'::app_role))
  WITH CHECK (public.has_role_or_higher(auth.uid(), 'finance'::app_role));

-- Computed payroll run lines
CREATE TABLE public.payroll_run_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period_id UUID NOT NULL REFERENCES public.payroll_periods(id) ON DELETE CASCADE,
  employee_line_id UUID REFERENCES public.payroll_employee_lines(id) ON DELETE SET NULL,
  employee_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  notes TEXT,
  code TEXT NOT NULL,
  department TEXT NOT NULL,
  task_label TEXT NOT NULL,
  display_name TEXT NOT NULL,
  provider_employee_number TEXT,
  rate NUMERIC NOT NULL DEFAULT 0,
  quantity NUMERIC NOT NULL DEFAULT 0,
  ot_hours NUMERIC NOT NULL DEFAULT 0,
  pay_type TEXT NOT NULL DEFAULT 'Unit',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payroll_run_lines_period ON public.payroll_run_lines(period_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_run_lines TO authenticated;
GRANT ALL ON public.payroll_run_lines TO service_role;
ALTER TABLE public.payroll_run_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance+ manage run lines" ON public.payroll_run_lines FOR ALL TO authenticated
  USING (public.has_role_or_higher(auth.uid(), 'finance'::app_role))
  WITH CHECK (public.has_role_or_higher(auth.uid(), 'finance'::app_role));

-- updated_at triggers
CREATE TRIGGER trg_payroll_pay_codes_updated BEFORE UPDATE ON public.payroll_pay_codes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_payroll_employee_lines_updated BEFORE UPDATE ON public.payroll_employee_lines FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_payroll_map_updated BEFORE UPDATE ON public.payroll_work_type_map FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_payroll_periods_updated BEFORE UPDATE ON public.payroll_periods FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_payroll_hours_updated BEFORE UPDATE ON public.payroll_hours_imports FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_payroll_run_lines_updated BEFORE UPDATE ON public.payroll_run_lines FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
