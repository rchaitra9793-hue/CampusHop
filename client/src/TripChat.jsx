import React, { useEffect, useRef, useState } from "react";
import { api } from "./lib/api";

// The thread is polled rather than pushed. Everything else in this app
// that changes underneath you — the board, incoming requests, the driver's
// position — works the same way, and a websocket for one screen would be a
// second way of doing the same thing.
const POLL_MS = 4000;

/** "14:32" — a time is all a message from the same trip ever needs. */
function clock(at) {
  try {
    return new Date(at).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/**
 * The conversation between the two people on one trip.
 *
 * "I'm at the second gate, not the first" is the single most useful thing
 * either of them can say, and until now saying it meant handing over a
 * phone number and leaving the app. The thread opens when the seat is
 * accepted and belongs to exactly those two people.
 */
export default function TripChat({ tripId, withName, onUnreadChange }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const listRef = useRef(null);
  const atBottomRef = useRef(true);

  // --- reading ----------------------------------------------------------

  useEffect(() => {
    if (!tripId) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const data = await api.messages.list(tripId);

        if (cancelled) return;

        setMessages(data.messages);
        setLoaded(true);
        setError("");

        // The thread being open is what marks it read, so the badge
        // elsewhere should clear at the same moment.
        onUnreadChange?.(0);
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setLoaded(true);
        }
      }
    };

    poll();

    const timer = setInterval(poll, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [tripId, onUnreadChange]);

  // Follow new messages, but only for someone already at the bottom —
  // yanking the view down while they scroll back is how you lose the
  // message they were reading.
  useEffect(() => {
    const list = listRef.current;

    if (list && atBottomRef.current) list.scrollTop = list.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const list = listRef.current;

    if (!list) return;

    const slack = list.scrollHeight - list.scrollTop - list.clientHeight;
    atBottomRef.current = slack < 40;
  };

  // --- writing ----------------------------------------------------------

  const send = async (e) => {
    e.preventDefault();

    const body = draft.trim();

    if (!body || sending) return;

    setSending(true);
    setError("");

    // Shown immediately under a temporary id. A message that waits for a
    // round trip before appearing feels like it did not send.
    const pending = {
      id: `pending-${Date.now()}`,
      body,
      at: new Date().toISOString(),
      mine: true,
      pending: true,
    };

    setMessages((current) => [...current, pending]);
    setDraft("");
    atBottomRef.current = true;

    try {
      const { message } = await api.messages.send(tripId, body);

      setMessages((current) =>
        current.map((m) => (m.id === pending.id ? message : m))
      );
    } catch (err) {
      setError(err.message);

      // Take the failed one back out and hand the words back, rather than
      // leaving something on screen that was never delivered.
      setMessages((current) => current.filter((m) => m.id !== pending.id));
      setDraft(body);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="chat">
      <header className="chat-head">
        <strong>Messages</strong>
        <span>{withName ? `with ${withName}` : "on this trip"}</span>
      </header>

      <div className="chat-list" ref={listRef} onScroll={onScroll}>
        {!loaded && <p className="chat-empty">Opening the thread…</p>}

        {loaded && !messages.length && (
          <p className="chat-empty">
            No messages yet. Where exactly to meet is usually the first one.
          </p>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`chat-bubble ${m.mine ? "chat-bubble--mine" : ""} ${
              m.pending ? "chat-bubble--pending" : ""
            }`}
          >
            <p>{m.body}</p>
            <span>
              {clock(m.at)}
              {m.mine && m.readAt ? " · read" : ""}
            </span>
          </div>
        ))}
      </div>

      {error && <p className="form-error">{error}</p>}

      <form className="chat-compose" onSubmit={send}>
        <input
          type="text"
          value={draft}
          maxLength={1000}
          placeholder="Message…"
          aria-label="Write a message"
          onChange={(e) => setDraft(e.target.value)}
        />

        <button type="submit" disabled={!draft.trim() || sending}>
          {sending ? "…" : "Send"}
        </button>
      </form>
    </section>
  );
}
