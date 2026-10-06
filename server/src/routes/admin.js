const express = require('express');
const { db } = require('../db');
const { requireAdmin } = require('../admin');

const router = express.Router();
router.use(requireAdmin);

function clean(value) {
  return String(value || '').trim();
}

async function count(table, filter) {
  let q = db.from(table).select('*', { count: 'exact', head: true });
  if (filter) q = filter(q);
  const { count: value, error } = await q;
  if (error) throw error;
  return value || 0;
}

async function namedProfiles(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return {};
  const { data, error } = await db
    .from('profiles')
    .select('id,name,email,role,vehicle,vehicle_number,phone')
    .in('id', unique);
  if (error) throw error;
  return Object.fromEntries((data || []).map((p) => [p.id, p]));
}

/** GET /api/admin/overview — operational picture across the whole app. */
router.get('/overview', async (req, res, next) => {
  try {
    const now = new Date().toISOString();

    const [users, students, faculty, activeRides, pendingRequests, acceptedRequests, openReports, liveTrips, totalReports] = await Promise.all([
      count('profiles'),
      count('profiles', (q) => q.eq('role', 'student')),
      count('profiles', (q) => q.eq('role', 'faculty')),
      count('rides', (q) => q.gte('departs_at', now)),
      count('trip_requests', (q) => q.eq('status', 'pending')),
      count('trip_requests', (q) => q.eq('status', 'accepted')),
      count('safety_reports', (q) => q.eq('status', 'open')),
      count('rides', (q) => q.in('trip_status', ['to_pickup', 'arrived', 'started'])),
      count('safety_reports'),
    ]);

    const [{ data: reports, error: reportsError }, { data: rides, error: ridesError }, { data: requests, error: requestsError }] = await Promise.all([
      db.from('safety_reports').select('id,request_id,ride_id,reporter_id,subject_id,category,details,status,created_at').order('created_at', { ascending: false }).limit(8),
      db.from('rides').select('id,driver_id,driver_name,pickup,dropoff,date,time,seats,vehicle,trip_status,departs_at,created_at').order('created_at', { ascending: false }).limit(8),
      db.from('trip_requests').select('id,ride_id,rider_id,status,created_at').order('created_at', { ascending: false }).limit(8),
    ]);

    if (reportsError) throw reportsError;
    if (ridesError) throw ridesError;
    if (requestsError) throw requestsError;

    const ids = [
      ...(reports || []).flatMap((r) => [r.reporter_id, r.subject_id]),
      ...(rides || []).map((r) => r.driver_id),
      ...(requests || []).map((r) => r.rider_id),
    ];
    const profiles = await namedProfiles(ids);

    res.json({
      admin: req.user,
      stats: { users, students, faculty, activeRides, pendingRequests, acceptedRequests, openReports, liveTrips, totalReports },
      reports: (reports || []).map((r) => ({
        ...r,
        reporter: profiles[r.reporter_id] || null,
        subject: profiles[r.subject_id] || null,
      })),
      rides: (rides || []).map((r) => ({ ...r, driver: profiles[r.driver_id] || null })),
      requests: (requests || []).map((r) => ({ ...r, rider: profiles[r.rider_id] || null })),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/users?q= — searchable member directory. */
router.get('/users', async (req, res, next) => {
  try {
    const q = clean(req.query.q);
    let query = db
      .from('profiles')
      .select('id,name,email,role,vehicle,vehicle_number,phone,pickup_point,capacity')
      .order('name', { ascending: true })
      .limit(100);

    if (q) query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%`);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ users: data || [] });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/reports?status=open — moderation queue. */
router.get('/reports', async (req, res, next) => {
  try {
    const status = clean(req.query.status);
    let query = db.from('safety_reports').select('id,request_id,ride_id,reporter_id,subject_id,category,details,status,created_at').order('created_at', { ascending: false }).limit(100);
    if (status && ['open', 'reviewing', 'resolved', 'dismissed'].includes(status)) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;

    const profiles = await namedProfiles((data || []).flatMap((r) => [r.reporter_id, r.subject_id]));
    res.json({ reports: (data || []).map((r) => ({ ...r, reporter: profiles[r.reporter_id] || null, subject: profiles[r.subject_id] || null })) });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/admin/reports/:id — move a report through the moderation workflow. */
router.patch('/reports/:id', async (req, res, next) => {
  try {
    const status = clean(req.body?.status);
    if (!['open', 'reviewing', 'resolved', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid report status.' });
    }

    const { data, error } = await db
      .from('safety_reports')
      .update({ status })
      .eq('id', req.params.id)
      .select('id,request_id,ride_id,reporter_id,subject_id,category,details,status,created_at')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Report not found.' });

    const profiles = await namedProfiles([data.reporter_id, data.subject_id]);
    res.json({ report: { ...data, reporter: profiles[data.reporter_id] || null, subject: profiles[data.subject_id] || null } });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/admin/rides/:id — emergency removal of a ride from the board. */
router.delete('/rides/:id', async (req, res, next) => {
  try {
    const { data: ride, error: rideError } = await db.from('rides').select('id').eq('id', req.params.id).maybeSingle();
    if (rideError) throw rideError;
    if (!ride) return res.status(404).json({ error: 'Ride not found.' });

    const { error: requestError } = await db.from('trip_requests').delete().eq('ride_id', req.params.id);
    if (requestError) throw requestError;

    const { error } = await db.from('rides').delete().eq('id', req.params.id);
    if (error) throw error;

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = { router };
