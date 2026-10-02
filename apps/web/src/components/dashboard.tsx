import { useEffect, useState } from 'react';
import type { User } from 'oidc-client-ts';
import { getDashboard, type DashboardSummary } from '../api';

const AGING_LABELS: Record<string, string> = { under_1_day: 'Under 1 day', '1_to_3_days': '1–3 days', '3_to_7_days': '3–7 days', over_7_days: 'Over 7 days' };

/** Scoped aggregates only: counts per queue and age. Never ticket content. */
export function Dashboard({ user, onError }: { user: User; onError: (message: string) => void }): JSX.Element {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const load = () => { void getDashboard(user).then(setData).catch((e: Error) => onError(e.message)); };
  useEffect(load, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <section><h2>Dashboard</h2><p>Loading…</p></section>;
  const maxAging = Math.max(1, ...data.aging.map((bucket) => bucket.count));
  const slaCompliance = data.totals.active ? Math.round(((data.totals.active - data.totals.overdue) / data.totals.active) * 100) : 100;
  return <section className="dashboard">
    <div className="row"><h2>Case dashboard</h2><button className="secondary" onClick={load}>Refresh</button><small>As of {new Date(data.asOf).toLocaleTimeString()}</small></div>
    <div className="tiles">
      {([['Active', data.totals.active], ['Overdue', data.totals.overdue], ['Resolved', data.totals.resolved], ['Closed', data.totals.closed], ['On-time (active)', `${slaCompliance}%`]] as const).map(([label, value]) => <div className="tile" key={label}><span>{label}</span><strong>{value}</strong></div>)}
    </div>
    <h3>Workload by queue</h3>
    <table><thead><tr><th>Queue</th><th>Active</th><th>Overdue</th><th>Total</th></tr></thead><tbody>{data.queues.map((row) => <tr key={row.queue}><td>{row.queue}</td><td>{row.active}</td><td className={row.overdue ? 'bad' : ''}>{row.overdue}</td><td>{row.total}</td></tr>)}</tbody></table>
    <h3>Ageing of open tickets</h3>
    {data.aging.length ? data.aging.map((bucket) => <div className="bar-row" key={bucket.bucket}><span>{AGING_LABELS[bucket.bucket] ?? bucket.bucket}</span><div className="bar"><div style={{ width: `${(bucket.count / maxAging) * 100}%` }} /></div><b>{bucket.count}</b></div>) : <p>No open tickets.</p>}
  </section>;
}
