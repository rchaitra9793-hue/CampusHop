const express = require('express');
const { db } = require('../db');
const { requireAdmin } = require('../admin');
const { invalidateUser } = require('../auth');
const { ratingsFor } = require('../ratings');

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

async function record(adminId, action, targetId, note) {
  const { error } = await db.from('admin_actions').insert({
    admin_id: adminId,
    action,
    target_id: targetId || null,
    note: note ? String(note).slice(0, 1000) : null,
  });
  if (error) console.error('Admin audit log failed:', error.message);
}

async function namedProfilesDetailed(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return {};
  const { data, error } = await db.from('profiles')
    .select('id,name,email,role,vehicle,vehicle_number,phone,is_admin,suspended_at,suspended_reason')
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
      db.from('safety_reports').select('id,request_id,ride_id,reporter_id,subject_id,category,details,status,created_at,resolution,resolved_at,resolved_by').order('created_at', { ascending: false }).limit(8),
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
      .select('id,name,email,role,vehicle,vehicle_number,phone,pickup_point,capacity,is_admin,suspended_at,suspended_reason')
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
    let query = db.from('safety_reports').select('id,request_id,ride_id,reporter_id,subject_id,category,details,status,created_at,resolution,resolved_at,resolved_by').order('created_at', { ascending: false }).limit(100);
    if (status && ['open', 'reviewing', 'resolved', 'dismissed'].includes(status)) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;

    const profiles = await namedProfiles((data || []).flatMap((r) => [r.reporter_id, r.subject_id]));
    const rideIds = [...new Set((data || []).map((r) => r.ride_id).filter(Boolean))];
    const { data: rideRows, error: rideError } = rideIds.length
      ? await db.from('rides').select('id,pickup,dropoff,date,time,driver_id,vehicle,trip_status').in('id', rideIds)
      : { data: [], error: null };
    if (rideError) throw rideError;
    const rides = Object.fromEntries((rideRows || []).map((r) => [r.id, r]));
    res.json({ reports: (data || []).map((r) => ({ ...r, reporter: profiles[r.reporter_id] || null, subject: profiles[r.subject_id] || null, ride: rides[r.ride_id] || null })) });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/admin/reports/:id — investigate, resolve or dismiss a case. */
router.patch('/reports/:id', async (req, res, next) => {
  try {
    const status = clean(req.body?.status);
    const note = clean(req.body?.note);
    if (!['open', 'reviewing', 'resolved', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid report status.' });
    }
    if ((status === 'resolved' || status === 'dismissed') && !note) {
      return res.status(400).json({ error: 'Add a resolution note before closing the case.' });
    }

    const payload = { status };
    if (status === 'resolved' || status === 'dismissed') {
      payload.resolution = note;
      payload.resolved_at = new Date().toISOString();
      payload.resolved_by = req.user.id;
    } else {
      payload.resolution = null;
      payload.resolved_at = null;
      payload.resolved_by = null;
    }

    let data;
    let error;
    ({ data, error } = await db.from('safety_reports').update(payload).eq('id', req.params.id)
      .select('id,request_id,ride_id,reporter_id,subject_id,category,details,status,created_at,resolution,resolved_at,resolved_by').maybeSingle());

    // Keep the dashboard usable if an older database has not applied 011 yet.
    if (error && /resolution|resolved_at|resolved_by/i.test(error.message || '')) {
      ({ data, error } = await db.from('safety_reports').update({ status }).eq('id', req.params.id)
        .select('id,request_id,ride_id,reporter_id,subject_id,category,details,status,created_at').maybeSingle());
    }
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Report not found.' });

    await record(req.user.id, 'report.status', data.id, `${status}${note ? `: ${note}` : ''}`);
    const profiles = await namedProfilesDetailed([data.reporter_id, data.subject_id]);
    res.json({ report: { ...data, reporter: profiles[data.reporter_id] || null, subject: profiles[data.subject_id] || null } });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/users/:id — one member's moderation history. */
router.get('/users/:id', async (req, res, next) => {
  try {
    const { data: profile, error } = await db.from('profiles')
      .select('id,name,email,role,vehicle,vehicle_number,phone,is_admin,suspended_at,suspended_reason')
      .eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!profile) return res.status(404).json({ error: 'Member not found.' });

    const [against, filed, rides, actions] = await Promise.all([
      db.from('safety_reports').select('id,category,details,status,created_at,reporter_id,resolution,resolved_at').eq('subject_id', profile.id).order('created_at', { ascending: false }),
      db.from('safety_reports').select('id,category,status,created_at,subject_id').eq('reporter_id', profile.id).order('created_at', { ascending: false }),
      db.from('rides').select('id,pickup,dropoff,date,time,seats,trip_status,vehicle').eq('driver_id', profile.id).order('created_at', { ascending: false }).limit(20),
      db.from('admin_actions').select('id,action,note,created_at,admin_id').eq('target_id', profile.id).order('created_at', { ascending: false }).limit(50),
    ]);
    for (const result of [against, filed, rides, actions]) if (result.error) throw result.error;

    const people = await namedProfilesDetailed([...(against.data || []).map(r => r.reporter_id), ...(filed.data || []).map(r => r.subject_id), ...(actions.data || []).map(a => a.admin_id)]);
    const reportRideIds = [...new Set((against.data || []).map(r => r.ride_id).filter(Boolean))];
    const { data: reportRides, error: reportRidesError } = reportRideIds.length
      ? await db.from('rides').select('id,pickup,dropoff,date,time,driver_id,vehicle,trip_status').in('id', reportRideIds)
      : { data: [], error: null };
    if (reportRidesError) throw reportRidesError;
    const reportRideMap = Object.fromEntries((reportRides || []).map(r => [r.id, r]));
    const ratings = await ratingsFor([profile.id]);
    const history = (actions.data || []).map(a => ({ ...a, at: a.created_at, by: people[a.admin_id]?.name || 'Unknown' }));
    const warnings = history.filter(a => a.action === 'user.warn').length;

    res.json({
      user: { ...profile, isAdmin: profile.is_admin === true, suspended: Boolean(profile.suspended_at), suspendedAt: profile.suspended_at, suspendedReason: profile.suspended_reason, rating: ratings[profile.id]?.average ?? null, ratingCount: ratings[profile.id]?.count ?? 0, warnings },
      reportsAgainst: (against.data || []).map(r => ({ ...r, at: r.created_at, reporter: people[r.reporter_id] || null, ride: reportRideMap[r.ride_id] || null })),
      reportsFiled: (filed.data || []).map(r => ({ ...r, at: r.created_at, subject: r.subject_id ? people[r.subject_id] || null : null })),
      rides: rides.data || [],
      history,
    });
  } catch (err) { next(err); }
});

/** POST /api/admin/users/:id/warn — issue a documented warning. */
router.post('/users/:id/warn', async (req, res, next) => {
  try {
    const reason = clean(req.body?.reason);
    if (!reason) return res.status(400).json({ error: 'Say why this member is being warned.' });
    if (reason.length > 1000) return res.status(400).json({ error: 'Keep the warning under 1000 characters.' });
    const { data: target, error } = await db.from('profiles').select('id,name,is_admin').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!target) return res.status(404).json({ error: 'Member not found.' });
    if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot warn your own account.' });
    if (target.is_admin) return res.status(400).json({ error: 'Administrators cannot be warned from this dashboard.' });
    await record(req.user.id, 'user.warn', target.id, reason);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/** POST /api/admin/users/:id/suspend */
router.post('/users/:id/suspend', async (req, res, next) => {
  try {
    const reason = clean(req.body?.reason);
    if (!reason) return res.status(400).json({ error: 'Say why this member is being suspended.' });
    const { data: target, error } = await db.from('profiles').select('id,name,is_admin').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!target) return res.status(404).json({ error: 'Member not found.' });
    if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot suspend your own account.' });
    if (target.is_admin) return res.status(400).json({ error: 'Administrators cannot be suspended here.' });
    const { error: updateError } = await db.from('profiles').update({ suspended_at: new Date().toISOString(), suspended_reason: reason }).eq('id', target.id);
    if (updateError) throw updateError;
    invalidateUser(target.id);
    await record(req.user.id, 'user.suspend', target.id, reason);
    res.json({ ok: true, suspended: true });
  } catch (err) { next(err); }
});

/** POST /api/admin/users/:id/reinstate */
router.post('/users/:id/reinstate', async (req, res, next) => {
  try {
    const note = clean(req.body?.note);
    const { data: target, error } = await db.from('profiles').select('id,suspended_at').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!target) return res.status(404).json({ error: 'Member not found.' });
    if (!target.suspended_at) return res.status(400).json({ error: 'That member is not suspended.' });
    const { error: updateError } = await db.from('profiles').update({ suspended_at: null, suspended_reason: null }).eq('id', target.id);
    if (updateError) throw updateError;
    invalidateUser(target.id);
    await record(req.user.id, 'user.reinstate', target.id, note || null);
    res.json({ ok: true, suspended: false });
  } catch (err) { next(err); }
});

/** DELETE /api/admin/rides/:id — remove a problematic ride with a reason. */
router.delete('/rides/:id', async (req, res, next) => {
  try {
    const reason = clean(req.body?.reason);
    if (!reason) return res.status(400).json({ error: 'Say why this ride is being removed.' });
    const { data: ride, error: rideError } = await db.from('rides').select('id,driver_id,driver_name,pickup,dropoff,date,time').eq('id', req.params.id).maybeSingle();
    if (rideError) throw rideError;
    if (!ride) return res.status(404).json({ error: 'Ride not found.' });
    const { data: riders } = await db.from('trip_requests').select('rider_id,status').eq('ride_id', ride.id);
    const affected = (riders || []).filter(r => r.status === 'accepted').length;
    const { error: requestError } = await db.from('trip_requests').delete().eq('ride_id', ride.id);
    if (requestError) throw requestError;
    const { error } = await db.from('rides').delete().eq('id', ride.id);
    if (error) throw error;
    await record(req.user.id, 'ride.delete', ride.id, `${ride.pickup} -> ${ride.dropoff} by ${ride.driver_name}; ${reason}${affected ? `; ${affected} accepted rider(s) affected` : ''}`);
    res.json({ ok: true, ridersAffected: affected });
  } catch (err) { next(err); }
});

module.exports = { router };
