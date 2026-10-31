const express = require('express');
const { db } = require('../db');
const { campusTotals } = require('../memberStats');

const router = express.Router();
const VIBES = ['music', 'chatty', 'quiet', 'study', 'chai'];

function unique(values) { return [...new Set((values || []).filter(Boolean))]; }

async function acceptedTrips(userId) {
  const { data: asRider } = await db
    .from('trip_requests')
    .select('id, ride_id, rider_id, status')
    .eq('rider_id', userId)
    .eq('status', 'accepted');
  const rideIds = unique((asRider || []).map(x => x.ride_id));
  let driverRides = [];
  if (rideIds.length) {
    const { data } = await db.from('rides').select('id, driver_id, pickup, dropoff, date, time, vibe, distance_meters').in('id', rideIds);
    driverRides = data || [];
  }
  const { data: asDriver } = await db.from('rides').select('id, driver_id, pickup, dropoff, date, time, vibe, distance_meters').eq('driver_id', userId);
  const allRides = [...driverRides, ...(asDriver || [])];
  const allRideIds = unique(allRides.map(r => r.id));
  let accepted = [];
  if (allRideIds.length) {
    const { data } = await db.from('trip_requests').select('id, ride_id, rider_id, status').eq('status', 'accepted').in('ride_id', allRideIds);
    accepted = data || [];
  }
  return { rides: allRides, accepted };
}

router.get('/overview', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [{ data: profile }, trips, { data: wall }, { data: activeRides }] = await Promise.all([
      db.from('profiles').select('id,name,role,course,pickup_point,vehicle,vehicle_number,capacity').eq('id', userId).maybeSingle(),
      acceptedTrips(userId),
      db.from('campus_wall_posts').select('id,body,created_at,author_id').order('created_at', { ascending: false }).limit(12),
      db.from('rides').select('id,driver_id,driver_name,pickup,dropoff,date,time,seats,vibe,distance_meters').or(`departs_at.gte.${new Date().toISOString()},departs_at.is.null`).order('created_at', { ascending: false }).limit(12),
    ]);

    const peopleIds = unique([
      ...(wall || []).map(p => p.author_id),
      ...trips.accepted.map(r => r.rider_id),
      ...trips.rides.map(r => r.driver_id),
    ]);
    const { data: people } = peopleIds.length ? await db.from('profiles').select('id,name,role,course').in('id', peopleIds) : { data: [] };
    const personMap = Object.fromEntries((people || []).map(p => [p.id, p]));

    const connections = new Set();
    for (const r of trips.accepted) {
      if (r.rider_id !== userId) connections.add(r.rider_id);
    }
    for (const r of trips.rides) {
      if (r.driver_id !== userId) connections.add(r.driver_id);
    }

    const acceptedCount = trips.accepted.length;
    const rideCount = trips.rides.length;
    const connectionCount = connections.size;
    const badges = [];
    if (acceptedCount >= 10) badges.push({ key: 'road-warrior', icon: '🛣️', name: 'Road Warrior', note: '10 shared rides' });
    if (connectionCount >= 5) badges.push({ key: 'connector', icon: '🤝', name: 'Connector', note: '5 campus connections' });
    if (rideCount >= 5) badges.push({ key: 'campus-explorer', icon: '🗺️', name: 'Campus Explorer', note: '5 rides offered' });
    if (acceptedCount + rideCount >= 15) badges.push({ key: 'green-hopper', icon: '🌱', name: 'Green Hopper', note: '15 shared commutes' });
    if (!badges.length) badges.push({ key: 'first-hop', icon: '✦', name: 'First Hop', note: 'Your CampusHop story starts here' });

    const wallOut = (wall || []).map(p => ({
      ...p,
      author: personMap[p.author_id] || { name: 'CampusHop member', course: null },
      // Any signed-in member can take any note down.
      canDelete: true,
    }));
    const network = [...connections].slice(0, 8).map(id => personMap[id]).filter(Boolean);

    const profileText = `${profile?.pickup_point || ''} ${profile?.course || ''}`.toLowerCase();
    const suggestions = (activeRides || []).filter(r => r.driver_id !== userId).sort((a,b) => {
      const aScore = `${a.pickup} ${a.dropoff}`.toLowerCase().includes(profileText.split(' ')[0] || '__') ? 1 : 0;
      const bScore = `${b.pickup} ${b.dropoff}`.toLowerCase().includes(profileText.split(' ')[0] || '__') ? 1 : 0;
      return bScore - aScore;
    }).slice(0, 3);

    // A transparent estimate, not a claim of measured emissions: 0.18 kg/km
    // is used as a simple illustrative car baseline and is shown as an estimate.
    const totalKm = trips.rides.reduce((sum, r) => sum + (Number(r.distance_meters) || 0), 0) / 1000;
    const estimatedCo2 = Math.round(totalKm * 0.18 * 10) / 10;

    res.json({
      profile: profile || req.user,
      stats: { sharedRides: acceptedCount, connections: connectionCount, ridesOffered: rideCount, estimatedCo2Kg: estimatedCo2 },
      badges,
      network,
      wall: wallOut,
      suggestions,
    });
  } catch (err) { next(err); }
});

router.post('/wall', async (req, res, next) => {
  try {
    const body = String(req.body?.body || '').trim();
    if (!body || body.length > 280) return res.status(400).json({ error: 'Keep your campus note between 1 and 280 characters.' });
    const { data, error } = await db.from('campus_wall_posts').insert({ author_id: req.user.id, body }).select('id,body,created_at,author_id').single();
    if (error) throw error;
    res.status(201).json({ post: { ...data, canDelete: true, author: { name: req.user.name, course: req.user.course || null, role: req.user.role } } });
  } catch (err) { next(err); }
});

// Taking a note off the wall. Any signed-in member can remove any note.
router.delete('/wall/:id', async (req, res, next) => {
  try {
    const { data: post, error } = await db.from('campus_wall_posts').select('id,author_id').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!post) return res.status(404).json({ error: 'That note is already gone.' });
    const { error: deleteError } = await db.from('campus_wall_posts').delete().eq('id', post.id);
    if (deleteError) throw deleteError;
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// The campus-wide numbers: km travelled, rides completed, riders carried.
router.get('/stats', async (req, res, next) => {
  try { res.json({ campus: await campusTotals() }); }
  catch (err) { next(err); }
});

router.get('/rides/:id/people', async (req, res, next) => {
  try {
    const { data: ride } = await db.from('rides').select('id,driver_id').eq('id', req.params.id).maybeSingle();
    if (!ride) return res.status(404).json({ error: 'Ride not found.' });
    const { data: requests } = await db.from('trip_requests').select('rider_id').eq('ride_id', ride.id).eq('status', 'accepted');
    const ids = unique([ride.driver_id, ...(requests || []).map(r => r.rider_id)]);
    const { data: people } = ids.length ? await db.from('profiles').select('id,name,role,course').in('id', ids) : { data: [] };
    res.json({ people: (people || []).map(p => ({ ...p, isDriver: p.id === ride.driver_id })) });
  } catch (err) { next(err); }
});

module.exports = { router, VIBES };
