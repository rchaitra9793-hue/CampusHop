import React, { useState, useEffect, useCallback } from "react";
import { api } from "./lib/api";
import Stars from "./Stars";
import AdminTeam from "./AdminTeam";

// The words the categories are stored as, in the words somebody reading a
// queue would use. Kept in step with CATEGORIES in server/src/routes/reports.js.
const CATEGORY_LABELS = {
  unsafe_driving: "Unsafe driving",
  no_show: "No show",
  wrong_vehicle: "Wrong vehicle",
  harassment: "Harassment",
  payment: "Payment",
  other: "Other",
};

// open and reviewing are still waiting on somebody; resolved and dismissed
// are decided. The split drives both the default filter and the colouring.
const WAITING = ["open", "reviewing"];

const STATUS_LABELS = {
  open: "Open",
  reviewing: "Reviewing",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

// The audit verbs, in words. Anything not listed falls back to the verb
// itself, so a new action shows up in the log before it shows up here.
const ACTION_LABELS = {
  "report.status": "Report moved",
  "user.suspend": "Account suspended",
  "user.reinstate": "Account reinstated",
  "user.grant_admin": "Made administrator",
  "user.revoke_admin": "Administrator removed",
  "ride.delete": "Ride removed",
};

const TRIP_LABELS = {
  scheduled: "Not started",
  to_pickup: "On the way",
  arrived: "At pickup",
  started: "Under way",
  completed: "Completed",
};

function when(iso) {
  if (!iso) return "";

  const d = new Date(iso);

  if (Number.isNaN(d.getTime())) return "";

  // A queue is read in relative time — "three days ago" is the thing that
  // matters about an unanswered report, not the calendar date.
  const mins = Math.round((Date.now() - d.getTime()) / 60000);

  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  if (mins < 60 * 24 * 30) return `${Math.round(mins / (60 * 24))}d ago`;

  return d.toLocaleDateString();
}

/**
 * A row of filter buttons.
 *
 * Every list on this page is filtered the same way, and three slightly
 * different sets of pills is three things to learn. Built on .trip-tabs,
 * which is what the rest of the app already uses for exactly this.
 */
function Filters({ value, onChange, options, label }) {
  return (
    <div className="admin-filter">
      <span className="eyebrow">{label}</span>

      <div className="trip-tabs">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={value === o.value ? "active" : ""}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The counts the dashboard opens on. */
function Overview({ stats, onPickStatus }) {
  if (!stats) return null;

  return (
    <>
      <div className="admin-tiles">
        {[
          { key: "open", label: "Open reports", value: stats.reports.open, urgent: stats.reports.open > 0 },
          { key: "reviewing", label: "Reviewing", value: stats.reports.reviewing },
          { key: "resolved", label: "Resolved", value: stats.reports.resolved },
          { key: "dismissed", label: "Dismissed", value: stats.reports.dismissed },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            className={`admin-tile ${t.urgent ? "admin-tile--urgent" : ""}`}
            onClick={() => onPickStatus(t.key)}
          >
            <strong>{t.value}</strong>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Figures, not controls. Three of these used to be buttons that
          all opened the same unfiltered account list — which looks like a
          filter, is not one, and left somebody who clicked "Suspended: 2"
          staring at every account on the campus. The tabs below go to the
          same places in one click and say so. */}
      <div className="admin-tiles admin-tiles--quiet">
        <div className="admin-tile">
          <strong>{stats.users.total}</strong>
          <span>Accounts</span>
        </div>

        <div
          className={`admin-tile ${
            stats.users.suspended > 0 ? "admin-tile--flagged" : ""
          }`}
        >
          <strong>{stats.users.suspended}</strong>
          <span>Suspended</span>
        </div>

        <div className="admin-tile">
          <strong>{stats.users.admins}</strong>
          <span>Administrators</span>
        </div>

        <div className="admin-tile">
          <strong>
            {stats.rides.upcoming ?? "—"}
            <em className="admin-tile-of">/ {stats.rides.total}</em>
          </strong>
          <span>Rides on the board</span>
        </div>
      </div>
    </>
  );
}

/**
 * One report, with the controls that move it along.
 *
 * Resolving or dismissing asks for a note before it will go through — the
 * server requires one too, and asking here means the refusal is not the
 * first time anybody mentions it.
 */
function ReportRow({ report, onMoved, onOpenUser }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  const move = async (status) => {
    if (busy) return;

    setBusy(status);
    setError("");

    try {
      await api.adminConsole.setReportStatus(report.id, status, note.trim());
      setNote("");
      setOpen(false);
      await onMoved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const decided = !WAITING.includes(report.status);

  return (
    <article className={`admin-report admin-report--${report.status}`}>
      <header>
        <div>
          <strong>{CATEGORY_LABELS[report.category] || report.category}</strong>

          <span className={`admin-status admin-status--${report.status}`}>
            {STATUS_LABELS[report.status] || report.status}
          </span>
        </div>

        <time>{when(report.at)}</time>
      </header>

      <div className="admin-report-people">
        <span>
          Filed by{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => onOpenUser(report.reporter.id)}
          >
            {report.reporter?.name || "Unknown"}
          </button>
        </span>

        {report.subject ? (
          <span>
            About{" "}
            <button
              type="button"
              className="text-button"
              onClick={() => onOpenUser(report.subject.id)}
            >
              {report.subject.name}
            </button>
            {report.subject.suspended && <em className="admin-flag">suspended</em>}
          </span>
        ) : (
          // 007 allows a report about the trip rather than about a person.
          <span className="admin-muted">About the trip itself</span>
        )}
      </div>

      {report.ride ? (
        <p className="admin-route">
          {report.ride.pickup} → {report.ride.dropoff}
          {report.ride.date ? ` · ${report.ride.date}` : ""}
          {report.ride.time ? ` ${report.ride.time}` : ""}
        </p>
      ) : (
        // The report outlives the trip on purpose; see 007.
        <p className="admin-route admin-muted">That trip has since been deleted.</p>
      )}

      {report.details && <blockquote>{report.details}</blockquote>}

      {/* What was decided, on the report itself rather than left in the
          audit log. This is the thing somebody asks about months later. */}
      {report.resolution && (
        <div className="admin-decision">
          <span className="eyebrow">
            {report.status === "dismissed" ? "DISMISSED" : "RESOLVED"}
            {report.resolvedBy ? ` BY ${report.resolvedBy.toUpperCase()}` : ""}
            {report.resolvedAt ? ` · ${when(report.resolvedAt)}` : ""}
          </span>
          <p>{report.resolution}</p>
        </div>
      )}

      {error && <p className="form-error">{error}</p>}

      {open ? (
        <div className="admin-actions">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What was done about this? Required to resolve or dismiss."
            rows={2}
            maxLength={1000}
          />

          <div className="admin-action-row">
            {report.status !== "reviewing" && (
              <button
                type="button"
                className="secondary-button"
                disabled={Boolean(busy)}
                onClick={() => move("reviewing")}
              >
                {busy === "reviewing" ? "Saving…" : "Mark reviewing"}
              </button>
            )}

            <button
              type="button"
              className="primary-button"
              disabled={Boolean(busy)}
              onClick={() => move("resolved")}
            >
              {busy === "resolved" ? "Saving…" : "Resolve"}
            </button>

            <button
              type="button"
              className="secondary-button"
              disabled={Boolean(busy)}
              onClick={() => move("dismissed")}
            >
              {busy === "dismissed" ? "Saving…" : "Dismiss"}
            </button>

            {decided && (
              <button
                type="button"
                className="secondary-button"
                disabled={Boolean(busy)}
                onClick={() => move("open")}
              >
                Reopen
              </button>
            )}

            <button
              type="button"
              className="text-button"
              onClick={() => {
                setOpen(false);
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="secondary-button" onClick={() => setOpen(true)}>
          {decided ? "Change decision" : "Act on this"}
        </button>
      )}
    </article>
  );
}

/** The report queue, filtered by status and category. */
function Reports({ status, onStatus, onOpenUser, onChanged }) {
  const [category, setCategory] = useState("all");
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setReports(await api.adminConsole.reports(status, category));
      setError("");
    } catch (err) {
      setError(err.message);
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, [status, category]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const refresh = async () => {
    await load();
    onChanged?.();
  };

  return (
    <>
      <Filters
        label="STATUS"
        value={status}
        onChange={onStatus}
        options={[
          ...["open", "reviewing", "resolved", "dismissed"].map((s) => ({
            value: s,
            label: STATUS_LABELS[s],
          })),
          { value: "all", label: "All" },
        ]}
      />

      <Filters
        label="CATEGORY"
        value={category}
        onChange={setCategory}
        options={[
          { value: "all", label: "Any" },
          ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({
            value,
            label,
          })),
        ]}
      />

      {loading && <p>Loading…</p>}
      {error && <p className="form-error">{error}</p>}

      {!loading && !error && reports.length === 0 && (
        <section className="empty-trips">
          <div className="empty-sticker">OK</div>
          <h2>Nothing here.</h2>
          <p>
            {status === "open" && category === "all"
              ? "No reports are waiting. That is the queue being empty, not broken."
              : "No reports match those filters."}
          </p>
        </section>
      )}

      <section className="admin-list">
        {reports.map((r) => (
          <ReportRow key={r.id} report={r} onMoved={refresh} onOpenUser={onOpenUser} />
        ))}
      </section>
    </>
  );
}

/** One account, and the decisions about it. */
function UserDetail({ me, userId, onBack, onChanged }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState("");
  const [confirming, setConfirming] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api.adminConsole.user(userId));
      setError("");
    } catch (err) {
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  /** Every action here takes a reason and writes to the audit log. */
  const act = async (what, run) => {
    if (busy) return;

    setBusy(what);
    setError("");

    try {
      await run(reason.trim());
      setReason("");
      setConfirming("");
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  if (loading) return <p>Loading…</p>;

  if (!data) {
    return (
      <>
        <button type="button" className="text-button" onClick={onBack}>
          ← Back
        </button>
        <p className="form-error">{error || "No such account."}</p>
      </>
    );
  }

  const u = data.user;
  const isMe = u.id === me?.id;

  return (
    <section className="admin-detail">
      <button type="button" className="text-button" onClick={onBack}>
        ← Back to accounts
      </button>

      <header className="admin-detail-head">
        <div className="mini-avatar">{u.name?.slice(0, 2).toUpperCase() || "??"}</div>

        <div>
          <h2>{u.name}</h2>

          <p className="admin-muted">
            {u.email || "no email on file"} · {u.role}
            {u.isAdmin && <em className="admin-flag admin-flag--admin">administrator</em>}
            {u.suspended && <em className="admin-flag">suspended</em>}
            {isMe && <em className="admin-flag admin-flag--you">you</em>}
          </p>
        </div>
      </header>

      <dl className="admin-facts">
        <div>
          <dt>Vehicle</dt>
          <dd>{u.vehicle && u.vehicle !== "none" ? u.vehicle : "—"}</dd>
        </div>

        <div>
          <dt>Number plate</dt>
          <dd>{u.vehicleNumber || "—"}</dd>
        </div>

        <div>
          <dt>Phone</dt>
          <dd>{u.phone || "—"}</dd>
        </div>

        <div>
          <dt>Rating</dt>
          <dd>
            {u.rating != null ? (
              <Stars value={u.rating} count={u.ratingCount} size="small" />
            ) : (
              <span className="admin-muted">—</span>
            )}
          </dd>
        </div>

        <div>
          <dt>Reports against</dt>
          <dd>{data.reportsAgainst.length}</dd>
        </div>

        <div>
          <dt>Rides posted</dt>
          <dd>{data.rides.length}</dd>
        </div>
      </dl>

      {u.suspended && (
        <div className="admin-banner">
          <strong>Suspended {when(u.suspendedAt)}</strong>
          {u.suspendedReason && <p>{u.suspendedReason}</p>}
        </div>
      )}

      {error && <p className="form-error">{error}</p>}

      {/* One reason box for whichever action is taken. Every one of them
          needs it, and the server refuses without it. */}
      <div className="admin-actions admin-actions--boxed">
        <span className="eyebrow">ACT ON THIS ACCOUNT</span>

        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why? Written to the audit log, and shown to them if they are suspended."
          rows={2}
          maxLength={1000}
        />

        {isMe ? (
          <p className="admin-muted">
            This is your own account. Suspending yourself, or removing your own
            privilege, would lock you out with no way back through the app — so
            neither is offered here.
          </p>
        ) : (
          <div className="admin-action-row">
            {/* --- suspension --- */}
            {u.suspended ? (
              <button
                type="button"
                className="primary-button"
                disabled={Boolean(busy)}
                onClick={() =>
                  act("reinstate", (why) => api.adminConsole.reinstate(u.id, why))
                }
              >
                {busy === "reinstate" ? "Working…" : "Reinstate account"}
              </button>
            ) : u.isAdmin ? (
              <span className="admin-muted">
                Administrators cannot be suspended. Remove the privilege first.
              </span>
            ) : confirming === "suspend" ? (
              <>
                <button
                  type="button"
                  className="danger-button"
                  disabled={Boolean(busy) || !reason.trim()}
                  onClick={() =>
                    act("suspend", (why) => api.adminConsole.suspend(u.id, why))
                  }
                >
                  {busy === "suspend" ? "Working…" : "Yes, suspend"}
                </button>

                <button
                  type="button"
                  className="text-button"
                  onClick={() => setConfirming("")}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="danger-button"
                disabled={!reason.trim()}
                onClick={() => setConfirming("suspend")}
              >
                Suspend account
              </button>
            )}

            {/* --- the privilege --- */}
            {u.isAdmin ? (
              confirming === "revoke" ? (
                <>
                  <button
                    type="button"
                    className="danger-button"
                    disabled={Boolean(busy) || !reason.trim()}
                    onClick={() =>
                      act("role", (why) => api.adminConsole.setRole(u.id, false, why))
                    }
                  >
                    {busy === "role" ? "Working…" : "Yes, remove privilege"}
                  </button>

                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setConfirming("")}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!reason.trim()}
                  onClick={() => setConfirming("revoke")}
                >
                  Remove administrator
                </button>
              )
            ) : u.suspended ? (
              <span className="admin-muted">
                Reinstate before making them an administrator.
              </span>
            ) : (
              <button
                type="button"
                className="secondary-button"
                disabled={Boolean(busy) || !reason.trim()}
                onClick={() => act("role", (why) => api.adminConsole.setRole(u.id, true, why))}
              >
                {busy === "role" ? "Working…" : "Make administrator"}
              </button>
            )}
          </div>
        )}
      </div>

      <h3>Reported about them</h3>

      {data.reportsAgainst.length === 0 ? (
        <p className="admin-muted">Nothing has been reported about this account.</p>
      ) : (
        <section className="admin-list">
          {data.reportsAgainst.map((r) => (
            <article key={r.id} className="admin-report admin-report--compact">
              <header>
                <div>
                  <strong>{CATEGORY_LABELS[r.category] || r.category}</strong>
                  <span className={`admin-status admin-status--${r.status}`}>
                    {STATUS_LABELS[r.status] || r.status}
                  </span>
                </div>
                <time>{when(r.at)}</time>
              </header>

              <p className="admin-muted">by {r.reporter?.name || "Unknown"}</p>

              {r.details && <blockquote>{r.details}</blockquote>}
            </article>
          ))}
        </section>
      )}

      <h3>Reports they filed</h3>

      {data.reportsFiled.length === 0 ? (
        <p className="admin-muted">They have not reported anybody.</p>
      ) : (
        <ul className="admin-plain-list">
          {data.reportsFiled.map((r) => (
            <li key={r.id}>
              {CATEGORY_LABELS[r.category] || r.category}
              {r.subject ? ` about ${r.subject.name}` : ""} ·{" "}
              {STATUS_LABELS[r.status] || r.status} · {when(r.at)}
            </li>
          ))}
        </ul>
      )}

      <h3>Rides they posted</h3>

      {data.rides.length === 0 ? (
        <p className="admin-muted">They have not posted a ride.</p>
      ) : (
        <ul className="admin-plain-list">
          {data.rides.map((r) => (
            <li key={r.id}>
              {r.pickup} → {r.dropoff} · {r.date} {r.time} · {r.seats} seats
            </li>
          ))}
        </ul>
      )}

      <h3>What admins did to this account</h3>

      {data.history.length === 0 ? (
        <p className="admin-muted">No admin has acted on this account.</p>
      ) : (
        <ul className="admin-plain-list">
          {data.history.map((a) => (
            <li key={a.id}>
              <strong>{ACTION_LABELS[a.action] || a.action}</strong> by {a.by} ·{" "}
              {when(a.at)}
              {a.note ? ` — ${a.note}` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Finding an account. */
function Users({ onOpenUser }) {
  const [q, setQ] = useState("");
  const [role, setRole] = useState("all");
  const [standing, setStanding] = useState("all");
  const [sort, setSort] = useState("name");
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    // Typing a name should not fire a request per keystroke.
    const timer = setTimeout(async () => {
      try {
        const rows = await api.adminConsole.users({
          q,
          role: role === "all" ? "" : role,
          suspended: standing === "suspended" ? "true" : "",
          sort,
        });

        if (!cancelled) {
          setUsers(rows);
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setUsers([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, role, standing, sort]);

  return (
    <>
      <div className="admin-search">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or email"
        />

        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="name">A to Z</option>
          <option value="reports">Most reported</option>
          <option value="rating">Lowest rated</option>
        </select>
      </div>

      <Filters
        label="WHO"
        value={role}
        onChange={setRole}
        options={[
          { value: "all", label: "Everyone" },
          { value: "student", label: "Students" },
          { value: "faculty", label: "Faculty" },
          { value: "admin", label: "Administrators" },
        ]}
      />

      <Filters
        label="STANDING"
        value={standing}
        onChange={setStanding}
        options={[
          { value: "all", label: "Any" },
          { value: "suspended", label: "Suspended only" },
        ]}
      />

      {loading && <p>Loading…</p>}
      {error && <p className="form-error">{error}</p>}

      {!loading && !error && users.length === 0 && (
        <p className="admin-muted">No accounts match that.</p>
      )}

      {!loading && users.length > 0 && (
        <p className="admin-muted admin-result-count">
          {users.length} account{users.length === 1 ? "" : "s"}
        </p>
      )}

      <section className="admin-users">
        {users.map((u) => (
          <button
            key={u.id}
            type="button"
            className={`admin-user ${u.suspended ? "admin-user--suspended" : ""}`}
            onClick={() => onOpenUser(u.id)}
          >
            <div className="mini-avatar">{u.name?.slice(0, 2).toUpperCase() || "??"}</div>

            <div>
              <strong>{u.name}</strong>
              <span>{u.email || "no email"}</span>

              {u.rating != null && (
                <Stars value={u.rating} count={u.ratingCount} size="small" />
              )}
            </div>

            <div className="admin-user-flags">
              {u.isAdmin && <em className="admin-flag admin-flag--admin">admin</em>}
              {u.suspended && <em className="admin-flag">suspended</em>}

              {/* An open complaint is the reason to look at an account,
                  so it is the thing the row says loudest. */}
              {u.openReports > 0 && (
                <em className="admin-flag">{u.openReports} open</em>
              )}

              {u.openReports === 0 && u.reportsAgainst > 0 && (
                <span className="admin-muted">{u.reportsAgainst} past</span>
              )}

              {u.vehicleNumber && <span>{u.vehicleNumber}</span>}
            </div>
          </button>
        ))}
      </section>
    </>
  );
}

/** The ride board, as an administrator sees it. */
function Rides({ onOpenUser, onChanged }) {
  const [q, setQ] = useState("");
  const [state, setState] = useState("all");
  const [rides, setRides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // The ride being removed, and why.
  const [removing, setRemoving] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRides(await api.adminConsole.rides({ q, state: state === "all" ? "" : state }));
      setError("");
    } catch (err) {
      setError(err.message);
      setRides([]);
    } finally {
      setLoading(false);
    }
  }, [q, state]);

  useEffect(() => {
    let cancelled = false;

    const timer = setTimeout(() => {
      if (!cancelled) load();
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [load]);

  const remove = async () => {
    if (busy || !reason.trim()) return;

    setBusy(true);
    setError("");

    try {
      await api.adminConsole.removeRide(removing.id, reason.trim());
      setRemoving(null);
      setReason("");
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="admin-search">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by place or driver"
        />
      </div>

      <Filters
        label="WHEN"
        value={state}
        onChange={setState}
        options={[
          { value: "all", label: "All" },
          { value: "upcoming", label: "Still to come" },
          { value: "past", label: "Departed" },
        ]}
      />

      {loading && <p>Loading…</p>}
      {error && <p className="form-error">{error}</p>}

      {!loading && !error && rides.length === 0 && (
        <p className="admin-muted">No rides match that.</p>
      )}

      {!loading && rides.length > 0 && (
        <p className="admin-muted admin-result-count">
          {rides.length} ride{rides.length === 1 ? "" : "s"}
        </p>
      )}

      <section className="admin-list">
        {rides.map((r) => (
          <article
            key={r.id}
            className={`admin-ride ${r.gone ? "admin-ride--gone" : ""}`}
          >
            <header>
              <div>
                <strong>
                  {r.pickup} → {r.dropoff}
                </strong>

                <span className={`admin-status admin-status--${r.gone ? "dismissed" : "open"}`}>
                  {r.gone ? "Departed" : "On the board"}
                </span>
              </div>

              <time>
                {r.date} {r.time}
              </time>
            </header>

            <div className="admin-ride-facts">
              <span>
                <small>DRIVER</small>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => onOpenUser(r.driver.id)}
                >
                  {r.driver?.name || "Unknown"}
                </button>
                {r.driver?.suspended && <em className="admin-flag">suspended</em>}
              </span>

              <span>
                <small>SEATS</small>
                <strong>
                  {r.seatsTaken} / {r.seats}
                </strong>
              </span>

              <span>
                <small>VEHICLE</small>
                <strong>{r.vehicle || "—"}</strong>
              </span>

              <span>
                <small>TRIP</small>
                <strong>{TRIP_LABELS[r.tripStatus] || r.tripStatus}</strong>
              </span>

              <span>
                <small>RATING</small>
                <strong>
                  {r.driver?.rating != null ? (
                    <Stars
                      value={r.driver.rating}
                      count={r.driver.ratingCount}
                      size="small"
                    />
                  ) : (
                    "—"
                  )}
                </strong>
              </span>
            </div>

            {removing?.id === r.id ? (
              <div className="admin-actions">
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why is this ride being removed? Required."
                  rows={2}
                  maxLength={1000}
                />

                {/* The part that cannot be undone, said before it is. */}
                {r.seatsTaken > 0 && (
                  <p className="admin-warn">
                    {r.seatsTaken} rider{r.seatsTaken === 1 ? "" : "s"} ha
                    {r.seatsTaken === 1 ? "s" : "ve"} an accepted seat on this
                    ride. Removing it cancels them too.
                  </p>
                )}

                <div className="admin-action-row">
                  <button
                    type="button"
                    className="danger-button"
                    disabled={busy || !reason.trim()}
                    onClick={remove}
                  >
                    {busy ? "Removing…" : "Yes, remove this ride"}
                  </button>

                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setRemoving(null);
                      setReason("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setRemoving(r);
                  setReason("");
                }}
              >
                Remove this ride
              </button>
            )}
          </article>
        ))}
      </section>
    </>
  );
}

/** The audit log. */
function AuditLog({ onOpenUser }) {
  const [kind, setKind] = useState("all");
  const [adminId, setAdminId] = useState("");
  const [rows, setRows] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const out = await api.adminConsole.actions({ action: kind, adminId });

        if (cancelled) return;

        setRows(out.actions || []);

        // Only refreshed from an unfiltered read, so narrowing by one
        // admin does not leave them as the only name in the dropdown.
        if (!adminId) setAdmins(out.admins || []);

        setError("");
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [kind, adminId]);

  return (
    <>
      <div className="admin-search">
        <select value={adminId} onChange={(e) => setAdminId(e.target.value)}>
          <option value="">Any administrator</option>
          {admins.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      <Filters
        label="WHAT"
        value={kind}
        onChange={setKind}
        options={[
          { value: "all", label: "Everything" },
          { value: "report.", label: "Reports" },
          { value: "user.", label: "Accounts" },
          { value: "ride.", label: "Rides" },
        ]}
      />

      {loading && <p>Loading…</p>}
      {error && <p className="form-error">{error}</p>}

      {!loading && !error && rows.length === 0 && (
        <p className="admin-muted">
          {kind === "all" && !adminId
            ? "No admin has done anything yet."
            : "Nothing matches those filters."}
        </p>
      )}

      {!loading && rows.length > 0 && (
        <p className="admin-muted admin-result-count">
          {rows.length} entr{rows.length === 1 ? "y" : "ies"} · nothing is ever
          deleted from here
        </p>
      )}

      <ul className="admin-plain-list admin-audit">
        {rows.map((a) => (
          <li key={a.id} className={`admin-audit--${a.kind}`}>
            <div className="admin-audit-head">
              <strong>{ACTION_LABELS[a.action] || a.action}</strong>

              {a.target && a.kind === "user" ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => onOpenUser(a.targetId)}
                >
                  {a.target}
                </button>
              ) : (
                a.target && <span>{a.target}</span>
              )}
            </div>

            <span className="admin-muted">
              by {a.by} · {when(a.at)}
            </span>

            {a.note && <p>{a.note}</p>}
          </li>
        ))}
      </ul>
    </>
  );
}

/** Two figures: the people who run this. Drawn, like the other marks. */
function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M3.4 19.2c0-3.1 2.5-5.1 5.6-5.1s5.6 2 5.6 5.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M16.4 5.2a3.2 3.2 0 0 1 0 5.9M17.6 14.4c2.2.5 3.6 2.2 3.6 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The administration dashboard.
 *
 * Rendered only for a user whose profile carries is_admin, but that check
 * is a courtesy: every endpoint behind this screen is gated server-side by
 * requireAdmin, and answers 404 to anybody else. Nothing here is the
 * security boundary — see the mount in server/index.js.
 */
export default function AdminConsole({ user }) {
  const [view, setView] = useState("queue");
  const [status, setStatus] = useState("open");
  const [openUser, setOpenUser] = useState(null);
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState("");

  // Appointing and removing administrators. Behind an icon rather than a
  // tab: it happens once a term, and it should not sit at the same level
  // as the queue somebody reads every day.
  const [team, setTeam] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      setStats(await api.adminConsole.overview());
      setStatsError("");
    } catch (err) {
      setStatsError(err.message);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const showUser = (id) => {
    setOpenUser(id);
    setView("users");
  };

  return (
    <main className="page-shell">
      <section className="page-heading page-heading--admin">
        <div>
          <span className="eyebrow">ADMINISTRATION</span>

          <h1>
            The reports queue,
            <br />
            <em>and who is on the board.</em>
          </h1>

          <p>
            Signed in as {user?.name}. Every action on this page is written to
            the audit log.
          </p>
        </div>

        <button
          type="button"
          className="admin-team-button"
          onClick={() => setTeam(true)}
          title="Administrators"
          aria-label="Manage administrators"
        >
          <PeopleIcon />
          {stats?.users.admins != null && <em>{stats.users.admins}</em>}
        </button>
      </section>

      {team && (
        <AdminTeam
          me={user}
          onClose={() => setTeam(false)}
          onChanged={loadStats}
        />
      )}

      {statsError && <p className="form-error">{statsError}</p>}

      <Overview
        stats={stats}
        onPickStatus={(s) => {
          setStatus(s);
          setOpenUser(null);
          setView("queue");
        }}
      />

      <div className="trip-tabs admin-nav">
        <button
          className={view === "queue" ? "active" : ""}
          onClick={() => {
            setOpenUser(null);
            setView("queue");
          }}
        >
          Reports
          {stats?.reports.open > 0 && (
            <em className="admin-count admin-count--urgent">{stats.reports.open}</em>
          )}
        </button>

        <button
          className={view === "users" ? "active" : ""}
          onClick={() => setView("users")}
        >
          Accounts
        </button>

        <button
          className={view === "rides" ? "active" : ""}
          onClick={() => {
            setOpenUser(null);
            setView("rides");
          }}
        >
          Rides
        </button>

        <button
          className={view === "audit" ? "active" : ""}
          onClick={() => {
            setOpenUser(null);
            setView("audit");
          }}
        >
          Audit log
        </button>
      </div>

      {view === "queue" && (
        <Reports
          status={status}
          onStatus={setStatus}
          onOpenUser={showUser}
          onChanged={loadStats}
        />
      )}

      {view === "users" &&
        (openUser ? (
          <UserDetail
            me={user}
            userId={openUser}
            onBack={() => setOpenUser(null)}
            onChanged={loadStats}
          />
        ) : (
          <Users onOpenUser={showUser} />
        ))}

      {view === "rides" && <Rides onOpenUser={showUser} onChanged={loadStats} />}

      {view === "audit" && <AuditLog onOpenUser={showUser} />}
    </main>
  );
}
