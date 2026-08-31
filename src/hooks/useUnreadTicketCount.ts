import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { hasRoleOrHigher } from '@/lib/roleUtils';
import { UserRole } from '@/types/database';

/**
 * Unread ticket count for office staff (finance and above).
 * Rendered as a BLUE badge, distinct from the red message badge.
 */
export function useUnreadTicketCount() {
  const { user, userRole } = useAuth();
  const [unreadTicketCount, setUnreadTicketCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const isOfficeStaff = !!userRole && hasRoleOrHigher(userRole as UserRole, 'finance' as UserRole);

  const fetchUnreadCount = async () => {
    if (!user?.id || !isOfficeStaff) {
      setUnreadTicketCount(0);
      setLoading(false);
      return;
    }

    try {
      const { data: viewData } = await supabase
        .from('ticket_views')
        .select('last_viewed_at')
        .eq('user_id', user.id)
        .maybeSingle();

      const lastViewed = viewData?.last_viewed_at || '1970-01-01T00:00:00Z';

      const { count, error } = await supabase
        .from('tickets')
        .select('*', { count: 'exact', head: true })
        .gt('created_at', lastViewed);

      if (error) throw error;
      setUnreadTicketCount(count || 0);
    } catch (error) {
      console.error('Error fetching unread ticket count:', error);
      setUnreadTicketCount(0);
    } finally {
      setLoading(false);
    }
  };

  const markTicketsAsRead = async () => {
    if (!user?.id) return;
    try {
      const { error } = await supabase
        .from('ticket_views')
        .upsert(
          { user_id: user.id, last_viewed_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        );
      if (error) throw error;
      setUnreadTicketCount(0);
    } catch (error) {
      console.error('Error marking tickets as read:', error);
    }
  };

  useEffect(() => {
    fetchUnreadCount();

    const channel = supabase
      .channel('tickets-unread-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tickets' }, () => {
        setUnreadTicketCount(prev => prev + 1);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, userRole]);

  return { unreadTicketCount, loading, markTicketsAsRead, refetch: fetchUnreadCount };
}
