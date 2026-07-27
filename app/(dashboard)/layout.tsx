import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import DailyBriefingModal from '@/components/DailyBriefingModal';
import { CompanyProvider } from '@/components/CompanyProvider';

export default function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CompanyProvider>
      <div className="erp-root">
        <Sidebar />
        <div className="erp-main">
          <Topbar />
          <main className="erp-content">{children}</main>
        </div>
        <DailyBriefingModal />
      </div>
    </CompanyProvider>
  );
}
