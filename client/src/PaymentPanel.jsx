import React, { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { api } from "./lib/api";

const POLL_MS = 5000;

const METHOD_LABEL = { upi: "UPI", cash: "cash" };

/** A standard UPI payment link — every UPI app (GPay, PhonePe, Paytm, BHIM) opens it. */
function upiLink({ upi, name, amount }) {
  const params = new URLSearchParams({
    pa: upi,
    pn: name || "CampusHop driver",
    am: Number(amount).toFixed(2),
    cu: "INR",
    tn: "CampusHop ride share",
  });

  return `upi://pay?${params.toString()}`;
}

/**
 * Settling up after a completed ride.
 *
 * The rider pays their half by UPI (straight to the driver's own UPI ID)
 * or in cash, and marks it paid. The driver confirms they received it, or
 * says they did not, which puts it back to unpaid. Both screens poll, so
 * each sees the other's step within a few seconds.
 */
export default function PaymentPanel({ tripId, role, otherName }) {
  const [payment, setPayment] = useState(null);
  const [error, setError] = useState("");
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState(null);
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);

  const isDriver = role === "driver";

  const load = useCallback(async () => {
    try {
      const p = await api.requests.payment(tripId);
      setPayment(p);
      setError("");
    } catch (err) {
      if (/014_payments/.test(err.message)) setSetupNeeded(true);
      else setError(err.message);
    }
  }, [tripId]);

  useEffect(() => {
    load();

    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [load]);

  // Start on the recommended method; the rider can switch.
  const method = choice || payment?.recommended?.method || (payment?.driverUpi ? "upi" : "cash");
  const link =
    payment?.driverUpi && payment?.amount != null
      ? upiLink({ upi: payment.driverUpi, name: payment.driverName, amount: payment.amount })
      : null;

  useEffect(() => {
    if (!link || method !== "upi" || isDriver) return undefined;

    let cancelled = false;
    QRCode.toDataURL(link, { width: 200, margin: 1 })
      .then((url) => !cancelled && setQr(url))
      .catch(() => !cancelled && setQr(""));

    return () => {
      cancelled = true;
    };
  }, [link, method, isDriver]);

  const act = async (fn) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setPayment(await fn());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const copyUpi = async () => {
    try {
      await navigator.clipboard.writeText(payment.driverUpi);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked — the ID is on screen to copy by hand.
    }
  };

  if (setupNeeded) {
    return (
      <section className="pay-panel">
        <span className="eyebrow">PAYMENT</span>
        <p className="pay-note">
          Payments need a one-time database update (db/014_payments_stats_reminders.sql).
          Until then, settle up in cash.
        </p>
      </section>
    );
  }

  if (!payment || !payment.canPay) {
    return error ? <p className="form-error">{error}</p> : null;
  }

  const amount = `₹${payment.amount}`;
  const how = METHOD_LABEL[payment.method] || "";

  // --- confirmed: done on both sides -------------------------------------
  if (payment.status === "confirmed") {
    return (
      <section className="pay-panel pay-panel--done">
        <div className="pay-done-icon" aria-hidden="true">✓</div>
        <div>
          <strong>{isDriver ? `${amount} received` : `${amount} paid`}{how ? ` by ${how}` : ""}</strong>
          <span>
            {isDriver
              ? `You confirmed ${otherName || "the rider"}'s payment. All settled.`
              : `${payment.driverName} confirmed it. All settled — thanks for riding!`}
          </span>
        </div>
      </section>
    );
  }

  // --- driver ------------------------------------------------------------
  if (isDriver) {
    return (
      <section className="pay-panel">
        <span className="eyebrow">PAYMENT</span>

        {payment.status === "paid" ? (
          <>
            <h3>
              {otherName || "Your rider"} says they paid {amount} by {how}.
            </h3>
            <p className="pay-note">
              {payment.method === "upi"
                ? "Check your UPI app for the payment, then confirm."
                : "Confirm once you have the cash in hand."}
            </p>
            <div className="pay-actions">
              <button
                type="button"
                className="primary-button"
                disabled={busy}
                onClick={() => act(() => api.requests.confirmPayment(tripId, true))}
              >
                Yes, I received {amount}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => act(() => api.requests.confirmPayment(tripId, false))}
              >
                Not received
              </button>
            </div>
          </>
        ) : (
          <>
            <h3>
              {otherName || "Your rider"} owes you {amount}.
            </h3>
            {payment.recommended && (
              <p className="pay-recommend">
                <b>Suggested: {METHOD_LABEL[payment.recommended.method].toUpperCase()}</b> ·{" "}
                {payment.recommended.reason}
              </p>
            )}
            {!payment.driverUpi && (
              <p className="pay-note">
                Add your UPI ID in your profile so riders can pay you instantly next time.
              </p>
            )}
            <div className="pay-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => act(() => api.requests.confirmPayment(tripId, true))}
              >
                Mark {amount} received in cash
              </button>
            </div>
            <p className="pay-note">Waiting for the rider to pay…</p>
          </>
        )}

        {error && <p className="form-error">{error}</p>}
      </section>
    );
  }

  // --- rider -------------------------------------------------------------
  if (payment.status === "paid") {
    return (
      <section className="pay-panel">
        <span className="eyebrow">PAYMENT</span>
        <h3>
          You marked {amount} as paid by {how}.
        </h3>
        <p className="pay-note">Waiting for {payment.driverName} to confirm they received it…</p>
        {error && <p className="form-error">{error}</p>}
      </section>
    );
  }

  return (
    <section className="pay-panel">
      <span className="eyebrow">PAY FOR YOUR RIDE</span>
      <h3>
        Pay {payment.driverName} {amount}
      </h3>

      {payment.recommended && (
        <p className="pay-recommend">
          <b>Best way: {METHOD_LABEL[payment.recommended.method].toUpperCase()}</b> ·{" "}
          {payment.recommended.reason}
        </p>
      )}

      <div className="pay-options" role="radiogroup" aria-label="Payment method">
        <button
          type="button"
          role="radio"
          aria-checked={method === "upi"}
          className={`pay-option ${method === "upi" ? "is-on" : ""}`}
          disabled={!payment.driverUpi}
          onClick={() => setChoice("upi")}
        >
          <strong>📱 Pay now · UPI</strong>
          <small>{payment.driverUpi ? "GPay, PhonePe, Paytm, BHIM" : "Driver has no UPI ID yet"}</small>
          {payment.recommended?.method === "upi" && <em>Recommended</em>}
        </button>

        <button
          type="button"
          role="radio"
          aria-checked={method === "cash"}
          className={`pay-option ${method === "cash" ? "is-on" : ""}`}
          onClick={() => setChoice("cash")}
        >
          <strong>💵 Cash</strong>
          <small>Hand it over in person</small>
          {payment.recommended?.method === "cash" && <em>Recommended</em>}
        </button>
      </div>

      {method === "upi" && link ? (
        <div className="pay-upi">
          <a className="primary-button pay-upi-open" href={link}>
            Open UPI app · pay {amount}
          </a>

          <div className="pay-upi-row">
            {qr && <img className="pay-qr" src={qr} alt={`UPI QR code to pay ${amount}`} />}
            <div>
              <small>ON A COMPUTER? SCAN WITH YOUR PHONE, OR PAY TO</small>
              <div className="pay-upi-id">
                <code>{payment.driverUpi}</code>
                <button type="button" className="text-button" onClick={copyUpi}>
                  {copied ? "Copied ✓" : "Copy"}
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => act(() => api.requests.pay(tripId, "upi"))}
          >
            {busy ? "Saving…" : `I've paid ${amount} by UPI`}
          </button>
        </div>
      ) : (
        <div className="pay-cash">
          <p className="pay-note">Hand {payment.driverName} {amount} in cash, then let them know here.</p>
          <button
            type="button"
            className="primary-button"
            disabled={busy}
            onClick={() => act(() => api.requests.pay(tripId, "cash"))}
          >
            {busy ? "Saving…" : `I've paid ${amount} in cash`}
          </button>
        </div>
      )}

      {error && <p className="form-error">{error}</p>}
    </section>
  );
}
