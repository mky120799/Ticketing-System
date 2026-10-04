import { useEffect, useState } from 'react';
import type { User } from 'oidc-client-ts';
import { downloadComplaintsRegister, getDashboard, getTrends, type DashboardSummary, type Trends } from '../api';

const AGING_LABELS: Record<string, string> = { under_1_day: 'Under 1 day', '1_to_3_days': '1–3 days', '3_to_7_days': '3–7 days', over_7_days: 'Over 7 days' };

/** Scoped aggregates only: counts per queue and age. Never ticket content. */
export function Dashboard({ user, onError }: { user: User; onError: (message: string) => void }): JSX.Element {
  const [data, setData] = useState<DashboardSummary | null>(null); const [trends, setTrends] = useState<Trends | null>(null); const [weeks, setWeeks] = useState(12);
  const load = () => { void getDashboard(user).then(setData).catch((e: Error) => onError(e.message)); };
  useEffect(load, [user]);
  useEffect(() => { void getTrends(user, weeks).then(setTrends).catch((e: Error) => onError(e.message)); }, [user, weeks]);
  if (!data) return <section><h2>Dashboard</h2><p>Loading…</p></section>;
  const maxAging = Math.max(1, ...data.aging.map((bucket) => bucket.count));
  const maxCause = Math.max(1, ...data.last30Days.rootCauses.map((item) => item.count)); const maxChannel = Math.max(1, ...data.last30Days.channels.map((item) => item.count)); const pctText = (value: number | null) => (value === null ? '—' : `${value}%`);
  const slaCompliance = data.totals.active ? Math.round(((data.totals.active - data.totals.overdue) / data.totals.active) * 100) : 100;
  return <section className="dashboard">
    <div className="row"><h2>Case dashboard</h2><button className="secondary" onClick={load}>Refresh</button><small>As of {new Date(data.asOf).toLocaleTimeString()}</small></div>
    <div className="tiles">
      {([['Active', data.totals.active], ['Overdue', data.totals.overdue], ['Resolved', data.totals.resolved], ['Closed', data.totals.closed], ['On-time (active)', `${slaCompliance}%`]] as const).map(([label, value]) => <div className="tile" key={label}><span>{label}</span><strong>{value}</strong></div>)}
    </div>
    <h3>Open complaints</h3>
    <div className="tiles">
      {([['Open', data.complaints.open], ['Acknowledgement overdue', data.complaints.ackOverdue], ['At risk', data.complaints.atRisk], ['Final response overdue', data.complaints.finalResponseOverdue], ['Vulnerable customers', data.complaints.vulnerable], ['With external scheme', data.complaints.withExternalDisputeScheme], ['Privacy correction requests', data.privacyRequests.open], ['Privacy requests overdue', data.privacyRequests.overdue]] as const).map(([label, value]) => <div className="tile" key={label}><span>{label}</span><strong>{value}</strong></div>)}
    </div>
    <div className="row"><button className="secondary" onClick={() => { const to = new Date().toISOString().slice(0, 10); const from = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10); void downloadComplaintsRegister(user, from, to).catch((e: Error) => onError(e.message)); }}>Export complaints register (last 90 days, CSV)</button></div>
    <h3>Last 30 days</h3>
    <div className="tiles">
      {([['Resolved', data.last30Days.resolved], ['Resolved on time', pctText(data.last30Days.resolvedOnTimePercent)], ['First response on time', pctText(data.last30Days.firstResponseOnTimePercent)], ['Avg first response', data.last30Days.avgFirstResponseMinutes === null ? '—' : `${data.last30Days.avgFirstResponseMinutes} min`], ['Escalations', data.last30Days.escalations]] as const).map(([label, value]) => <div className="tile" key={label}><span>{label}</span><strong>{value}</strong></div>)}
    </div>
    <div className="admin-grid">
      <div><h3>Root causes (resolved)</h3>{data.last30Days.rootCauses.length ? data.last30Days.rootCauses.map((item) => <div className="bar-row" key={item.cause}><span>{item.cause.replace(/_/g, ' ')}</span><div className="bar"><div style={{ width: `${(item.count / maxCause) * 100}%` }} /></div><b>{item.count}</b></div>) : <p>No resolved tickets yet.</p>}</div>
      <div><h3>Tickets by source channel</h3>{data.last30Days.channels.length ? data.last30Days.channels.map((item) => <div className="bar-row" key={item.channel}><span>{item.channel}</span><div className="bar"><div style={{ width: `${(item.count / maxChannel) * 100}%` }} /></div><b>{item.count}</b></div>) : <p>No tickets.</p>}</div>
    </div>
    <div className="row"><h3>Trends</h3><label className="inline">Weeks <select value={weeks} onChange={(event) => setWeeks(Number(event.target.value))}>{[4, 8, 12, 26, 52].map((n) => <option key={n} value={n}>{n}</option>)}</select></label></div>
    {trends ? <>
      <table><caption className="sr-only">Weekly volumes</caption><thead><tr><th>Week starting</th><th>Created</th><th>Resolved</th><th>Complaints</th><th>Escalated</th><th aria-label="Chart">Created vs resolved</th></tr></thead>
        <tbody>{trends.series.map((row) => { const max = Math.max(1, ...trends.series.map((r) => Math.max(r.created, r.resolved))); return <tr key={row.week}><td>{row.week}</td><td>{row.created}</td><td>{row.resolved}</td><td>{row.complaints}</td><td>{row.escalated}</td><td><div className="bar thin" title={`Created ${row.created}`}><div style={{ width: `${(row.created / max) * 100}%` }} /></div><div className="bar thin alt" title={`Resolved ${row.resolved}`}><div style={{ width: `${(row.resolved / max) * 100}%` }} /></div></td></tr>; })}</tbody></table>
      <div className="admin-grid">
        {([['By category', trends.byCategory], ['By branch', trends.byBranch]] as const).map(([title, rows]) => <div key={title}><h3>{title}</h3><table><thead><tr><th>Name</th><th>Created</th><th>Resolved</th></tr></thead><tbody>{rows.map((r) => <tr key={r.key}><td>{r.key}</td><td>{r.created}</td><td>{r.resolved}</td></tr>)}</tbody></table></div>)}
      </div>
    </> : <p>Loading trends…</p>}
    <h3>Workload by queue</h3>
    <table><thead><tr><th>Queue</th><th>Active</th><th>Overdue</th><th>Total</th></tr></thead><tbody>{data.queues.map((row) => <tr key={row.queue}><td>{row.queue}</td><td>{row.active}</td><td className={row.overdue ? 'bad' : ''}>{row.overdue}</td><td>{row.total}</td></tr>)}</tbody></table>
    <h3>Ageing of open tickets</h3>
    {data.aging.length ? data.aging.map((bucket) => <div className="bar-row" key={bucket.bucket}><span>{AGING_LABELS[bucket.bucket] ?? bucket.bucket}</span><div className="bar"><div style={{ width: `${(bucket.count / maxAging) * 100}%` }} /></div><b>{bucket.count}</b></div>) : <p>No open tickets.</p>}
  </section>;
}
