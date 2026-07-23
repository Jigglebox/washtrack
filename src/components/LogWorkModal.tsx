import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { getCurrentCutoff } from '@/lib/cutoff';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { CalendarIcon, Loader2, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkItemWithDetails } from '@/components/WorkItemGrid';
// [mobile-port] Capture job-site location when logging work (native app only).
import { useGeolocation } from '@/hooks/useGeolocation';
import { IS_MOBILE } from '@/lib/appTarget';
import { checkJobSiteProximity, JOB_SITE_RADIUS_MILES, type LatLng } from '@/lib/geofence';

export interface RateConfigWithDetails {
  id: string;
  rate: number | null;
  frequency: string | null;
  work_type: {
    id: string;
    name: string;
    rate_type: string;
  };
}

interface LogWorkModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workItem?: WorkItemWithDetails;
  rateConfig?: RateConfigWithDetails;
  onSuccess: () => void;
  /** Facility coordinates, if known. When present, logging is gated to within JOB_SITE_RADIUS_MILES.
   *  Currently the locations table has no coordinates, so callers pass nothing and the gate is skipped. */
  facilityCoords?: LatLng | null;
}

export function LogWorkModal({ open, onOpenChange, workItem, rateConfig, onSuccess, facilityCoords }: LogWorkModalProps) {
  const { user } = useAuth();
  const [date, setDate] = useState<Date>(new Date());
  const [quantity, setQuantity] = useState('1');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cutoffDate, setCutoffDate] = useState<Date | null>(null);
  const { coords, loading: geoLoading, error: geoError, getCurrentPosition } = useGeolocation();

  const isHourly = rateConfig !== undefined;
  const config = workItem?.rate_config || rateConfig;
  const quantityLabel = 'Quantity';
  const submitLabel = 'Log Work';

  useEffect(() => {
    getCurrentCutoff().then(setCutoffDate);
  }, []);

  useEffect(() => {
    if (open) {
      setDate(new Date());
      setQuantity('1');
      setNotes('');
      // On the native app, capture the employee's location to record the job site.
      if (IS_MOBILE) {
        getCurrentPosition();
      }
    }
  }, [open, isHourly]);

  const handleSubmit = async () => {
    if (!user || !config) return;

    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
      toast.error('Please enter a valid quantity');
      return;
    }

    // Job-site proximity gate (native app). Skipped automatically until facilities have coordinates.
    const proximity = checkJobSiteProximity(coords, facilityCoords);
    if (!proximity.skipped && !proximity.withinRange) {
      toast.error(
        `You're about ${Math.round(proximity.distanceMiles!)} mi from this facility — you must be within ${JOB_SITE_RADIUS_MILES} mi to log work here.`,
      );
      return;
    }

    setSubmitting(true);
    try {
      // Fold the captured job-site location into the notes (native app only).
      const locationTag = coords
        ? `📍 ${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)} (±${Math.round(coords.accuracy)}m)`
        : '';
      const finalNotes = [notes.trim(), locationTag].filter(Boolean).join('\n') || null;

      const insertData = {
        work_item_id: workItem?.id || null,
        rate_config_id: workItem ? null : rateConfig?.id || null,
        employee_id: user.id,
        work_date: format(date, 'yyyy-MM-dd'),
        quantity: qty,
        notes: finalNotes,
      };

      const { error } = await supabase.from('work_logs').insert(insertData);

      if (error) throw error;

      toast.success('Work logged successfully');
      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error logging work:', error);
      toast.error(error.message || 'Failed to log work');
    } finally {
      setSubmitting(false);
    }
  };

  const isDateDisabled = (checkDate: Date) => {
    if (cutoffDate && checkDate > cutoffDate) return true;
    if (checkDate > new Date()) return true;
    return false;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {submitLabel}
            {workItem && (
              <Badge variant="outline" className="font-mono">
                {workItem.identifier}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Info display */}
          <div className="flex flex-wrap gap-2">
            <Badge>{config?.work_type.name}</Badge>
            {config?.frequency && (
              <Badge variant="secondary">{config.frequency}</Badge>
            )}
          </div>

          {/* Date picker */}
          <div className="space-y-2">
            <Label>Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'w-full justify-start text-left font-normal',
                    !date && 'text-muted-foreground'
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, 'PPP') : 'Pick a date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(d) => d && setDate(d)}
                  disabled={isDateDisabled}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Quantity/Hours input */}
          <div className="space-y-2">
            <Label>{quantityLabel}</Label>
            <Input
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ''))}
              placeholder="Enter quantity"
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes..."
              rows={2}
            />
          </div>

          {/* Job-site location — native app only */}
          {IS_MOBILE && (
            <div className="space-y-1">
              <Label>Job-site location</Label>
              <div className="flex items-center gap-2 rounded-md border p-2 text-sm">
                <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                {geoLoading ? (
                  <span className="text-muted-foreground">Getting your location…</span>
                ) : coords ? (
                  <span>
                    {coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)}{' '}
                    <span className="text-muted-foreground">(±{Math.round(coords.accuracy)}m)</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">{geoError || 'Not captured'}</span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-7"
                  onClick={() => getCurrentPosition()}
                  disabled={geoLoading}
                >
                  {coords ? 'Update' : 'Capture'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Recorded with your entry to confirm you were on site.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
