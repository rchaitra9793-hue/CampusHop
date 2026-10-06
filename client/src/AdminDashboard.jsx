import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './lib/api';

const REPORT_STATUSES = ['open', 'reviewing', 'resolved', 'dismissed'];

function Stat({ label, value, tone = '' }) {
  return (
    <div className={`admin-stat ${tone}`}>
      <span className="eyebrow">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function statusLabel(status) {
  return String(status || '').replaceAll('_', ' ');
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

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [nextOverview, nextReports] = await Promise.all([
        api.admin.overview(),
        api.admin.reports(reportFilter),
      ]);
      setOverview(nextOverview);
      setReports(nextReports);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [reportFilter]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await api.admin.users(query);
        if (!cancelled) setUsers(result);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const stats = overview?.stats || {};
  const reportRows = reports;
  const urgentReports = useMemo(
    () => (overview?.reports || []).filter((r) => r.status === 'open'),
    [overview]
  );

  const updateReport = async (id, status) => {
    setBusy(id);
    try {
      await api.admin.updateReport(id, status);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const removeRide = async (ride) => {
    if (!window.confirm(`Remove this ride from the board?\n\n${ride.pickup} → ${ride.dropoff}`)) return;
    setBusy(`ride:${ride.id}`);
    try {
      await api.admin.removeRide(ride.id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  if (loading && !overview) {
    return <section className="admin-page"><div className="admin-loading">Loading operations dashboard…</div></section>;
  }

  return (
    <section className="admin-page">
      <div className="admin-header">
        <div>
          <span className="eyebrow">CAMPUSHOP OPERATIONS</span>
          <h1>Admin dashboard.</h1>
          <p>One place to see demand, safety issues, live trips and the health of the ride network.</p>
        </div>
        <button className="secondary-button admin-back" onClick={onBack}>← Back to CampusHop</button>
      </div>

      {error && <div className="admin-error"><strong>{error}</strong><button onClick={() => setError('')}>×</button></div>}

      <div className="admin-stats">
        <Stat label="Total members" value={stats.users ?? '—'} />
        <Stat label="Active rides" value={stats.activeRides ?? '—'} tone="sage" />
        <Stat label="Pending requests" value={stats.pendingRequests ?? '—'} tone="butter" />
        <Stat label="Open safety reports" value={stats.openReports ?? '—'} tone="coral" />
        <Stat label="Trips live now" value={stats.liveTrips ?? '—'} tone="lavender" />
      </div>

      <div className="admin-grid admin-grid--top">
        <section className="admin-panel admin-alert-panel">
          <div className="admin-panel-heading">
            <div>
              <span className="eyebrow">WHAT NEEDS ATTENTION</span>
              <h2>Safety queue</h2>
            </div>
            <span className="admin-count">{urgentReports.length}</span>
          </div>
          {urgentReports.length === 0 ? (
            <div className="admin-empty">No open safety reports right now.</div>
          ) : urgentReports.slice(0, 5).map((report) => (
            <div className="admin-alert" key={report.id}>
              <div>
                <strong>{statusLabel(report.category)}</strong>
                <span>{report.subject?.name || 'Unknown member'} · {formatDate(report.created_at)}</span>
              </div>
              <button className="admin-small-button" onClick={() => setReportFilter('open')}>Review</button>
            </div>
          ))}
        </section>

        <section className="admin-panel">
          <div className="admin-panel-heading">
            <div>
              <span className="eyebrow">NETWORK PULSE</span>
              <h2>Demand vs supply</h2>
            </div>
          </div>
          <div className="admin-bars">
            <div><span>Posted rides</span><strong>{stats.activeRides ?? 0}</strong></div>
            <div><span>Waiting for a driver</span><strong>{stats.pendingRequests ?? 0}</strong></div>
            <div><span>Accepted trips</span><strong>{stats.acceptedRequests ?? 0}</strong></div>
          </div>
          <p className="admin-note">This tells an operator where the campus network is under pressure without exposing private trip messages.</p>
        </section>
      </div>

      <section className="admin-panel">
        <div className="admin-panel-heading admin-panel-heading--wrap">
          <div>
            <span className="eyebrow">MODERATION</span>
            <h2>Safety reports</h2>
          </div>
          <div className="admin-filter-row">
            {REPORT_STATUSES.map((status) => (
              <button key={status} className={reportFilter === status ? 'admin-filter active' : 'admin-filter'} onClick={() => setReportFilter(status)}>
                {statusLabel(status)}
              </button>
            ))}
          </div>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Issue</th><th>Reported by</th><th>About</th><th>When</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {reportRows.length === 0 ? (
                <tr><td colSpan="6" className="admin-empty">No reports in this queue.</td></tr>
              ) : reportRows.map((report) => (
                <tr key={report.id}>
                  <td><strong>{statusLabel(report.category)}</strong><small>{report.details || 'No details provided'}</small></td>
                  <td>{report.reporter?.name || 'Unknown'}</td>
                  <td>{report.subject?.name || 'Trip-level report'}</td>
                  <td>{formatDate(report.created_at)}</td>
                  <td><span className={`admin-status admin-status--${report.status}`}>{statusLabel(report.status)}</span></td>
                  <td>
                    <select disabled={busy === report.id} value={report.status} onChange={(e) => updateReport(report.id, e.target.value)}>
                      {REPORT_STATUSES.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="admin-grid">
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <div><span className="eyebrow">MEMBERS</span><h2>Member directory</h2></div>
            <input className="admin-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or email" />
          </div>
          <div className="admin-member-list">
            {users.slice(0, 8).map((member) => (
              <div className="admin-member" key={member.id}>
                <div className="mini-avatar">{member.name?.slice(0, 2).toUpperCase() || '??'}</div>
                <div><strong>{member.name}</strong><span>{member.email || 'No email'} · {member.role}</span></div>
                <span className="admin-member-vehicle">{member.vehicle && member.vehicle !== 'none' ? member.vehicle_number || member.vehicle : 'rider'}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="admin-panel">
          <div className="admin-panel-heading">
            <div><span className="eyebrow">TRIP CONTROL</span><h2>Recent rides</h2></div>
            <span className="admin-count">{overview?.rides?.length || 0}</span>
          </div>
          <div className="admin-ride-list">
            {(overview?.rides || []).slice(0, 6).map((ride) => (
              <div className="admin-ride" key={ride.id}>
                <div><strong>{ride.pickup}</strong><span>→ {ride.dropoff}</span><small>{ride.driver?.name || ride.driver_name} · {ride.date} {ride.time}</small></div>
                <div className="admin-ride-actions"><span className={`admin-status admin-status--${ride.trip_status || 'scheduled'}`}>{statusLabel(ride.trip_status || 'scheduled')}</span><button className="admin-danger" disabled={busy === `ride:${ride.id}`} onClick={() => removeRide(ride)}>Remove</button></div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="admin-panel admin-system-panel">
        <div><span className="eyebrow">SYSTEM VIEW</span><h2>What this dashboard connects</h2></div>
        <div className="admin-capabilities">
          <span>Ride supply</span><span>Seat requests</span><span>Safety reports</span><span>Live-trip status</span><span>Member directory</span><span>Ride expiry</span><span>Matching activity</span><span>API health</span>
        </div>
        <p className="admin-note">Private trip chat and live GPS coordinates are intentionally not dumped into the dashboard. The operator sees the operational signal needed to act while keeping member data scoped to its purpose.</p>
      </section>
    </section>
  );
}
