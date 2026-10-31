import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './lib/api';

const REPORT_STATUSES = ['open', 'reviewing', 'resolved', 'dismissed'];
const ACTION_LABELS = {
  'user.warn': 'Warning issued',
  'user.suspend': 'Account suspended',
  'user.reinstate': 'Account reinstated',
  'report.status': 'Report updated',
  'ride.delete': 'Ride removed',
};

function Stat({ label, value, tone = '' }) {
  return <div className={`admin-stat ${tone}`}><span className="eyebrow">{label}</span><strong>{value}</strong></div>;
}

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function statusLabel(status) {
  return String(status || '').replaceAll('_', ' ');
}

function initials(name) {
  return String(name || '??').split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
}

function Notice({ error, onClose }) {
  if (!error) return null;
  return <div className="admin-error"><strong>{error}</strong><button onClick={onClose}>×</button></div>;
}

function CaseModal({ report, onClose, onOpenUser, onChanged }) {
  const [status, setStatus] = useState(report.status);
  const [note, setNote] = useState(report.resolution || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async (nextStatus) => {
    if ((nextStatus === 'resolved' || nextStatus === 'dismissed') && !note.trim()) {
      setError('Add a decision note before closing this case.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.admin.updateReport(report.id, nextStatus, note.trim());
      await onChanged();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return <div className="admin-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <section className="admin-modal" role="dialog" aria-modal="true">
      <div className="admin-modal-head">
        <div><span className="eyebrow">CASE REVIEW</span><h2>{statusLabel(report.category)}</h2><p>Reported {formatDate(report.created_at)}</p></div>
        <button className="text-button" onClick={onClose}>Close</button>
      </div>

      {error && <div className="admin-inline-error">{error}</div>}

      <div className="admin-case-grid">
        <div><span className="admin-label">REPORTED BY</span><button className="admin-person-link" onClick={() => onOpenUser(report.reporter?.id)}>{report.reporter?.name || 'Unknown member'}</button></div>
        <div><span className="admin-label">REPORTED USER</span>{report.subject?.id ? <button className="admin-person-link" onClick={() => onOpenUser(report.subject.id)}>{report.subject.name}</button> : <strong>Trip-level issue</strong>}</div>
        <div><span className="admin-label">STATUS</span><span className={`admin-status admin-status--${report.status}`}>{statusLabel(report.status)}</span></div>
        <div><span className="admin-label">TRIP</span><strong>{report.ride ? `${report.ride.pickup} → ${report.ride.dropoff}` : 'Trip no longer available'}</strong></div>
      </div>

      <div className="admin-case-detail"><span className="admin-label">WHAT HAPPENED</span><p>{report.details || 'No details were provided.'}</p></div>

      <div className="admin-case-actions">
        <div><span className="admin-label">ADMIN DECISION</span><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">Open</option><option value="reviewing">Reviewing</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select></div>
        <div className="admin-case-note"><span className="admin-label">DECISION / INVESTIGATION NOTE</span><textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={4} placeholder="Explain what you found and what action was taken." /></div>
      </div>

      <div className="admin-action-row">
        <button className="secondary-button" disabled={busy} onClick={() => save('reviewing')}>Start review</button>
        <button className="secondary-button" disabled={busy} onClick={() => save('dismissed')}>Dismiss</button>
        <button className="primary-button" disabled={busy} onClick={() => save('resolved')}>{busy ? 'Saving…' : 'Resolve case'}</button>
      </div>
    </section>
  </div>;
}

function UserModal({ userId, onClose, onChanged, onOpenCase }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState('');

  const load = useCallback(async () => {
    try { setData(await api.admin.user(userId)); setError(''); }
    catch (err) { setError(err.message); }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const act = async (type) => {
    if (!reason.trim()) { setError(type === 'warn' ? 'Enter the warning reason.' : 'Enter the suspension reason.'); return; }
    setBusy(true);
    try {
      if (type === 'warn') await api.admin.warnUser(userId, reason.trim());
      else await api.admin.suspendUser(userId, reason.trim());
      setReason(''); setMode(''); await load(); await onChanged();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const reinstate = async () => {
    setBusy(true);
    try { await api.admin.reinstateUser(userId, reason.trim()); setReason(''); await load(); await onChanged(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  if (!data) return <div className="admin-modal-backdrop"><section className="admin-modal"><button className="text-button" onClick={onClose}>Close</button><p>{error || 'Loading member…'}</p></section></div>;
  const u = data.user;

  return <div className="admin-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <section className="admin-modal admin-modal--wide" role="dialog" aria-modal="true">
      <div className="admin-modal-head">
        <div><span className="eyebrow">MEMBER INVESTIGATION</span><h2>{u.name}</h2><p>{u.email || 'No email'} · {u.role}</p></div>
        <button className="text-button" onClick={onClose}>Close</button>
      </div>
      {error && <div className="admin-inline-error">{error}</div>}

      <div className="admin-user-summary">
        <div className="mini-avatar">{initials(u.name)}</div>
        <div><strong>{u.name}</strong><span>{u.email || 'No email'} · {u.phone || 'No phone'}</span></div>
        <div><span className="admin-label">RATING</span><strong>{u.rating == null ? '—' : `★ ${Number(u.rating).toFixed(1)}`}</strong><small>{u.ratingCount || 0} ratings</small></div>
        <div><span className="admin-label">REPORTS AGAINST</span><strong>{data.reportsAgainst?.length || 0}</strong><small>{u.warnings || 0} warnings</small></div>
        <div><span className="admin-label">ACCOUNT</span><span className={`admin-status ${u.suspended ? 'admin-status--open' : 'admin-status--resolved'}`}>{u.suspended ? 'suspended' : 'active'}</span></div>
      </div>

      {u.suspended && <div className="admin-warn"><strong>Suspended</strong><span>{u.suspendedReason || 'No reason recorded.'}</span></div>}

      <div className="admin-user-grid">
        <section><div className="admin-section-title"><h3>Reports against this user</h3><span>{data.reportsAgainst?.length || 0}</span></div>
          {(data.reportsAgainst || []).length ? data.reportsAgainst.map((r) => <button className="admin-history-card" key={r.id} onClick={() => onOpenCase(r)}><div><strong>{statusLabel(r.category)}</strong><span>{r.reporter?.name || 'Unknown'} · {formatDate(r.at)}</span></div><span className={`admin-status admin-status--${r.status}`}>{statusLabel(r.status)}</span></button>) : <p className="admin-empty">No reports against this member.</p>}
        </section>
        <section><div className="admin-section-title"><h3>Rides posted</h3><span>{data.rides?.length || 0}</span></div>
          {(data.rides || []).slice(0, 6).map((r) => <div className="admin-history-card" key={r.id}><div><strong>{r.pickup} → {r.dropoff}</strong><span>{r.date} {r.time} · {r.seats} seats</span></div><span className="admin-muted">{statusLabel(r.trip_status || 'scheduled')}</span></div>)}
          {!data.rides?.length && <p className="admin-empty">No rides posted.</p>}
        </section>
      </div>

      <section><div className="admin-section-title"><h3>Admin history</h3><span>{data.history?.length || 0}</span></div>
        <div className="admin-history-list">{(data.history || []).slice(0, 8).map((a) => <div key={a.id}><strong>{ACTION_LABELS[a.action] || a.action}</strong><span>{a.note || 'No note'} · {a.by} · {formatDate(a.at)}</span></div>)}</div>
      </section>

      {!u.isAdmin && <div className="admin-case-actions admin-user-actions">
        <div className="admin-action-row">
          {!u.suspended && <button className="secondary-button" disabled={busy} onClick={() => setMode('warn')}>Warn user</button>}
          {!u.suspended && <button className="danger-button" disabled={busy} onClick={() => setMode('suspend')}>Suspend user</button>}
          {u.suspended && <button className="primary-button" disabled={busy} onClick={reinstate}>Reinstate user</button>}
        </div>
        {mode && <div className="admin-case-note"><span className="admin-label">{mode === 'warn' ? 'WARNING REASON' : 'SUSPENSION REASON'}</span><textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} placeholder="Document the reason for this action." /><button className="primary-button" disabled={busy} onClick={() => act(mode)}>{busy ? 'Saving…' : mode === 'warn' ? 'Issue warning' : 'Suspend account'}</button></div>}
      </div>}
    </section>
  </div>;
}

export default function AdminDashboard({ onBack }) {
  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [reports, setReports] = useState([]);
  const [query, setQuery] = useState('');
  const [reportFilter, setReportFilter] = useState('open');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [caseReport, setCaseReport] = useState(null);
  const [userId, setUserId] = useState(null);
  const [showAllUsers, setShowAllUsers] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [nextOverview, nextReports] = await Promise.all([api.admin.overview(), api.admin.reports(reportFilter)]);
      setOverview(nextOverview); setReports(nextReports); setError('');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [reportFilter]);

  const refresh = useCallback(async () => { await load(); }, [load]);

  useEffect(() => { load(); const timer = setInterval(load, 30000); return () => clearInterval(timer); }, [load]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try { const result = await api.admin.users(query); if (!cancelled) setUsers(result); }
      catch (err) { if (!cancelled) setError(err.message); }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  const stats = overview?.stats || {};
  const urgentReports = useMemo(() => (overview?.reports || []).filter((r) => r.status === 'open'), [overview]);

  const openCase = (report) => setCaseReport(report);

  const removeRide = async (ride) => {
    const reason = window.prompt(`Why should this ride be removed?\n\n${ride.pickup} → ${ride.dropoff}`);
    if (!reason?.trim()) return;
    setBusy(`ride:${ride.id}`);
    try { await api.admin.removeRide(ride.id, reason.trim()); await load(); }
    catch (err) { setError(err.message); }
    finally { setBusy(null); }
  };

  if (loading && !overview) return <section className="admin-page"><div className="admin-loading">Loading operations dashboard…</div></section>;

  return <section className="admin-page">
    <div className="admin-header">
      <div><span className="eyebrow">CAMPUSHOP OPERATIONS</span><h1>Admin dashboard.</h1><p>Investigate reports, take action on members and remove unsafe rides — with every decision recorded.</p></div>
      <button className="secondary-button admin-back" onClick={onBack}>← Back to CampusHop</button>
    </div>
    <Notice error={error} onClose={() => setError('')} />

    <div className="admin-stats">
      <Stat label="Total members" value={stats.users ?? '—'} />
      <Stat label="Active rides" value={stats.activeRides ?? '—'} tone="sage" />
      <Stat label="Pending requests" value={stats.pendingRequests ?? '—'} tone="butter" />
      <Stat label="Open safety reports" value={stats.openReports ?? '—'} tone="coral" />
      <Stat label="Trips live now" value={stats.liveTrips ?? '—'} tone="lavender" />
    </div>

    <div className="admin-grid admin-grid--top">
      <section className="admin-panel admin-alert-panel">
        <div className="admin-panel-heading"><div><span className="eyebrow">ACTION REQUIRED</span><h2>Safety queue</h2></div><span className="admin-count">{urgentReports.length}</span></div>
        {urgentReports.length === 0 ? <div className="admin-empty">No open safety reports right now.</div> : urgentReports.slice(0, 5).map((report) => <div className="admin-alert" key={report.id}><div><strong>{statusLabel(report.category)}</strong><span>{report.subject?.name || 'Trip-level issue'} · {formatDate(report.created_at)}</span></div><button className="admin-small-button" onClick={() => openCase(report)}>Review case</button></div>)}
      </section>
      <section className="admin-panel">
        <div className="admin-panel-heading"><div><span className="eyebrow">NETWORK PULSE</span><h2>Demand vs supply</h2></div></div>
        <div className="admin-bars"><div><span>Posted rides</span><strong>{stats.activeRides ?? 0}</strong></div><div><span>Waiting for a driver</span><strong>{stats.pendingRequests ?? 0}</strong></div><div><span>Accepted trips</span><strong>{stats.acceptedRequests ?? 0}</strong></div></div>
        <p className="admin-note">Normal ride matching remains automatic. Admin intervention is reserved for safety, disputes and policy violations.</p>
      </section>
    </div>

    <section className="admin-panel">
      <div className="admin-panel-heading admin-panel-heading--wrap"><div><span className="eyebrow">MODERATION</span><h2>Safety cases</h2></div><div className="admin-filter-row">{REPORT_STATUSES.map((status) => <button key={status} className={reportFilter === status ? 'admin-filter active' : 'admin-filter'} onClick={() => setReportFilter(status)}>{statusLabel(status)}</button>)}</div></div>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Issue</th><th>Reported by</th><th>About</th><th>When</th><th>Status</th><th>Action</th></tr></thead><tbody>
        {reports.length === 0 ? <tr><td colSpan="6" className="admin-empty">No cases in this queue.</td></tr> : reports.map((report) => <tr key={report.id}>
          <td><strong>{statusLabel(report.category)}</strong><small>{report.details || 'No details provided'}</small></td>
          <td><button className="admin-person-link" onClick={() => report.reporter?.id && setUserId(report.reporter.id)}>{report.reporter?.name || 'Unknown'}</button></td>
          <td>{report.subject?.id ? <button className="admin-person-link" onClick={() => setUserId(report.subject.id)}>{report.subject.name}</button> : 'Trip-level report'}</td>
          <td>{formatDate(report.created_at)}</td>
          <td><span className={`admin-status admin-status--${report.status}`}>{statusLabel(report.status)}</span></td>
          <td><button className="admin-small-button" disabled={busy === report.id} onClick={() => openCase(report)}>Open case</button></td>
        </tr>)}
      </tbody></table></div>
    </section>

    <div className="admin-grid">
      <section className="admin-panel">
        <div className="admin-panel-heading"><div><span className="eyebrow">MEMBERS</span><h2>Members requiring attention</h2></div><input className="admin-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or email" /></div>
        <div className="admin-member-list">
          {(users.filter((m) => m.suspended_at || m.reportsAgainst > 0).length ? users.filter((m) => m.suspended_at || m.reportsAgainst > 0) : users).slice(0, showAllUsers ? 20 : 8).map((member) => <button className="admin-member admin-member-button" key={member.id} onClick={() => setUserId(member.id)}>
            <div className="mini-avatar">{initials(member.name)}</div><div><strong>{member.name}</strong><span>{member.email || 'No email'} · {member.role}</span></div><div className="admin-member-metrics"><span>{member.reportsAgainst || 0} reports</span><span>{member.suspended_at ? 'SUSPENDED' : member.rating ? `★ ${Number(member.rating).toFixed(1)}` : 'No rating'}</span></div>
          </button>)}
          {!users.length && <div className="admin-empty">No members found.</div>}
        </div>
        {users.length > 8 && <button className="text-button" onClick={() => setShowAllUsers((v) => !v)}>{showAllUsers ? 'Show fewer' : 'Show more members'}</button>}
      </section>

      <section className="admin-panel">
        <div className="admin-panel-heading"><div><span className="eyebrow">TRIP CONTROL</span><h2>Recent rides</h2></div><span className="admin-count">{overview?.rides?.length || 0}</span></div>
        <div className="admin-ride-list">{(overview?.rides || []).slice(0, 6).map((ride) => <div className="admin-ride" key={ride.id}><div><strong>{ride.pickup}</strong><span>→ {ride.dropoff}</span><small>{ride.driver?.name || ride.driver_name} · {ride.date} {ride.time}</small></div><div className="admin-ride-actions"><span className={`admin-status admin-status--${ride.trip_status || 'scheduled'}`}>{statusLabel(ride.trip_status || 'scheduled')}</span><button className="admin-danger" disabled={busy === `ride:${ride.id}`} onClick={() => removeRide(ride)}>Remove</button></div></div>)}</div>
      </section>
    </div>

    <section className="admin-panel admin-system-panel"><div><span className="eyebrow">ADMIN WORKFLOW</span><h2>What the administrator can solve</h2></div><div className="admin-capabilities"><span>Unsafe driving</span><span>No-shows</span><span>Wrong vehicle</span><span>Harassment</span><span>Payment disputes</span><span>Fake/spam rides</span><span>Repeat offenders</span><span>Warnings</span><span>Suspensions</span><span>Reinstatements</span></div></section>

    {caseReport && <CaseModal report={caseReport} onClose={() => setCaseReport(null)} onOpenUser={(id) => { setCaseReport(null); if (id) setUserId(id); }} onChanged={refresh} />}
    {userId && <UserModal userId={userId} onClose={() => setUserId(null)} onChanged={refresh} onOpenCase={(r) => { setUserId(null); setCaseReport(r); }} />}
  </section>;
}
