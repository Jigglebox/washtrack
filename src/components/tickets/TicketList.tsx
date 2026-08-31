import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Calendar, ChevronDown, FileText, ImageIcon, Loader2, MessageSquare, Send } from 'lucide-react';

interface TicketListProps {
  canSeeAll: boolean;
  ownOnly?: boolean;
  refreshKey?: number;
  onViewed?: () => void;
}
interface Ticket {
  id: string;
  ticket_number: string;
  submitted_by: string;
  client_id: string | null;
  location_id: string | null;
  work_date: string | null;
  address: string | null;
  employee_id: string | null;
  comments: string | null;
  photo_url: string | null;
  status: 'open' | 'in_progress' | 'closed';
  created_at: string;
  client?: { name: string } | null;
  location?: { name: string } | null;
}
interface LineItem { id: string; position: number; description: string }
interface Reply { id: string; user_id: string; body: string; created_at: string; user_name?: string }

function statusLabel(status: Ticket['status']) {
  return status === 'in_progress' ? 'In Progress' : status.replace('_', ' ').replace(/^./, c => c.toUpperCase());
}

export function TicketList({ canSeeAll, ownOnly = false, refreshKey = 0, onViewed }: TicketListProps) {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [lineItems, setLineItems] = useState<Record<string, LineItem[]>>({});
  const [replies, setReplies] = useState<Record<string, Reply[]>>({});
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [sendingReply, setSendingReply] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  const fetchTickets = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      let query = supabase
        .from('tickets')
        .select('*, client:clients(name), location:locations(name)')
        .order('created_at', { ascending: false })
        .limit(200);
      if (ownOnly) query = query.eq('submitted_by', user.id);
      const { data, error } = await query;
      if (error) throw error;
      const list = (data || []) as unknown as Ticket[];
      setTickets(list);

      const ids = list.map(t => t.id);
      if (ids.length === 0) {
        setLineItems({});
        setReplies({});
        return;
      }
      const [{ data: items, error: itemsError }, { data: replyRows, error: repliesError }] = await Promise.all([
        supabase.from('ticket_line_items').select('id, ticket_id, position, description').in('ticket_id', ids).order('position'),
        supabase.from('ticket_replies').select('id, ticket_id, user_id, body, created_at').in('ticket_id', ids).order('created_at'),
      ]);
      if (itemsError) throw itemsError;
      if (repliesError) throw repliesError;

      const groupedItems: Record<string, LineItem[]> = {};
      (items || []).forEach(item => { (groupedItems[item.ticket_id] ||= []).push(item); });
      setLineItems(groupedItems);
      const rawReplies = replyRows || [];
      const userIds = [...new Set(rawReplies.map(reply => reply.user_id))];
      const groupedReplies: Record<string, Reply[]> = {};
      if (userIds.length) {
        const { data: userRows } = await supabase.rpc('get_user_display_info', { user_ids: userIds });
        const nextNames = { ...names };
        (userRows || []).forEach((u: { id: string; name: string }) => { nextNames[u.id] = u.name; });
        setNames(nextNames);
      }
      rawReplies.forEach(reply => {
        (groupedReplies[reply.ticket_id] ||= []).push({ ...reply, user_name: names[reply.user_id] || 'Office Team' });
      });
      setReplies(groupedReplies);

      const photoEntries = await Promise.all(list.filter(t => t.photo_url).map(async t => {
        const { data: signed } = await supabase.storage.from('ticket-photos').createSignedUrl(t.photo_url as string, 3600);
        return [t.id, signed?.signedUrl || ''] as const;
      }));
      setPhotos(Object.fromEntries(photoEntries.filter(([, url]) => url)));
    } catch (error) {
      console.error('Error fetching tickets:', error);
      toast.error('Failed to load tickets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTickets(); }, [user?.id, ownOnly, refreshKey]);

  const markViewed = () => {
    onViewed?.();
  };

  const handleReply = async (ticketId: string) => {
    const body = drafts[ticketId]?.trim();
    if (!body || !user?.id) return;
    setSendingReply(ticketId);
    try {
      const { error } = await supabase.from('ticket_replies').insert({ ticket_id: ticketId, user_id: user.id, body });
      if (error) throw error;
      setDrafts(prev => ({ ...prev, [ticketId]: '' }));
      toast.success('Reply sent');
      fetchTickets();
    } catch (error) {
      console.error('Error replying to ticket:', error);
      toast.error('Failed to send reply');
    } finally { setSendingReply(null); }
  };

  const handleStatus = async (ticketId: string, status: Ticket['status']) => {
    setUpdatingStatus(ticketId);
    try {
      const { error } = await supabase.from('tickets').update({ status }).eq('id', ticketId);
      if (error) throw error;
      setTickets(prev => prev.map(ticket => ticket.id === ticketId ? { ...ticket, status } : ticket));
      toast.success('Ticket status updated');
    } catch (error) {
      console.error('Error updating ticket status:', error);
      toast.error('Failed to update status');
    } finally { setUpdatingStatus(null); }
  };

  if (loading) return <div className="py-10 text-center text-muted-foreground">Loading tickets…</div>;
  if (!tickets.length) return (
    <div className="rounded-lg border border-dashed py-10 text-center text-muted-foreground">
      <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
      <p>No tickets yet</p>
    </div>
  );

  return (
    <div className="space-y-2">
      {tickets.map(ticket => {
        const isOpen = expanded.has(ticket.id);
        const ticketReplies = replies[ticket.id] || [];
        return (
          <Collapsible key={ticket.id} open={isOpen} onOpenChange={open => {
            setExpanded(prev => { const next = new Set(prev); open ? next.add(ticket.id) : next.delete(ticket.id); return next; });
            if (open) markViewed();
          }}>
            <div className={`border rounded-lg ${isOpen ? 'ring-1 ring-primary/20' : ''}`}>
              <CollapsibleTrigger asChild>
                <div className="flex items-center gap-3 p-3 cursor-pointer hover:bg-accent/50 transition-colors">
                  <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                  <FileText className="h-4 w-4 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{ticket.ticket_number}</span>
                      <Badge variant={ticket.status === 'closed' ? 'secondary' : 'outline'}>{statusLabel(ticket.status)}</Badge>
                      {ticket.client?.name && <Badge variant="secondary" className="text-xs">{ticket.client.name}</Badge>}
                      {ticketReplies.length > 0 && <Badge variant="outline" className="text-xs">{ticketReplies.length} {ticketReplies.length === 1 ? 'reply' : 'replies'}</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground truncate mt-0.5">
                      {ticket.location?.name || ticket.address || 'Photo ticket'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                    <Calendar className="h-3 w-3" />
                    {format(new Date(ticket.created_at), 'MMM d, h:mm a')}
                  </div>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t px-4 py-4 space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 text-sm">
                    <div><span className="text-muted-foreground">Customer:</span> {ticket.client?.name || 'Not provided'}</div>
                    <div><span className="text-muted-foreground">Date:</span> {ticket.work_date ? format(new Date(`${ticket.work_date}T12:00:00`), 'MMM d, yyyy') : 'Not provided'}</div>
                    <div><span className="text-muted-foreground">Address:</span> {ticket.address || 'Not provided'}</div>
                    <div><span className="text-muted-foreground">Location:</span> {ticket.location?.name || 'Not provided'}</div>
                  </div>

                  {photos[ticket.id] && <img src={photos[ticket.id]} alt={`Photo for ${ticket.ticket_number}`} className="max-h-96 max-w-full rounded-lg border object-contain bg-muted" />}

                  {lineItems[ticket.id]?.length > 0 && (
                    <div>
                      <p className="text-sm font-medium mb-2">Line Items</p>
                      <ol className="list-decimal pl-5 space-y-1 text-sm">
                        {lineItems[ticket.id].map(item => <li key={item.id}>{item.description}</li>)}
                      </ol>
                    </div>
                  )}
                  {ticket.comments && <div className="rounded-lg bg-accent/30 p-3 text-sm whitespace-pre-wrap"><span className="font-medium">Comments: </span>{ticket.comments}</div>}

                  {canSeeAll && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Status:</span>
                      <Select value={ticket.status} onValueChange={value => handleStatus(ticket.id, value as Ticket['status'])} disabled={updatingStatus === ticket.id}>
                        <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">Open</SelectItem>
                          <SelectItem value="in_progress">In Progress</SelectItem>
                          <SelectItem value="closed">Closed</SelectItem>
                        </SelectContent>
                      </Select>
                      {updatingStatus === ticket.id && <Loader2 className="h-4 w-4 animate-spin" />}
                    </div>
                  )}

                  <div className="space-y-2 border-t pt-3">
                    {ticketReplies.length > 0 && ticketReplies.map(reply => (
                      <div key={reply.id} className="rounded-lg border-l-2 border-primary bg-accent/20 p-3">
                        <div className="text-xs text-muted-foreground mb-1">{reply.user_id === user?.id ? 'You' : reply.user_name || 'Office Team'} · {format(new Date(reply.created_at), 'MMM d, h:mm a')}</div>
                        <p className="text-sm whitespace-pre-wrap">{reply.body}</p>
                      </div>
                    ))}
                    <div className="flex items-end gap-2">
                      <Textarea
                        value={drafts[ticket.id] || ''}
                        onChange={e => setDrafts(prev => ({ ...prev, [ticket.id]: e.target.value }))}
                        placeholder="Reply on this ticket…"
                        rows={2}
                        className="resize-none"
                      />
                      <Button size="sm" onClick={() => handleReply(ticket.id)} disabled={!drafts[ticket.id]?.trim() || sendingReply === ticket.id}>
                        {sendingReply === ticket.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        <span className="sr-only">Send reply</span>
                      </Button>
                    </div>
                  </div>
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        );
      })}
    </div>
  );
}
