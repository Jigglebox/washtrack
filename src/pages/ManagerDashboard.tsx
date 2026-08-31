import { useState } from 'react';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileText, Plus } from 'lucide-react';
import { SubmitTicketModal } from '@/components/tickets/SubmitTicketModal';
import { TicketList } from '@/components/tickets/TicketList';

export default function ManagerDashboard() {
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Manager Dashboard</h1>
            <p className="text-muted-foreground mt-2">Submit and track tickets outside weekly work.</p>
          </div>
          <Button onClick={() => setShowTicketModal(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Submit Ticket
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> My Tickets</CardTitle>
            <CardDescription>Tickets you have submitted</CardDescription>
          </CardHeader>
          <CardContent>
            <TicketList canSeeAll={false} ownOnly refreshKey={refreshKey} />
          </CardContent>
        </Card>
      </div>
      <SubmitTicketModal
        open={showTicketModal}
        onOpenChange={setShowTicketModal}
        onSubmitted={() => setRefreshKey(value => value + 1)}
      />
    </Layout>
  );
}
