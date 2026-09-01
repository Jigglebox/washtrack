import ExcelJS from 'exceljs';
import { format } from 'date-fns';
import { parseLocalDate } from '@/lib/cutoff';

export interface PayrollExportLine {
  notes?: string | null;
  code: string;
  department: string;
  task_label: string;
  display_name: string;
  provider_employee_number?: string | null;
  rate: number;
  quantity: number;
  ot_hours: number;
  pay_type: string;
}

const CURRENCY_FORMAT = '"$"#,##0.00_);[Red]\\("$"#,##0.00\\)';
const ACCOUNTING_FORMAT = '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)';
const HEADER_FONT = { name: 'Arial', size: 14, bold: true };
const BODY_FONT = { name: 'Arial', size: 11 };

const supportsOvertime = (payType: string) => payType.trim().toLowerCase() === 'hourly';

/**
 * Builds the ES&D Payroll Worksheet workbook, matching the Future Systems
 * template cell-for-cell: merged title block, header row 7, live gross-pay
 * formulas, accounting/currency formats, and a merged total row.
 */
export async function buildPayrollWorkbook(
  lines: PayrollExportLine[],
  periodStart: string,
  periodEnd: string,
  checkDate: string | null
): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Payroll');

  sheet.columns = [
    { key: 'a', width: 6.66 },
    { key: 'b', width: 8.33 },
    { key: 'c', width: 18.66 },
    { key: 'd', width: 34.44 },
    { key: 'e', width: 36.55 },
    { key: 'f', width: 8.43 },
    { key: 'g', width: 12 },
    { key: 'h', width: 8.43 },
    { key: 'i', width: 8.43 },
    { key: 'j', width: 10 },
    { key: 'k', width: 15.66 },
  ];

  sheet.mergeCells('A1:K1');
  sheet.getCell('A1').value = 'ES&D Services, Inc.';
  sheet.getCell('A1').font = { name: 'Arial', size: 14, bold: true };

  sheet.mergeCells('A2:K2');
  sheet.getCell('A2').value = 'Payroll Worksheet';
  sheet.getCell('A2').font = { name: 'Arial', size: 14, bold: true };

  sheet.mergeCells('A3:K3');

  sheet.getCell('C4').value = 'Pay Period:';
  sheet.getCell('C4').font = BODY_FONT;
  sheet.mergeCells('E4:F4');
  sheet.getCell('E4').value = `${format(parseLocalDate(periodStart), 'M/d/yyyy')}-${format(
    parseLocalDate(periodEnd),
    'M/d/yyyy'
  )}`;
  sheet.getCell('E4').font = BODY_FONT;

  sheet.getCell('C5').value = 'Check Date:';
  sheet.getCell('C5').font = BODY_FONT;
  sheet.mergeCells('E5:F5');
  if (checkDate) {
    sheet.getCell('E5').value = parseLocalDate(checkDate);
    sheet.getCell('E5').numFmt = 'm/d/yyyy';
  }
  sheet.getCell('E5').font = BODY_FONT;

  const headers = [
    'Notes',
    'Code',
    'Department',
    '',
    'Name',
    'Employee Number',
    'Rate',
    'Hrs or Units',
    ' E02  OT Hours',
    'Type',
    'Total Gross Pay',
  ];
  headers.forEach((header, index) => {
    const cell = sheet.getRow(7).getCell(index + 1);
    cell.value = header;
    cell.font = HEADER_FONT;
  });

  const firstDataRow = 8;
  lines.forEach((line, index) => {
    const rowNumber = firstDataRow + index;
    const row = sheet.getRow(rowNumber);
    row.getCell(1).value = line.notes || null;
    row.getCell(2).value = line.code;
    row.getCell(3).value = line.department;
    row.getCell(4).value = line.task_label;
    row.getCell(5).value = line.display_name;
    const providerNumber = line.provider_employee_number;
    row.getCell(6).value =
      providerNumber && /^\d+$/.test(providerNumber) ? Number(providerNumber) : providerNumber || null;
    row.getCell(7).value = Number(line.rate) || 0;
    row.getCell(7).numFmt = CURRENCY_FORMAT;
    row.getCell(8).value = Number(line.quantity) || 0;
    row.getCell(8).numFmt = ACCOUNTING_FORMAT;
    if (supportsOvertime(line.pay_type)) {
      row.getCell(9).value = Number(line.ot_hours) || 0;
      row.getCell(9).numFmt = ACCOUNTING_FORMAT;
    }
    row.getCell(10).value = line.pay_type;
    row.getCell(11).value = {
      formula: supportsOvertime(line.pay_type)
        ? `(G${rowNumber}*H${rowNumber})+(I${rowNumber}*(G${rowNumber}*1.5))`
        : `(G${rowNumber}*H${rowNumber})`,
    };
    row.getCell(11).numFmt = ACCOUNTING_FORMAT;
    for (let col = 1; col <= 11; col++) {
      if (!row.getCell(col).font) row.getCell(col).font = BODY_FONT;
    }
  });

  const lastDataRow = firstDataRow + Math.max(lines.length, 1) - 1;
  const totalRow = lastDataRow + 1;
  sheet.mergeCells(`A${totalRow}:I${totalRow}`);
  sheet.getCell(`J${totalRow}`).value = 'Total ';
  sheet.getCell(`J${totalRow}`).font = { name: 'Arial', size: 11, bold: true };
  const totalCell = sheet.getCell(`K${totalRow}`);
  totalCell.value = { formula: `SUM(K${firstDataRow}:K${lastDataRow})` };
  totalCell.numFmt = ACCOUNTING_FORMAT;
  totalCell.font = { name: 'Arial', size: 11, bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function downloadPayrollWorkbook(blob: Blob, periodEnd: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `payroll-worksheet-${periodEnd}.xlsx`;
  link.click();
  URL.revokeObjectURL(link.href);
}
