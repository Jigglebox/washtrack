# Payroll Side of the Weekly Report

Goal: produce a weekly payroll run for ES&D that pays washers per unit (from work already logged in WashTrack) plus hourly people (from an uploaded timesheet file), and exports an Excel file in the exact format Future Systems expects.

## What already exists

- Payroll mode, green theme, `/payroll/dashboard` route, and a placeholder dashboard.
- Every unit of work is already recorded per employee, per day, per work item: `work_logs` (2,324 rows in the last 30 days) joined to `rate_configs` -> `work_types` (Fed Ex PUD, Trailer, W1200, etc.).
- Employees exist in `users`, with locations assigned.

## What is missing (the data we have to add)

1. **Employee pay rates per unit.** The `users` table has `pay_rate` / `pay_type` columns but every row is empty, and a single rate per employee is not enough anyway: pay per PUD differs from pay per trailer. We need a pay-rate table keyed by employee + work type (+ optional location), with an effective date so raises don't rewrite history.
2. **Hourly time.** Nothing in the app captures clock hours. These arrive as a weekly CSV/Excel upload from an outside timekeeping system, so we need an import target table (employee, date or week, hours, optional department/task) plus the upload screen and column mapping.
3. **Pay periods.** A record per weekly period (Mon–Sun) with status draft / locked / paid, so a run can be frozen and re-opened.
4. **Payroll run lines.** The computed result: one line per employee × pay code (unit type or hourly) × department, with quantity, rate, and amount. Stored so a locked week is reproducible even if rates later change.
5. **The exact Excel template.** This is the piece I cannot infer. I need your current Future Systems payroll workbook (a real filled-out week is best) so I can match sheet name, header rows, column order, blank spacer rows/columns, number formats, and employee identifier used by Future Systems (their employee code, not our `employee_id`, if they differ).

## Build sequence

1. **Schema + rates admin.** Create `payroll_pay_codes`, `payroll_employee_rates`, `payroll_periods`, `payroll_hours_imports`, `payroll_run_lines` (Finance+ only via RLS). Add a Payroll > Pay Rates screen to set each employee's per-unit rates and hourly base.
2. **Hours import.** Payroll > Import Hours: upload CSV/XLSX, map columns, preview, match employees by name/ID, commit into the period. Re-uploading replaces the prior import for that week.
3. **Run builder.** Payroll > Pay Periods: pick a week, generate the run. Units come from `work_logs` grouped by employee × work type; hours come from the import; each line gets the rate effective for that week. Editable lines with a note field for manual adjustments, then Lock.
4. **Excel export.** Generate the Future Systems workbook cell-for-cell from your template, including blank spacers and number formats, plus an on-screen review sheet before export.
5. **Optional follow-on.** Labor cost per location/client next to the invoicing revenue for margin analysis.

## Technical notes

- Units are read from the same `work_logs` rows invoicing uses, so payroll and invoicing never diverge; test locations (`is_test`) are excluded exactly as in reports.
- Rates are versioned by `effective_date`; run lines snapshot the rate used, so a locked week never changes retroactively.
- Week boundaries use the existing Monday–Sunday convention and `parseLocalDate()` to avoid timezone shifts.
- Excel generation uses a sheet writer that can set explicit cell formats and leave blank cells, rather than a generic CSV dump.
- Payroll pages stay Finance+ gated; employees and managers see nothing of pay rates.

## What I need from you to start step 1

- The Future Systems payroll Excel file (one completed week).
- A sample of the hours CSV/Excel from the timekeeping system.
- The pay-rate list per employee per unit type (or confirmation to build the screen empty and let you key them in).
