import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives/tabs';
import ContentWorkspace from '@/features/customer-content/ContentWorkspace';
import NotificationWorkspace from '@/features/customer-content/NotificationWorkspace';
import ReportsWorkspace from '@/features/reporting/ReportsWorkspace';
import PrivacyWorkspace from './PrivacyWorkspace';
import RiskWorkspace from './RiskWorkspace';

export default function OversightWorkspace({ staffId }) {
  return (
    <section className="min-w-0 space-y-4">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Reports and compliance</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Review platform activity, publish customer information, and manage privacy and risk cases.</p>
      </header>
      <Tabs defaultValue="reports" activationMode="manual" className="gap-4">
        <TabsList aria-label="Reports and compliance" className="w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto">
          <TabsTrigger className="min-h-9" value="reports">Reports</TabsTrigger>
          <TabsTrigger className="min-h-9" value="content">Content</TabsTrigger>
          <TabsTrigger className="min-h-9" value="notifications">Notifications</TabsTrigger>
          <TabsTrigger className="min-h-9" value="privacy">Privacy</TabsTrigger>
          <TabsTrigger className="min-h-9" value="risk">Risk review</TabsTrigger>
        </TabsList>
        <TabsContent value="reports"><ReportsWorkspace scopes={['admin']} /></TabsContent>
        <TabsContent value="content"><ContentWorkspace staffId={staffId} /></TabsContent>
        <TabsContent value="notifications"><NotificationWorkspace staffId={staffId} /></TabsContent>
        <TabsContent value="privacy"><PrivacyWorkspace staffId={staffId} /></TabsContent>
        <TabsContent value="risk"><RiskWorkspace staffId={staffId} /></TabsContent>
      </Tabs>
    </section>
  );
}
