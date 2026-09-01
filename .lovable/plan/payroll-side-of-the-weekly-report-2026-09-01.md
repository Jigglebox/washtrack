# Payroll Side of the Weekly Report

Goal: produce a weekly payroll run for ES&D that pays washers per unit (from work already logged in WashTrack) plus hourly/salary people, and exports a workbook that is cell-for-cell identical to the Payroll Worksheet you sent.

## The template, as read from your file

Sheet `Payroll`, one row per employee pay line, columns:

```text
A Notes | B Code | C Department | D (task/location label, no header)
E Name  | F Employee Number | G Rate | H Hrs or Units | I E02 OT Hours
J Type  | K Total Gross Pay
```

- A1 `ES&D Services, Inc.`, A2 `Payroll Worksheet` (both merged A:K), C4 `Pay Period:` with E4 `7/13/2026-7/19/2026`, C5 `Check Date:` with E5 a real date.
- Header row 7, data starts row 8, then a total row: J `Total`, K `=SUM(K8:K57)`, A:I merged.
- K holds live formulas, not values: `=(G*H)` for unit/no-OT lines and `=(G*H)+(I*(G*1.5))` for hourly lines that can earn overtime.
- Formats: G currency `"$"#,##0.00_);[Red]("$"#,##0.00)`, H and K accounting `_(* #,##0.00_);...`, Arial 14 bold headers, fixed column widths (D 34.4, E 36.6, K 15.7), column A left narrow and empty for notes.
- Lines are sorted by employee last name, and one employee legitimately has several lines (Carlile has Mobile Wash, FedEx, and Snow; Richards has four).
- Column H arrives blank in the blank template — that is the number we fill in from WashTrack units and imported hours.

## What is missing (the data we have to add)

1. **Pay code + department catalog.** Codes like `E25` (FedEx PUD), `E26` (Janitorial), `E53` (W-series), `E68` (interior cleaning), `E23` (Travel), `E11` (Snow), `E12` (Lawn), `E01` (Office), `E03` (PTO), `E58` (Mobile Wash), `E99` (contractor), each with its department (FedEx, Lawn, Snow, Office, Mobile Wash) and pay type (Unit / Hourly / Salary). None of this exists in the app.
2. **Employee pay lines (the recurring roster).** A per-employee row set: pay code, department, task label for column D (`MLI PUD`, `DBQ ISP- Interior Cleaning`, `Cedar Rapids`), Future Systems employee number (`9992`, `10052` — not our `employee_id`), rate, and type. Rates are versioned by effective date so raises don't rewrite locked weeks. `users.pay_rate` / `pay_type` are empty today and are one-per-person, so they are not enough.
3. **Unit quantities.** Come from existing `work_logs` grouped by employee × work type × location for the week, mapped into the matching pay line. We need a mapping from WashTrack work type + location to the payroll task label / pay code.
4. **Hours + OT.** Weekly CSV/XLSX upload from your outside timekeeping system into an import table (employee, hours, OT hours, optional department/task), with column mapping and employee matching.
5. **Pay periods.** One record per Mon–Sun week with check date, status draft / locked / paid.
6. **Run lines.** Each employee normally has several lines a week — one per pay code and department/task — each with its own rate, quantity, and gross, plus an employee weekly subtotal for review. Stored so a locked week is reproducible.

## Build sequence

1. **Schema + catalogs.** `payroll_pay_codes`, `payroll_employee_lines` (roster with rate + effective date + Future Systems number), `payroll_periods`, `payroll_hours_imports`, `payroll_run_lines`, plus a work-type-to-pay-code mapping table. Finance+ only via RLS.
2. **Roster admin.** Payroll > Pay Lines: manage each employee's recurring lines (code, department, task label, rate, type) — this is what makes the export rows appear in the right order with the right labels.
3. **Hours import.** Payroll > Import Hours: upload CSV/XLSX, map columns, preview, match employees, commit to the selected week. Re-uploading replaces the prior import.
4. **Run builder.** Payroll > Pay Periods: pick a week and check date, generate. Units pull from `work_logs`; hours and OT from the import; salary lines carry their fixed amount. Editable quantities, a notes field feeding column A, then Lock.
5. **Excel export.** Emit the workbook exactly as specced above — same header block, merged title rows, header row 7, live `K` formulas, total row, currency/accounting formats, Arial 14 headers, and column widths — with an on-screen review table first.
6. **Optional follow-on.** Labor cost per location/client alongside invoicing revenue for margin analysis.

## Technical notes

- Units read from the same `work_logs` rows invoicing uses, so payroll and invoicing never diverge; `is_test` locations are excluded as in reports.
- Run lines snapshot rate and quantity at lock time; later rate edits never change a locked week.
- Weeks use the existing Monday–Sunday convention and `parseLocalDate()`.
- Export is written with an xlsx writer that sets explicit number formats, merges, widths, and formula strings — the existing generic `exportToExcel` helper cannot express this layout, so payroll gets its own builder.
- Payroll pages remain Finance+ gated; employees and managers never see pay rates.

## What I still need from you

- The hours CSV/Excel sample from the timekeeping system (column names as they arrive).
- Confirmation that Future Systems employee numbers (9992, 10052, …) should be stored per employee in the app, and whether contractors like `TC Engesser Enterprise LLC` are payroll rows we keep in the same roster.
- Whether rates and the recurring line roster should be keyed in through the new screen (I build it empty) or imported from a list you provide.
