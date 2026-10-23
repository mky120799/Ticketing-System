/**
 * The route table: which URL shows which screen.
 *
 *   /                     → sends each person to their home screen (queue, or administration)
 *   /tickets              → the ticket queue
 *   /tickets/:ticketId    → one case, full screen (shareable link)
 *   /dashboard            → supervisors and auditors
 *   /audit                → auditors
 *   /admin/:section       → administrators (routing, intake, compliance, workflows, service levels, templates, integration)
 *
 * The bigger, less-used screens are loaded on demand ("lazy") so the first page a case worker sees loads fast.
 */
import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './layout/app-layout';
import { LoginPage } from './layout/login-page';
import { useSession } from './session/session-provider';
import { homePath, type Capability } from './session/roles';
import { FullPageLoader, NoAccessPage, NotFoundPage, ProfileErrorPage } from './pages/status-pages';
import { LoadingBlock } from './components/states';
import { TicketsPage } from './features/tickets/tickets-page';
import { TicketPage } from './features/ticket/ticket-page';

const DashboardPage = lazy(() => import('./features/dashboard/dashboard-page'));
const AuditPage = lazy(() => import('./features/audit/audit-page'));
const AdminPage = lazy(() => import('./features/admin/admin-page'));

/** Renders the page only for roles with the capability; anyone else gets a polite "no access" page. */
function Require({ capability, children }: { capability: Capability; children: ReactNode }) {
  const { can } = useSession();
  return can(capability) ? <Suspense fallback={<LoadingBlock rows={6} />}>{children}</Suspense> : <NoAccessPage />;
}

export function App() {
  const { user, ready, profile, roles, error } = useSession();

  if (!ready) return <FullPageLoader />;
  if (!user) return <LoginPage />;
  if (error && !profile) return <ProfileErrorPage message={error} />;
  if (!profile) return <FullPageLoader />;

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to={homePath(roles)} replace />} />
        <Route path="tickets" element={<Require capability="readCases"><TicketsPage /></Require>} />
        <Route path="tickets/:ticketId" element={<Require capability="readCases"><TicketPage /></Require>} />
        <Route path="dashboard" element={<Require capability="viewDashboard"><DashboardPage /></Require>} />
        <Route path="audit" element={<Require capability="viewAudit"><AuditPage /></Require>} />
        <Route path="admin" element={<Navigate to="/admin/routing" replace />} />
        <Route path="admin/:section" element={<Require capability="administer"><AdminPage /></Require>} />
        <Route path="no-access" element={<NoAccessPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
