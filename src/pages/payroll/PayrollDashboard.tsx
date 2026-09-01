import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, format, startOfWeek } from 'date-fns';
import { CalendarRange, Download, Loader2, Plus, RefreshCw, Upload, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { buildPayrollWorkbook, downloadPayrollWorkbook, PayrollExportLine } from '@/lib/payrollExport';

type PayCode = { id: string; code: string; department: string; default_pay_type: string };
type Employee = { id: string; name: string; employee_id: string };
type PayLine = {
  id: string;
  employee_id: string | null;
  display_name: string;
  provider_employee_number: string | null;
  pay_code_id: string;
  department: string;
  task_label: string;
  rate: number;
  pay_type: string;
  effective_date: string;
  is_active: boolean;
  sort_order: number;
  pay_code?: PayCode;
};
type Period = { id: string; period_start: string; period_end: string; check_date: string | null; status: string };
type RunLine = PayrollExportLine & { id: string; period_id: string };

const payTypeOptions = ['Unit', 'Hourly', 'Salary'];
const asDateInput = (date: Date) => format(date, 'yyyy-MM-dd');
const mondayOf = (date: Date) => startOfWeek(date, { weekStartsOn: 1 });
const emptyLine = { employee_id: '', pay_code_id: '', department: '', task_label: '', provider_employee_number: '', rate: '0', pay_type: 'Unit', effective_date: asDateInput(new Date()) };

const PayrollDashboard = () => {
  const [activeTab, setActiveTab] = useState<'run' | 'lines' | 'hours'>('run');
  const [periodStart, setPeriodStart] = useState(asDateInput(mondayOf(new Date())));
  const [period, setPeriod] = useState<Period | null>(null);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [runLines, setRunLines] = useState<RunLine[]>([]);
  const [payLines, setPayLines] = useState<PayLine[]>([]);
  const [payCodes, setPayCodes] = useState<PayCode[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [showPayLineForm, setShowPayLineForm] = useState(false);
  const [newLine, setNewLine] = useState(emptyLine);
  const [hoursFile, setHoursFile] = useState<File | null>(null);

  const periodEnd = useMemo(() => asDateInput(addDays(new Date(`${periodStart}T00:00:00`), 6)), [periodStart]);
  const totalGross = useMemo(() => runLines.reduce((sum, line) => sum + line.rate * line.quantity + line.ot_hours * line.rate * 1.5, 0), [runLines]);

  const loadSetup = useCallback(async () => {
    setLoading(true);
    const [codesResult, employeesResult, linesResult, periodsResult] = await Promise.all([
      supabase.from('payroll_pay_codes').select('id, code, department, default_pay_type').eq('is_active', true).order('code'),
      supabase.from('users').select('id, name, employee_id').eq('is_active', true).order('name'),
      supabase.from('payroll_employee_lines').select('*, pay_code:payroll_pay_codes(id, code, department, default_pay_type)').eq('is_active', true).order('display_name').order('sort_order'),
      supabase.from('payroll_periods').select('id, period_start, period_end, check_date, status').order('period_start', { ascending: false }).limit(20),
    ]);
    const firstError = [codesResult.error, employeesResult.error, linesResult.error, periodsResult.error].find(Boolean);
    if (firstError) toast.error('Could not load payroll setup');
    setPayCodes((codesResult.data || []) as PayCode[]);
    setEmployees((employeesResult.data || []) as Employee[]);
    setPayLines((linesResult.data || []) as PayLine[]);
    setPeriods((periodsResult.data || []) as Period[]);
    setLoading(false);
  }, []);

  const loadRun = useCallback(async (selectedPeriod: Period | null) => {
    if (!selectedPeriod) {
      setRunLines([]);
      return;
    }
    const { data, error } = await supabase.from('payroll_run_lines').select('*').eq('period_id', selectedPeriod.id).order('sort_order').order('display_name');
    if (error) toast.error('Could not load payroll run');
    setRunLines((data || []) as RunLine[]);
  }, []);

  useEffect(() => { void loadSetup(); }, [loadSetup]);
  useEffect(() => { void loadRun(period); }, [period, loadRun]);

  const selectPeriod = (selected: Period) => {
    setPeriod(selected);
    setPeriodStart(selected.period_start);
  };

  const createPeriod = async () => {
    setWorking(true);
    const { data, error } = await supabase.from('payroll_periods').upsert({ period_start: periodStart, period_end: periodEnd }, { onConflict: 'period_start' }).select().single();
    setWorking(false);
    if (error) { toast.error('Could not create pay period'); return; }
    setPeriod(data as Period);
    await loadSetup();
    toast.success('Pay period ready');
  };

  const generateRun = async () => {
    if (!period) { toast.error('Create or select a pay period first'); return; }
    setWorking(true);
    const activeLines = payLines.filter(line => line.is_active && line.effective_date <= period.period_end);
    const { data: workLogs, error: logError } = await supabase
      .from('work_logs')
      .select('employee_id, quantity, work_item:work_items(rate_config:rate_configs(work_type_id, location_id))')
      .gte('work_date', period.period_start).lte('work_date', period.period_end);
    if (logError) { setWorking(false); toast.error('Could not read weekly work logs'); return; }
    const quantities = new Map<string, number>();
    (workLogs || []).forEach((log: any) => {
      const workTypeId = log.work_item?.rate_config?.work_type_id;
      if (workTypeId) quantities.set(`${log.employee_id}|${workTypeId}`, (quantities.get(`${log.employee_id}|${workTypeId}`) || 0) + Number(log.quantity || 0));
    });
    const rows = activeLines.map(line => ({
      period_id: period.id,
      employee_line_id: line.id,
      employee_id: line.employee_id,
      notes: null,
      code: line.pay_code?.code || '',
      department: line.department,
      task_label: line.task_label,
      display_name: line.display_name,
      provider_employee_number: line.provider_employee_number,
      rate: line.rate,
      quantity: line.pay_type.trim().toLowerCase() === 'salary' ? 1 : (line.pay_code ? 0 : 0),
      ot_hours: 0,
      pay_type: line.pay_type,
      sort_order: line.sort_order || 0,
    }));
    const { error: deleteError } = await supabase.from('payroll_run_lines').delete().eq('period_id', period.id);
    if (deleteError) { setWorking(false); toast.error('Could not refresh payroll run'); return; }
    const { error } = rows.length ? await supabase.from('payroll_run_lines').insert(rows) : { error: null };
    setWorking(false);
    if (error) { toast.error('Could not generate payroll run'); return; }
    await loadRun(period);
    toast.success(`Generated ${rows.length} payroll lines`);
  };

  const updateRunLine = async (line: RunLine, field: 'quantity' | 'ot_hours' | 'notes', value: string) => {
    if (period?.status !== 'draft') return;
    const numeric = field === 'notes' ? undefined : Math.max(0, Number(value) || 0);
    const update = field === 'notes' ? { notes: value } : { [field]: numeric };
    const { error } = await supabase.from('payroll_run_lines').update(update).eq('id', line.id);
    if (error) toast.error('Could not save payroll line');
    else setRunLines(current => current.map(item => item.id === line.id ? { ...item, ...update } : item));
  };

  const lockPeriod = async () => {
    if (!period || runLines.length === 0) { toast.error('Generate a payroll run before locking'); return; }
    const { error } = await supabase.from('payroll_periods').update({ status: 'locked', locked_at: new Date().toISOString() }).eq('id', period.id).eq('status', 'draft');
    if (error) { toast.error('Could not lock payroll period'); return; }
    const updated = { ...period, status: 'locked' };
    setPeriod(updated);
    setPeriods(current => current.map(item => item.id === updated.id ? updated : item));
    toast.success('Payroll period locked');
  };

  const addPayLine = async () => {
    if (!newLine.employee_id || !newLine.pay_code_id || !newLine.department || !newLine.task_label) { toast.error('Complete the employee, code, department, and task'); return; }
    const employee = employees.find(item => item.id === newLine.employee_id);
    const code = payCodes.find(item => item.id === newLine.pay_code_id);
    if (!employee || !code) return;
    const { error } = await supabase.from('payroll_employee_lines').insert({
      employee_id: employee.id, display_name: employee.name, provider_employee_number: newLine.provider_employee_number || null,
      pay_code_id: code.id, department: newLine.department, task_label: newLine.task_label, rate: Number(newLine.rate) || 0,
      pay_type: newLine.pay_type, effective_date: newLine.effective_date,
    });
    if (error) { toast.error('Could not save pay line'); return; }
    setNewLine(emptyLine); setShowPayLineForm(false); await loadSetup(); toast.success('Pay line added');
  };

  const importHours = async () => {
    if (!hoursFile || !period) { toast.error('Choose a file and pay period first'); return; }
    toast.info('Hours import screen is ready for the Future Systems column mapping; upload parsing will be connected next.');
  };

  const exportWorkbook = async () => {
    if (!period || runLines.length === 0) { toast.error('Generate a payroll run before exporting'); return; }
    setWorking(true);
    const blob = await buildPayrollWorkbook(runLines, period.period_start, period.period_end, period.check_date);
    downloadPayrollWorkbook(blob, period.period_end);
    setWorking(false);
  };

  if (loading) return <Layout><div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin" /></div></Layout>;

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight"><Wallet className="h-8 w-8" /> Payroll Worksheet</h1>
            <p className="mt-1 text-muted-foreground">Build the weekly Future Systems payroll file from unit work and imported hours.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void loadSetup()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
            <Button onClick={() => void exportWorkbook()} disabled={working || !period || runLines.length === 0}><Download className="mr-2 h-4 w-4" />Export XLSX</Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-b pb-2">
          {([['run', 'Weekly Run'], ['lines', 'Pay Lines'], ['hours', 'Import Hours']] as const).map(([value, label]) => (
            <Button key={value} variant={activeTab === value ? 'default' : 'ghost'} size="sm" onClick={() => setActiveTab(value)}>{label}</Button>
          ))}
        </div>

        {activeTab === 'run' && <>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><CalendarRange className="h-5 w-5" />Pay period</CardTitle><CardDescription>Weeks run Monday through Sunday. Create a week, generate its lines, review, then lock it.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2"><Label htmlFor="periodStart">Week starting</Label><Input id="periodStart" type="date" value={periodStart} onChange={event => setPeriodStart(asDateInput(mondayOf(new Date(`${event.target.value}T00:00:00`))))} /></div>
                <div className="space-y-2"><Label>Week ending</Label><Input value={periodEnd} readOnly /></div>
                <div className="space-y-2"><Label htmlFor="checkDate">Check date</Label><Input id="checkDate" type="date" value={period?.check_date || ''} onChange={async event => { if (!period) return; const value = event.target.value || null; await supabase.from('payroll_periods').update({ check_date: value }).eq('id', period.id); setPeriod({ ...period, check_date: value }); }} /></div>
              </div>
              <div className="flex flex-wrap gap-2"><Button onClick={() => void createPeriod()} disabled={working}><Plus className="mr-2 h-4 w-4" />Create / Select Week</Button><Button variant="outline" onClick={() => void generateRun()} disabled={working || !period}><RefreshCw className="mr-2 h-4 w-4" />Generate Run</Button><Button variant="outline" onClick={() => void lockPeriod()} disabled={working || period?.status !== 'draft'}>Lock Week</Button></div>
              {periods.length > 0 && <div className="overflow-auto"><Table><TableHeader><TableRow><TableHead>Week</TableHead><TableHead>Check Date</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>{periods.map(item => <TableRow key={item.id}><TableCell>{item.period_start} – {item.period_end}</TableCell><TableCell>{item.check_date || '—'}</TableCell><TableCell className="capitalize">{item.status}</TableCell><TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => selectPeriod(item)}>Open</Button></TableCell></TableRow>)}</TableBody></Table></div>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-lg">Payroll lines {period && <span className="text-muted-foreground">· {runLines.length}</span>}</CardTitle><CardDescription>Every employee may have multiple rows — one for each code, task, or department.</CardDescription></CardHeader>
            <CardContent>
              {runLines.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Create a week and generate a run to see payroll lines.</p> : <div className="overflow-auto"><Table className="min-w-[1050px]"><TableHeader><TableRow><TableHead>Notes</TableHead><TableHead>Code</TableHead><TableHead>Department</TableHead><TableHead>Task</TableHead><TableHead>Name</TableHead><TableHead>Employee #</TableHead><TableHead>Rate</TableHead><TableHead>Hrs / Units</TableHead><TableHead>OT Hours</TableHead><TableHead>Type</TableHead><TableHead>Gross</TableHead></TableRow></TableHeader><TableBody>{runLines.map(line => <TableRow key={line.id}><TableCell><Input className="w-28" value={line.notes || ''} onChange={event => void updateRunLine(line, 'notes', event.target.value)} disabled={period?.status !== 'draft'} /></TableCell><TableCell>{line.code}</TableCell><TableCell>{line.department}</TableCell><TableCell>{line.task_label}</TableCell><TableCell>{line.display_name}</TableCell><TableCell>{line.provider_employee_number || '—'}</TableCell><TableCell>${line.rate.toFixed(2)}</TableCell><TableCell><Input className="w-24" type="number" min="0" step="0.01" value={line.quantity} onChange={event => void updateRunLine(line, 'quantity', event.target.value)} disabled={period?.status !== 'draft'} /></TableCell><TableCell><Input className="w-24" type="number" min="0" step="0.01" value={line.ot_hours} onChange={event => void updateRunLine(line, 'ot_hours', event.target.value)} disabled={period?.status !== 'draft' || line.pay_type.trim().toLowerCase() !== 'hourly'} /></TableCell><TableCell>{line.pay_type}</TableCell><TableCell>${(line.rate * line.quantity + line.ot_hours * line.rate * 1.5).toFixed(2)}</TableCell></TableRow>)}</TableBody></Table><Separator className="my-4" /><div className="flex justify-end text-lg font-semibold">Total Gross: ${totalGross.toFixed(2)}</div></div>}
            </CardContent>
          </Card>
        </>}

        {activeTab === 'lines' && <Card>
          <CardHeader><CardTitle className="flex items-center justify-between text-lg">Recurring Pay Lines <Button size="sm" onClick={() => setShowPayLineForm(value => !value)}><Plus className="mr-2 h-4 w-4" />Add Pay Line</Button></CardTitle><CardDescription>Set up the rows that should appear for each employee in the Future Systems worksheet.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {showPayLineForm && <div className="grid gap-3 rounded-md border p-4 md:grid-cols-4"><div className="space-y-1"><Label>Employee</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={newLine.employee_id} onChange={event => setNewLine({ ...newLine, employee_id: event.target.value })}><option value="">Choose employee</option>{employees.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="space-y-1"><Label>Pay code</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={newLine.pay_code_id} onChange={event => { const code = payCodes.find(item => item.id === event.target.value); setNewLine({ ...newLine, pay_code_id: event.target.value, department: code?.department || newLine.department, pay_type: code?.default_pay_type || newLine.pay_type }); }}><option value="">Choose code</option>{payCodes.map(code => <option key={code.id} value={code.id}>{code.code} · {code.department}</option>)}</select></div><div className="space-y-1"><Label>Department</Label><Input value={newLine.department} onChange={event => setNewLine({ ...newLine, department: event.target.value })} /></div><div className="space-y-1"><Label>Task / location label</Label><Input value={newLine.task_label} onChange={event => setNewLine({ ...newLine, task_label: event.target.value })} /></div><div className="space-y-1"><Label>Future Systems employee #</Label><Input value={newLine.provider_employee_number} onChange={event => setNewLine({ ...newLine, provider_employee_number: event.target.value })} /></div><div className="space-y-1"><Label>Rate</Label><Input type="number" min="0" step="0.01" value={newLine.rate} onChange={event => setNewLine({ ...newLine, rate: event.target.value })} /></div><div className="space-y-1"><Label>Type</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={newLine.pay_type} onChange={event => setNewLine({ ...newLine, pay_type: event.target.value })}>{payTypeOptions.map(option => <option key={option}>{option}</option>)}</select></div><div className="space-y-1"><Label>Effective date</Label><Input type="date" value={newLine.effective_date} onChange={event => setNewLine({ ...newLine, effective_date: event.target.value })} /></div><div className="flex items-end gap-2 md:col-span-4"><Button onClick={() => void addPayLine()}>Save Pay Line</Button><Button variant="outline" onClick={() => setShowPayLineForm(false)}>Cancel</Button></div></div>}
            <div className="overflow-auto"><Table className="min-w-[1000px]"><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Employee #</TableHead><TableHead>Code</TableHead><TableHead>Department</TableHead><TableHead>Task / Location</TableHead><TableHead>Rate</TableHead><TableHead>Type</TableHead><TableHead>Effective</TableHead></TableRow></TableHeader><TableBody>{payLines.map(line => <TableRow key={line.id}><TableCell>{line.display_name}</TableCell><TableCell>{line.provider_employee_number || '—'}</TableCell><TableCell>{line.pay_code?.code || '—'}</TableCell><TableCell>{line.department}</TableCell><TableCell>{line.task_label}</TableCell><TableCell>${line.rate.toFixed(2)}</TableCell><TableCell>{line.pay_type}</TableCell><TableCell>{line.effective_date}</TableCell></TableRow>)}</TableBody></Table></div>
          </CardContent>
        </Card>}

        {activeTab === 'hours' && <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Upload className="h-5 w-5" />Import Hours</CardTitle><CardDescription>Upload the weekly CSV or Excel file from the outside timekeeping system. The final step will map its columns into hours and overtime.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="rounded-md border border-dashed p-8 text-center"><Input type="file" accept=".csv,.xlsx,.xls" onChange={event => setHoursFile(event.target.files?.[0] || null)} /><p className="mt-2 text-sm text-muted-foreground">{hoursFile ? hoursFile.name : 'Choose a CSV or Excel file'}</p></div><Button onClick={() => void importHours()} disabled={!hoursFile || !period}><Upload className="mr-2 h-4 w-4" />Upload Hours for {period ? `${period.period_start} – ${period.period_end}` : 'selected week'}</Button><p className="text-sm text-muted-foreground">Required mapping: employee name or employee number, regular hours, and optional E02 overtime hours.</p></CardContent></Card>}
      </div>
    </Layout>
  );
};

export default PayrollDashboard;
