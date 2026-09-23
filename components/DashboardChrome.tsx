'use client';

import { useState, useSyncExternalStore } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { CompanyProvider } from './CompanyProvider';
import { navHiddenOnServer, readNavHidden, subscribeNavHidden, writeNavHidden } from '@/lib/nav-hidden';

type CurrentUser = { email: string; name: string | null; role: string };

const PHONE_WIDTH = '(max-width: 768px)';

/** Holds the nav open/close state — split out from layout.tsx because that's a Server
 *  Component (it resolves the signed-in identity from headers()) and can't hold useState itself.
 *  Sidebar and Topbar are siblings, not parent/child, so this state has to live one level up
 *  from both rather than in either of them directly. */
export default function DashboardChrome({ currentUser, children }: { currentUser: CurrentUser; children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Whether this browser last left the menu hidden. See lib/nav-hidden.ts for why it is read this
  // way rather than into state.
  const navHidden = useSyncExternalStore(subscribeNavHidden, readNavHidden, navHiddenOnServer);

  // One button in the top bar for both shapes of menu: on a phone it is a drawer over the page,
  // and on anything wider it is a column beside the page, which hiding gives back to the page.
  const toggleNav = () => {
    if (window.matchMedia(PHONE_WIDTH).matches) {
      setMobileNavOpen((open) => !open);
      return;
    }
    writeNavHidden(!navHidden);
  };

  return (
    <CompanyProvider>
      <div className={`erp-root ${navHidden ? 'nav-hidden' : ''}`}>
        <Sidebar mobileOpen={mobileNavOpen} onNavigate={() => setMobileNavOpen(false)} />
        {mobileNavOpen && <div className="sidebar-backdrop" onClick={() => setMobileNavOpen(false)} />}
        <div className="erp-main">
          <Topbar currentUser={currentUser} onMenuClick={toggleNav} />
          <main className="erp-content">{children}</main>
        </div>
      </div>
    </CompanyProvider>
  );
}
