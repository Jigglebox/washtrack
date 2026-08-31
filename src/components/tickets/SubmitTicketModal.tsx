import { useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { UserSearchInput } from '@/components/UserSearchInput';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Camera, FileText, Plus, Trash2, Upload, X, Loader2 } from 'lucide-react';

interface ClientOption { id: string; name: string }
interface LocationOption { id: string; name: string; address: string | null; client_id: string }
interface UserOption { id: string; name: string; email: string; employee_id: string }

interface SubmitTicketModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitted?: () => void;
}

const MAX_LINE_ITEMS = 10;

export function SubmitTicketModal({ open, onOpenChange, onSubmitted }: SubmitTicketModalProps) {
  const { user, userProfile } = useAuth();
  const [mode, setMode] = useState<'photo' | 'form'>('form');
  const [submitting, setSubmitting] = useState(false);

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);

  const [clientId, setClientId] = useState<string>('');
  const [locationId, setLocationId] = useState<string>('');
  const [workDate, setWorkDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [address, setAddress] = useState('');
  const [employee, setEmployee] = useState<UserOption | null>(null);
  const [lineItems, setLineItems] = useState<string[]>(['', '', '', '', '']);
  const [comments, setComments] = useState('');

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const [{ data: cs }, { data: ls }] = await Promise.all([
        supabase.from('clients').select('id, name').eq('is_active', true).order('name'),
        supabase.from('locations').select('id, name, address, client_id').eq('is_active', true).order('name'),
      ]);
      setClients(cs || []);
      setLocations((ls as LocationOption[]) || []);
    })();
  }, [open]);

  // Default the employee field to the submitting manager
  useEffect(() => {
    if (open && !employee && user?.id && userProfile) {
      setEmployee({
        id: user.id,
        name: (userProfile as any).name || '',
        email: (userProfile as any).email || '',
        employee_id: (userProfile as any).employee_id || '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user?.id, userProfile]);

  const filteredLocations = clientId ? locations.filter(l => l.client_id === clientId) : locations;

  const handleLocationChange = (id: string) => {
    setLocationId(id);
    const loc = locations.find(l => l.id === id);
    if (loc) {
      if (loc.address) setAddress(loc.address);
      if (!clientId) setClientId(loc.client_id);
    }
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error('Image must be smaller than 20MB');
      return;
    }
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const reset = () => {
    setMode('form');
    setClientId('');
    setLocationId('');
    setWorkDate(format(new Date(), 'yyyy-MM-dd'));
    setAddress('');
    setEmployee(null);
    setLineItems(['', '', '', '', '']);
    setComments('');
    setPhotoFile(null);
    setPhotoPreview(null);
  };

  const handleSubmit = async () => {
    if (!user?.id) return;

    if (mode === 'photo' && !photoFile) {
      toast.error('Take or upload a photo first');
      return;
    }
    if (mode === 'form') {
      const hasLine = lineItems.some(li => li.trim());
      if (!hasLine && !comments.trim()) {
        toast.error('Add at least one line item or a comment');
        return;
      }
    }

    setSubmitting(true);
    try {
      let photoUrl: string | null = null;
      if (photoFile) {
        const ext = photoFile.name.split('.').pop() || 'jpg';
        const path = `${user.id}/${Date.now()}-ticket.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('ticket-photos')
          .upload(path, photoFile, { contentType: photoFile.type });
        if (upErr) throw upErr;
        photoUrl = path;
      }

      const payload =
        mode === 'photo'
          ? {
              submitted_by: user.id,
              photo_url: photoUrl,
            }
          : {
              submitted_by: user.id,
              client_id: clientId || null,
              location_id: locationId || null,
              work_date: workDate || null,
              address: address.trim() || null,
              employee_id: employee?.id || null,
              comments: comments.trim() || null,
              photo_url: photoUrl,
            };

      const { data: ticket, error } = await supabase
        .from('tickets')
        .insert(payload)
        .select('id, ticket_number')
        .single();
      if (error) throw error;

      if (mode === 'form') {
        const rows = lineItems
          .map((description, idx) => ({ ticket_id: ticket.id, position: idx + 1, description: description.trim() }))
          .filter(r => r.description);
        if (rows.length > 0) {
          const { error: liErr } = await supabase.from('ticket_line_items').insert(rows);
          if (liErr) throw liErr;
        }
      }

      toast.success(`Ticket ${ticket.ticket_number} submitted`);
      reset();
      onOpenChange(false);
      onSubmitted?.();
    } catch (e: any) {
      console.error('Ticket submit failed:', e);
      toast.error(e.message || 'Failed to submit ticket');
    } finally {
      setSubmitting(false);
    }
  };

  const photoBlock = (
    <div className="space-y-3">
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={e => handleFile(e.target.files?.[0])}
      />
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => handleFile(e.target.files?.[0])}
      />
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1 gap-2" onClick={() => cameraInputRef.current?.click()}>
          <Camera className="h-4 w-4" /> Take Photo
        </Button>
        <Button type="button" variant="outline" className="flex-1 gap-2" onClick={() => uploadInputRef.current?.click()}>
          <Upload className="h-4 w-4" /> Upload Photo
        </Button>
      </div>
      {photoPreview && (
        <div className="relative rounded-lg border overflow-hidden">
          <img src={photoPreview} alt="Ticket photo preview" className="w-full max-h-72 object-contain bg-muted" />
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="absolute top-2 right-2 h-7 w-7"
            onClick={() => { setPhotoFile(null); setPhotoPreview(null); }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={o => { if (!submitting) onOpenChange(o); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Submit Ticket</DialogTitle>
          <DialogDescription>
            Tickets are separate from weekly work entries. A ticket number is generated automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1 border rounded-md p-1 w-fit">
          <Button
            type="button"
            size="sm"
            variant={mode === 'form' ? 'default' : 'ghost'}
            className="h-7"
            onClick={() => setMode('form')}
          >
            <FileText className="h-3.5 w-3.5 mr-1" /> Fill Out Form
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === 'photo' ? 'default' : 'ghost'}
            className="h-7"
            onClick={() => setMode('photo')}
          >
            <Camera className="h-3.5 w-3.5 mr-1" /> Photo Only
          </Button>
        </div>

        {mode === 'photo' ? (
          <div className="space-y-3 py-2">{photoBlock}</div>
        ) : (
          <div className="space-y-4 py-2">
            {photoBlock}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Customer</Label>
                <Select value={clientId} onValueChange={v => { setClientId(v); setLocationId(''); }}>
                  <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                  <SelectContent>
                    {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={workDate} onChange={e => setWorkDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Location</Label>
                <Select value={locationId} onValueChange={handleLocationChange}>
                  <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                  <SelectContent>
                    {filteredLocations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Address</Label>
                <Input value={address} onChange={e => setAddress(e.target.value)} placeholder="Job site address" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Employee</Label>
              <UserSearchInput
                selectedUser={employee}
                onUserSelect={setEmployee}
                placeholder="Search for employee..."
              />
            </div>

            <div className="space-y-2">
              <Label>Line Items</Label>
              {lineItems.map((li, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-5 shrink-0">{idx + 1}.</span>
                  <Input
                    value={li}
                    onChange={e =>
                      setLineItems(prev => prev.map((v, i) => (i === idx ? e.target.value : v)))
                    }
                    placeholder={`Line item ${idx + 1}`}
                  />
                  {lineItems.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => setLineItems(prev => prev.filter((_, i) => i !== idx))}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              ))}
              {lineItems.length < MAX_LINE_ITEMS && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setLineItems(prev => [...prev, ''])}
                >
                  <Plus className="h-3.5 w-3.5" /> Add Line Item
                </Button>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Comments</Label>
              <Textarea
                value={comments}
                onChange={e => setComments(e.target.value)}
                placeholder="Additional details…"
                className="min-h-[90px] resize-none"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {submitting ? 'Submitting…' : 'Submit Ticket'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
