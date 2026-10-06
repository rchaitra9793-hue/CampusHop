import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "./lib/api";

/** How a timestamp in the near future reads. */
function minutesLeft(iso) {
  if (!iso) return null;

  const left = Math.round((new Date(iso).getTime() - Date.now()) / 60000);

  if (left <= 0) return "expired";
  if (left === 1) return "1 minute left";

  return `${left} minutes left`;
}

/**
 * Who administers CampusHop.
 *
 * Opened from the small icon on the dashboard heading, because this is
 * rare work: appointing somebody happens once a term, and it does not
 * belong on the same footing as the reports queue that is read daily.
 *
 * Appointing is by invitation, to any address. The people who administer
 * a campus app are often not the people who commute on it — an office
 * mailbox, somebody in the warden's office, staff on another domain — so
 * the `.edu.in` rule that guards the ride board would be the wrong gate
 * here. What stands in its place is a code: it goes to the address that
 * was typed, and nobody is appointed until it comes back. That is what
 * turns "an administrator typed this" into "whoever reads that mailbox
 * agreed".
 *
 * Somebody already on the board can also be appointed directly, by
 * searching for them — no code, because the account is already proven.
 */
export default function AdminTeam({ me, onClose, onChanged }) {
  const [admins, setAdmins] = useState([]);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  // "invite" sends a code to any address; "search" appoints somebody who
  // is already on the board. Invitation first: it is the one that works
  // for anybody.
  const [mode, setMode] = useState("invite");

  // --- inviting ---
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [sentTo, setSentTo] = useState(null);
  const [code, setCode] = useState("");

  // --- appointing someone already on the board ---
  const [query, setQuery] = useState("");
  const [found, setFound] = useState([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState(null);

  // --- removing ---
  const [removing, setRemoving] = useState(null);

  const load = useCallback(async () => {
    try {
      const [team, open] = await Promise.all([
        api.adminConsole.users({ role: "admin" }),
        api.adminConsole.invites().catch(() => []),
      ]);

      setAdmins(team);
      setPending(open);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Searching the board, for the other mode. Debounced like the accounts
  // list, and only once there is enough typed to be a search.
  useEffect(() => {
    const term = query.trim();

    if (mode !== "search" || term.length < 2) {
      setFound([]);
      return undefined;
    }

    let cancelled = false;

    setSearching(true);

    const timer = setTimeout(async () => {
      try {
        const rows = await api.adminConsole.users({ q: term });

        // Current administrators are listed above already, and the server
        // refuses a suspended account — offering either would be a
        // refusal waiting to happen.
        if (!cancelled) setFound(rows.filter((u) => !u.isAdmin && !u.suspended));
      } catch {
        if (!cancelled) setFound([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, mode]);

  /** Everything here needs a reason, and all of it is audited. */
  const act = async (what, run, after) => {
    if (busy) return;

    setBusy(what);
    setError("");
    setNotice("");

    try {
      const result = await run();

      await load();
      onChanged?.();
      after?.(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const sendCode = () =>
    act(
      "send",
      () => api.adminConsole.invite(email.trim(), reason.trim()),
      (out) => {
        setSentTo(out.invite);
        setCode("");
        setNotice(
          `Code sent to ${out.invite.email}. Ask them to read it back — ` +
            `it is good for ${out.minutes} minutes.`
        );
      }
    );

  const confirmCode = () =>
    act(
      "confirm",
      () => api.adminConsole.confirmInvite(sentTo.email, code.replace(/\D/g, "")),
      (out) => {
        setSentTo(null);
        setCode("");
        setEmail("");
        setReason("");

        setNotice(
          out.accountCreated
            ? `${out.email} is now an administrator. The account was created ` +
                `just now, so they sign in by choosing "Forgot password?" on ` +
                `the sign-in page to set one.`
            : `${out.email} is now an administrator.`
        );
      }
    );

  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="report-modal admin-team">
        <header className="admin-team-head">
          <div>
            <span className="eyebrow">ADMINISTRATORS</span>
            <h2>Who runs this.</h2>
          </div>

          <button
            type="button"
            className="text-button"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        {error && <p className="form-error">{error}</p>}
        {notice && <p className="auth-notice">{notice}</p>}

        {/* ---------- who there is ---------- */}
        {loading ? (
          <p className="admin-muted">Loading…</p>
        ) : (
          <ul className="admin-team-list">
            {admins.map((a) => {
              const isMe = a.id === me?.id;
              const last = admins.length === 1;

              return (
                <li key={a.id}>
                  <div className="mini-avatar">
                    {a.name?.slice(0, 2).toUpperCase() || "??"}
                  </div>

                  <div className="admin-team-who">
                    <strong>
                      {a.name}
                      {isMe && <em className="admin-flag admin-flag--you">you</em>}
                    </strong>
                    <span>{a.email || "no email"}</span>
                  </div>

                  {/* Two reasons there is no button, each of them a way of
                      ending up with nobody in charge. The server enforces
                      both; this only says so first. */}
                  {isMe ? (
                    <span className="admin-muted">your own account</span>
                  ) : last ? (
                    <span className="admin-muted">the only one</span>
                  ) : removing?.id === a.id ? (
                    <div className="admin-team-confirm">
                      <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Why? Required."
                        maxLength={1000}
                        autoFocus
                      />

                      <button
                        type="button"
                        className="danger-button"
                        disabled={Boolean(busy) || !reason.trim()}
                        onClick={() =>
                          act(
                            "remove",
                            () => api.adminConsole.setRole(a.id, false, reason.trim()),
                            () => {
                              setRemoving(null);
                              setReason("");
                              setNotice(`${a.name} is no longer an administrator.`);
                            }
                          )
                        }
                      >
                        {busy === "remove" ? "Removing…" : "Remove"}
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
                  ) : (
                    <button
                      type="button"
                      className="text-button admin-team-remove"
                      onClick={() => {
                        setRemoving(a);
                        setPicked(null);
                        setReason("");
                      }}
                    >
                      Remove
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* ---------- codes already out ---------- */}
        {pending.length > 0 && (
          <div className="admin-team-pending">
            <span className="eyebrow">WAITING ON A CODE</span>

            <ul>
              {pending.map((i) => (
                <li key={i.id}>
                  <div>
                    <strong>{i.email}</strong>
                    <span>
                      invited by {i.invitedBy} · {minutesLeft(i.expiresAt)}
                      {i.attempts > 0
                        ? ` · ${i.attempts} wrong attempt${i.attempts === 1 ? "" : "s"}`
                        : ""}
                    </span>
                  </div>

                  <div className="admin-team-pending-actions">
                    {/* The code may have been read out while the panel was
                        closed, so there has to be a way back to the box
                        that takes it. */}
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setMode("invite");
                        setSentTo({ email: i.email, expiresAt: i.expiresAt });
                        setCode("");
                        setNotice("");
                      }}
                    >
                      Enter code
                    </button>

                    <button
                      type="button"
                      className="text-button admin-team-remove"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        act("withdraw", () => api.adminConsole.withdrawInvite(i.id), () =>
                          setNotice(`The invitation to ${i.email} was withdrawn.`)
                        )
                      }
                    >
                      Withdraw
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ---------- adding somebody ---------- */}
        <div className="admin-team-add">
          <span className="eyebrow">ADD AN ADMINISTRATOR</span>

          {/* The code box, once one has gone out. Nothing else matters
              while an invitation is open. */}
          {sentTo ? (
            <div className="admin-team-picked">
              <p>
                A six-digit code went to <strong>{sentTo.email}</strong>. Ask
                them to read it back and type it here.
              </p>

              <input
                className="admin-team-code"
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="000000"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
              />

              <div className="admin-action-row">
                <button
                  type="button"
                  className="primary-button"
                  disabled={Boolean(busy) || code.length !== 6}
                  onClick={confirmCode}
                >
                  {busy === "confirm" ? "Confirming…" : "Confirm administrator"}
                </button>

                <button
                  type="button"
                  className="text-button"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    setSentTo(null);
                    setCode("");
                    setNotice("");
                  }}
                >
                  Not now
                </button>
              </div>

              <p className="admin-muted">
                {minutesLeft(sentTo.expiresAt)}. Five wrong attempts close the
                invitation; the pending list above has a way back to this box.
              </p>
            </div>
          ) : (
            <>
              <div className="trip-tabs admin-team-modes">
                <button
                  type="button"
                  className={mode === "invite" ? "active" : ""}
                  onClick={() => {
                    setMode("invite");
                    setPicked(null);
                  }}
                >
                  Invite by email
                </button>

                <button
                  type="button"
                  className={mode === "search" ? "active" : ""}
                  onClick={() => {
                    setMode("search");
                    setEmail("");
                  }}
                >
                  Someone on the board
                </button>
              </div>

              {mode === "invite" ? (
                <>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Any email address"
                    autoComplete="off"
                  />

                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why? Written to the audit log. Required."
                    maxLength={1000}
                  />

                  <button
                    type="button"
                    className="primary-button"
                    disabled={
                      Boolean(busy) || !email.trim() || !reason.trim()
                    }
                    onClick={sendCode}
                  >
                    {busy === "send" ? "Sending…" : "Send a code"}
                  </button>

                  <p className="admin-muted">
                    Any address, campus or not. They do not need a CampusHop
                    account — one is created when the code comes back.
                  </p>
                </>
              ) : picked ? (
                <div className="admin-team-picked">
                  <p>
                    Make <strong>{picked.name}</strong>
                    {picked.email ? ` (${picked.email})` : ""} an administrator?
                    Their account is already on the board, so no code is
                    needed.
                  </p>

                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why? Written to the audit log. Required."
                    maxLength={1000}
                    autoFocus
                  />

                  <div className="admin-action-row">
                    <button
                      type="button"
                      className="primary-button"
                      disabled={Boolean(busy) || !reason.trim()}
                      onClick={() =>
                        act(
                          "add",
                          () => api.adminConsole.setRole(picked.id, true, reason.trim()),
                          () => {
                            setPicked(null);
                            setQuery("");
                            setReason("");
                            setNotice(`${picked.name} is now an administrator.`);
                          }
                        )
                      }
                    >
                      {busy === "add" ? "Working…" : "Make administrator"}
                    </button>

                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setPicked(null);
                        setReason("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by name or email"
                  />

                  {query.trim().length >= 2 && (
                    <ul className="admin-team-results">
                      {searching && <li className="admin-muted">Searching…</li>}

                      {!searching && found.length === 0 && (
                        <li className="admin-muted">
                          Nobody on the board matches. Use “Invite by email”
                          for somebody who has not signed up.
                        </li>
                      )}

                      {!searching &&
                        found.slice(0, 6).map((u) => (
                          <li key={u.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setPicked(u);
                                setRemoving(null);
                                setReason("");
                              }}
                            >
                              <strong>{u.name}</strong>
                              <span>
                                {u.email || "no email"} · {u.role}
                              </span>
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <p className="admin-team-note">
          Every change here is written to the audit log. You cannot change your
          own privilege, appoint a suspended account, or remove the last
          administrator — ask another administrator, or use the database.
        </p>
      </div>
    </div>,
    document.body
  );
}
