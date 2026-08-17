'use client';

import { useState } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import DailyBriefingModal from './DailyBriefingModal';
import { CompanyProvider } from './CompanyProvider';

type CurrentUser = { email: string; name: string | null; role: string };

/** Holds the mobile nav open/close state — split out from layout.tsx because that's a Server
 *  Component (it resolves the signed-in identity from headers()) and can't hold useState itself.
 *  Sidebar and Topbar are siblings, not parent/child, so this state has to live one level up
 *  from both rather than in either of them directly. */
export default function DashboardChrome({ currentUser, children }: { currentUser: CurrentUser; children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <CompanyProvider>
      <div className="erp-root">
        <Sidebar mobileOpen={mobileNavOpen} onNavigate={() => setMobileNavOpen(false)} />
        {mobileNavOpen && <div className="sidebar-backdrop" onClick={() => setMobileNavOpen(false)} />}
        <div className="erp-main">
          <Topbar currentUser={currentUser} onMenuClick={() => setMobileNavOpen((open) => !open)} />
          <main className="erp-content">{children}</main>
        </div>
        <DailyBriefingModal />
      </div>
    </CompanyProvider>
  );
}
