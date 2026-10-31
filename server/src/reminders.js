const { db } = require("./db");
const config = require("./config");
const email = require("./email");
const { zone, departureInstant } = require("./expiry");
const { fareDetail } = require("./pricing");

// Departure-day reminder emails.
//
// On the day of a ride, the driver and every accepted rider get one email
// with the time, the route and who they are travelling with. It goes out at
// 7:00 campus time, or two hours before departure if that is earlier — and
// straight away for a seat accepted later than that on the same day.
//
// Each reminder is claimed in the database (reminder_sent_at) before it is
// sent, so two server processes or a restart never send it twice. A send
// that fails is un-claimed and tried again on the next pass.
//
// Needs db/014_payments_stats_reminders.sql for those columns. Until it is
// run, this does nothing — sending without a way to remember what was sent
// would email people on every pass.

const CHECK_EVERY_MS = 10 * 60 * 1000;
const LEAD_MS = 2 * 60 * 60 * 1000;

let warned = false;

function warnOnce(message) {
  if (warned) return;
  warned = true;
  console.warn(
    "\n  Departure reminders are off: " +
      message +
      "\n  Run db/014_payments_stats_reminders.sql in the Supabase SQL editor.\n"
  );
}

/** Today's date on the campus clock, as YYYY-MM-DD. */
function campusToday(now = Date.now()) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date(now));
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}

/** Whether the reminder for this ride is due right now. */
function due(ride, now) {
  const departure = departureInstant(ride);
  if (departure == null || departure <= now) return false;

  const morning = departureInstant({ date: ride.date, time: "07:00" });
  const sendFrom = Math.min(departure - LEAD_MS, morning ?? departure - LEAD_MS);

  return now >= sendFrom;
}

/** Claim a row's reminder; true when this process won it. */
async function claim(table, id) {
  const { data, error } = await db
    .from(table)
    .update({ reminder_sent_at: new Date().toISOString() })
    .eq("id", id)
    .is("reminder_sent_at", null)
    .select("id");

  if (error) throw error;
  return Boolean(data?.length);
}

async function release(table, id) {
  await db.from(table).update({ reminder_sent_at: null }).eq("id", id);
}

async function sendReminder(table, id, toUserId, build) {
  if (!(await claim(table, id))) return false;

  try {
    const to = await email.addressFor(toUserId);

    // No address on file: nothing to send, and nothing to retry.
    if (!to) return false;

    await email.deliver(to.email, build(to));
    return true;
  } catch (err) {
    console.error(`  Reminder email failed (${table} ${id}):`, err.message);
    await release(table, id);
    return false;
  }
}

async function sendDueReminders(now = Date.now()) {
  if (!email.enabled) return 0;

  const today = campusToday(now);

  const { data: rides, error } = await db
    .from("rides")
    .select("id, driver_id, pickup, dropoff, date, time, vehicle, distance_meters, departs_at, trip_status, reminder_sent_at")
    .eq("date", today)
    .neq("trip_status", "completed");

  if (error) {
    if (/reminder_sent_at/i.test(error.message || "") || error.code === "42703") {
      warnOnce("the reminder_sent_at columns are missing.");
      return 0;
    }
    throw error;
  }

  let sent = 0;

  for (const ride of rides || []) {
    if (!due(ride, now)) continue;

    const { data: seats, error: seatError } = await db
      .from("trip_requests")
      .select("id, rider_id, reminder_sent_at")
      .eq("ride_id", ride.id)
      .eq("status", "accepted");

    if (seatError) {
      if (/reminder_sent_at/i.test(seatError.message || "")) {
        warnOnce("the reminder_sent_at columns are missing.");
        return sent;
      }
      throw seatError;
    }

    // No confirmed riders, no trip to remind anyone about.
    if (!seats?.length) continue;

    const ids = [ride.driver_id, ...seats.map((s) => s.rider_id)];
    const { data: people } = await db
      .from("profiles")
      .select("id, name, phone, vehicle_number")
      .in("id", ids);

    const byId = new Map((people || []).map((p) => [p.id, p]));
    const driver = byId.get(ride.driver_id) || {};
    const fare = fareDetail(ride.vehicle, ride.distance_meters)?.amount ?? null;
    const riderNames = seats.map((s) => byId.get(s.rider_id)?.name || "a rider");

    if (!ride.reminder_sent_at) {
      const ok = await sendReminder("rides", ride.id, ride.driver_id, (to) =>
        email.templates.departureReminder({
          toName: to.name || driver.name || "there",
          role: "driver",
          ride,
          people: riderNames,
          fare,
          appUrl: config.appUrl,
        })
      );
      if (ok) sent++;
    }

    for (const seat of seats) {
      if (seat.reminder_sent_at) continue;

      const ok = await sendReminder("trip_requests", seat.id, seat.rider_id, (to) =>
        email.templates.departureReminder({
          toName: to.name || "there",
          role: "rider",
          ride,
          people: [driver.name || "Your driver"],
          vehicleNumber: driver.vehicle_number,
          driverPhone: driver.phone,
          fare,
          appUrl: config.appUrl,
        })
      );
      if (ok) sent++;
    }
  }

  return sent;
}

function startReminderSweeper() {
  const run = async () => {
    try {
      const sent = await sendDueReminders();
      if (sent) console.log(`  Sent ${sent} departure reminder${sent === 1 ? "" : "s"}.`);
    } catch (err) {
      console.warn(`  Departure reminder pass failed: ${err.message}`);
    }
  };

  run();

  const timer = setInterval(run, CHECK_EVERY_MS);
  timer.unref?.();

  return () => clearInterval(timer);
}

module.exports = { sendDueReminders, startReminderSweeper, due, campusToday };
