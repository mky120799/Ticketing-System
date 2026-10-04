import { useCallback, useEffect, useState } from 'react';
import { reauthenticate, signIn, signOut } from './auth';
import { getCurrentUser } from './api';
import { useSession } from './hooks/use-session';
import { useWorkspace } from './hooks/use-workspace';
import { Admin } from './components/admin';
import { AuditConsole } from './components/audit-console';
import { Dashboard } from './components/dashboard';
import { NotificationBell } from './components/notifications';
import { CreateTicket } from './components/workspace/create-ticket';
import { TicketDetail } from './components/workspace/ticket-detail';
import { TicketList } from './components/workspace/ticket-list';

type View = 'workspace' | 'dashboard' | 'admin' | 'audit';

/** The staff console shell: sign-in, role-aware navigation, and the four areas (workspace, dashboard, administration, audit). */
export function App(): JSX.Element {
  const { user, error: sessionError, stepUp, dismissStepUp } = useSession();
  const [error, setErrorState] = useState(''); const [roles, setRoles] = useState<string[]>([]); const [view, setView] = useState<View>('workspace');
  const setError = useCallback((message: string) => setErrorState(message), []);
  const rolesReady = roles.length > 0;
  const adminOnly = rolesReady && roles.every((role) => role === 'administrator'); // administrators have no case entitlements by design
  const workspace = useWorkspace(user, rolesReady && !adminOnly, setError);

  useEffect(() => { if (user) void getCurrentUser(user).then((profile) => setRoles(profile.roles)).catch((e: Error) => setError(e.message)); }, [user, setError]);
  useEffect(() => { if (adminOnly) setView('admin'); }, [adminOnly]);

  if (!user) return <main className="login"><section><p className="eyebrow">SECURE CASE MANAGEMENT</p><h1>Bank Case Platform</h1><p>Sign in using your bank-managed identity. This application never handles passwords.</p>{(error || sessionError) && <p className="error" role="alert">{error || sessionError}</p>}<button onClick={() => void signIn()}>Sign in with SSO</button></section></main>;

  const tab = (name: View, label: string) => <button className={view === name ? 'active' : ''} onClick={() => setView(name)}>{label}</button>;
  return <main>
    <header>
      <div><p className="eyebrow">BANK CASE PLATFORM</p><h1>Case workspace</h1></div>
      <div className="identity">
        {!adminOnly && <NotificationBell items={workspace.inbox.notifications} unread={workspace.inbox.unread} onOpen={(ticketId, id) => { setView('workspace'); workspace.openNotification(ticketId, id); }} onMarkAllRead={workspace.markAllRead} />}
        <span className={workspace.live ? 'live-indicator on' : 'live-indicator'} title={workspace.live ? 'Live updates connected' : 'Live updates reconnecting'}>{workspace.live ? '● Live' : '○ Offline'}</span>
        <span>{user.profile.preferred_username ?? user.profile.sub}</span>
        <button className="secondary" onClick={() => void signOut()}>Sign out</button>
      </div>
    </header>
    {stepUp && <p className="notice" role="alert">This action needs a recent sign-in. <button onClick={() => void reauthenticate()}>Sign in again</button> <button className="secondary" onClick={dismissStepUp}>Dismiss</button></p>}
    {error && <p className="error" role="alert">{error}</p>}
    <nav className="tabs">
      {!adminOnly && tab('workspace', 'Workspace')}
      {(roles.includes('supervisor') || roles.includes('auditor')) && tab('dashboard', 'Dashboard')}
      {roles.includes('auditor') && tab('audit', 'Audit')}
      {roles.includes('administrator') && tab('admin', 'Administration')}
    </nav>
    {view === 'dashboard' && <Dashboard user={user} onError={setError} />}
    {view === 'admin' && <Admin user={user} onError={setError} />}
    {view === 'audit' && <AuditConsole user={user} onError={setError} />}
    {view === 'workspace' && <div className="workspace">
      <CreateTicket user={user} onCreated={workspace.added} onError={setError} />
      <TicketList tickets={workspace.tickets} searchTerm={workspace.searchTerm} onSearchTermChange={workspace.setSearchTerm} onSearch={(event) => void workspace.search(event)} onSelect={(id) => void workspace.select(id)} hasMore={Boolean(workspace.nextCursor)} onLoadMore={workspace.loadMore} />
      <TicketDetail user={user} ticket={workspace.selected} roles={roles} onChanged={workspace.refreshSelected} onSelect={(id) => void workspace.select(id)} onStatusChanged={workspace.statusChanged} onUpdated={workspace.show} onError={setError} />
    </div>}
  </main>;
}
