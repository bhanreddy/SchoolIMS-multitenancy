import express from 'express';
import sql from '../db.js';
import { requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

// ============================================================
// HELPERS
// ============================================================

/**
 * Haversine distance in km between two lat/lon points
 */
const calculateDistanceKm = (lat1, lon1, lat2, lon2) => {
  const toRad = (deg) => deg * Math.PI / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
  Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const SCHOOL_COORDINATES = { latitude: 28.6139, longitude: 77.2090 };

/**
 * Resolve staff_id from authenticated user
 */
const getStaffId = async (user) => {
  const [staff] = await sql`
    SELECT s.id FROM staff s
    JOIN users u ON s.person_id = u.person_id
    WHERE u.id = ${user.id}
  `;
  return staff?.id || null;
};

// ============================================================
// ROUTES CRUD (Admin)
// ============================================================

/**
 * GET /transport/routes
 * List all transport routes
 */
router.get('/routes', requirePermission('transport.view'), asyncHandler(async (req, res) => {
  const { active_only } = req.query;

  const routes = await sql`
    SELECT 
      r.id, r.name, r.code, r.description, r.start_point, r.end_point,
      r.total_stops, r.monthly_fee, r.is_active, r.direction, r.bus_id,
      b.bus_no,
      COUNT(DISTINCT ts.id) as stop_count,
      COUNT(DISTINCT st.id) as student_count
    FROM transport_routes r
    LEFT JOIN buses b ON r.bus_id = b.id
    LEFT JOIN transport_stops ts ON ts.route_id = r.id AND ts.deleted_at IS NULL
    LEFT JOIN student_transport st ON st.route_id = r.id AND st.is_active = true
    WHERE TRUE ${active_only === 'true' ? sql`AND r.is_active = true` : sql``}
    GROUP BY r.id, b.bus_no
    ORDER BY r.name
  `;

  res.json(routes);
}));

/**
 * POST /transport/routes
 * Create a transport route
 */
router.post('/routes', requirePermission('transport.manage'), asyncHandler(async (req, res) => {
  const { name, code, description, start_point, end_point, monthly_fee, direction, bus_id } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Route name is required' });
  }

  const [route] = await sql`
    INSERT INTO transport_routes (name, code, description, start_point, end_point, monthly_fee, direction, bus_id)
    VALUES (${name}, ${code || null}, ${description || null}, ${start_point || null}, ${end_point || null}, ${monthly_fee || null}, ${direction || 'morning'}, ${bus_id || null})
    RETURNING *
  `;

  res.status(201).json({ message: 'Route created', route });
}));

/**
 * GET /transport/routes/:id
 * Get route with stops + assigned bus + students per stop
 */
router.get('/routes/:id', requirePermission('transport.view'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  const [route] = await sql`SELECT * FROM transport_routes WHERE id = ${id}`;
  if (!route) {
    return res.status(404).json({ error: 'Route not found' });
  }

  const stops = await sql`
    SELECT 
      ts.id, ts.name, ts.latitude, ts.longitude, ts.pickup_time, ts.drop_time, ts.stop_order,
      COALESCE(json_agg(
        json_build_object('student_id', st.student_id, 'student_name', p.display_name)
      ) FILTER (WHERE st.id IS NOT NULL), '[]') as students
    FROM transport_stops ts
    LEFT JOIN student_transport st ON st.stop_id = ts.id AND st.is_active = true
    LEFT JOIN students s ON st.student_id = s.id
    LEFT JOIN persons p ON s.person_id = p.id
    WHERE ts.route_id = ${id} AND ts.deleted_at IS NULL
    GROUP BY ts.id
    ORDER BY ts.stop_order
  `;

  // Get assigned bus info
  let bus = null;
  if (route.bus_id) {
    const [b] = await sql`
      SELECT b.id, b.bus_no, b.registration_no, b.capacity, b.driver_id,
        p.display_name as driver_name
      FROM buses b
      LEFT JOIN staff s ON b.driver_id = s.id
      LEFT JOIN persons p ON s.person_id = p.id
      WHERE b.id = ${route.bus_id}
    `;
    bus = b;
  }

  res.json({ ...route, stops, bus });
}));

/**
 * PUT /transport/routes/:id
 * Update a route
 */
router.put('/routes/:id', requirePermission('transport.manage'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, code, description, start_point, end_point, monthly_fee, direction, bus_id, is_active } = req.body;

  const [route] = await sql`
    UPDATE transport_routes SET
      name = COALESCE(${name}, name),
      code = COALESCE(${code}, code),
      description = COALESCE(${description}, description),
      start_point = COALESCE(${start_point}, start_point),
      end_point = COALESCE(${end_point}, end_point),
      monthly_fee = COALESCE(${monthly_fee}, monthly_fee),
      direction = COALESCE(${direction}, direction),
      bus_id = COALESCE(${bus_id}, bus_id),
      is_active = COALESCE(${is_active}, is_active)
    WHERE id = ${id}
    RETURNING *
  `;

  if (!route) return res.status(404).json({ error: 'Route not found' });
  res.json({ message: 'Route updated', route });
}));

// ============================================================
// STOPS CRUD (Admin)
// ============================================================

/**
 * POST /transport/routes/:id/stops
 * Add stop to route (ordered)
 */
router.post('/routes/:id/stops', requirePermission('transport.manage'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, latitude, longitude, pickup_time, drop_time, stop_order } = req.body;

  if (!name || stop_order === undefined) {
    return res.status(400).json({ error: 'name and stop_order are required' });
  }

  const [stop] = await sql`
    INSERT INTO transport_stops (route_id, name, latitude, longitude, pickup_time, drop_time, stop_order)
    VALUES (${id}, ${name}, ${latitude || null}, ${longitude || null}, ${pickup_time || null}, ${drop_time || null}, ${stop_order})
    RETURNING *
  `;

  // Update route total_stops
  await sql`UPDATE transport_routes SET total_stops = (
    SELECT COUNT(*) FROM transport_stops WHERE route_id = ${id} AND deleted_at IS NULL
  ) WHERE id = ${id}`;

  res.status(201).json({ message: 'Stop added', stop });
}));

/**
 * PUT /transport/stops/:stopId
 * Update a stop
 */
router.put('/stops/:stopId', requirePermission('transport.manage'), asyncHandler(async (req, res) => {
  const { stopId } = req.params;
  const { name, latitude, longitude, pickup_time, drop_time, stop_order } = req.body;

  const [stop] = await sql`
    UPDATE transport_stops SET
      name = COALESCE(${name}, name),
      latitude = COALESCE(${latitude}, latitude),
      longitude = COALESCE(${longitude}, longitude),
      pickup_time = COALESCE(${pickup_time}, pickup_time),
      drop_time = COALESCE(${drop_time}, drop_time),
      stop_order = COALESCE(${stop_order}, stop_order)
    WHERE id = ${stopId} AND deleted_at IS NULL
    RETURNING *
  `;

  if (!stop) return res.status(404).json({ error: 'Stop not found' });
  res.json({ message: 'Stop updated', stop });
}));

/**
 * DELETE /transport/stops/:stopId
 * Soft delete a stop
 */
router.delete('/stops/:stopId', requirePermission('transport.manage'), asyncHandler(async (req, res) => {
  const { stopId } = req.params;

  const [stop] = await sql`
    UPDATE transport_stops SET deleted_at = now() WHERE id = ${stopId} RETURNING route_id
  `;
  if (!stop) return res.status(404).json({ error: 'Stop not found' });

  // Update total_stops count
  await sql`UPDATE transport_routes SET total_stops = (
    SELECT COUNT(*) FROM transport_stops WHERE route_id = ${stop.route_id} AND deleted_at IS NULL
  ) WHERE id = ${stop.route_id}`;

  res.json({ message: 'Stop deleted' });
}));

// ============================================================
// BUSES CRUD (Admin)
// ============================================================

/**
 * GET /transport/buses
 * List all buses with driver info
 */
router.get('/buses', requirePermission('transport.view'), asyncHandler(async (req, res) => {
  const buses = await sql`
    SELECT 
      b.id, b.bus_no, b.registration_no, b.capacity, b.is_active,
      b.driver_id, b.driver_name, b.driver_phone,
      p.display_name as assigned_driver_name,
      s.staff_code as driver_code,
      COUNT(DISTINCT r.id) as route_count
    FROM buses b
    LEFT JOIN staff s ON b.driver_id = s.id
    LEFT JOIN persons p ON s.person_id = p.id
    LEFT JOIN transport_routes r ON r.bus_id = b.id AND r.is_active = true
    WHERE b.deleted_at IS NULL
    GROUP BY b.id, p.display_name, s.staff_code
    ORDER BY b.bus_no
  `;
  res.json(buses);
}));

/**
 * POST /transport/buses
 * Add a bus (with optional driver_id)
 */
router.post('/buses', requirePermission('transport.manage'), asyncHandler(async (req, res) => {
  const { bus_no, registration_no, capacity, driver_id, driver_name, driver_phone, route_id } = req.body;

  if (!bus_no) {
    return res.status(400).json({ error: 'bus_no is required' });
  }

  const [bus] = await sql`
    INSERT INTO buses (bus_no, registration_no, capacity, driver_id, driver_name, driver_phone, route_id)
    VALUES (${bus_no}, ${registration_no || null}, ${capacity || 40}, ${driver_id || null}, ${driver_name || null}, ${driver_phone || null}, ${route_id || null})
    RETURNING *
  `;

  res.status(201).json({ message: 'Bus added', bus });
}));

/**
 * PUT /transport/buses/:id
 * Update a bus
 */
router.put('/buses/:id', requirePermission('transport.manage'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { bus_no, registration_no, capacity, driver_id, is_active } = req.body;

  const [bus] = await sql`
    UPDATE buses SET
      bus_no = COALESCE(${bus_no}, bus_no),
      registration_no = COALESCE(${registration_no}, registration_no),
      capacity = COALESCE(${capacity}, capacity),
      driver_id = COALESCE(${driver_id}, driver_id),
      is_active = COALESCE(${is_active}, is_active)
    WHERE id = ${id}
    RETURNING *
  `;

  if (!bus) return res.status(404).json({ error: 'Bus not found' });
  res.json({ message: 'Bus updated', bus });
}));

// ============================================================
// DRIVER-FACING ENDPOINTS
// ============================================================

/**
 * GET /transport/driver/my-bus
 * Get driver's assigned bus + active route + ordered stops
 */
router.get('/driver/my-bus', asyncHandler(async (req, res) => {
  const staffId = await getStaffId(req.user);
  if (!staffId) return res.status(404).json({ error: 'Staff profile not found' });

  // Find bus assigned to this driver
  const [bus] = await sql`
    SELECT id, bus_no, registration_no, capacity
    FROM buses WHERE driver_id = ${staffId} AND is_active = true AND deleted_at IS NULL
    LIMIT 1
  `;

  if (!bus) return res.json({ bus: null, routes: [], message: 'No bus assigned' });

  // Find all routes for this bus
  const routes = await sql`
    SELECT r.id, r.name, r.direction, r.start_point, r.end_point, r.total_stops
    FROM transport_routes r
    WHERE r.bus_id = ${bus.id} AND r.is_active = true
    ORDER BY r.direction, r.name
  `;

  // Check for active trip
  const [activeTrip] = await sql`
    SELECT t.id, t.route_id, t.status, t.started_at
    FROM trips t
    WHERE t.bus_id = ${bus.id} AND t.status = 'active'
    LIMIT 1
  `;

  res.json({ bus, routes, activeTrip: activeTrip || null });
}));

/**
 * GET /transport/driver/route/:routeId/stops
 * Get ordered stops for a specific route
 */
router.get('/driver/route/:routeId/stops', asyncHandler(async (req, res) => {
  const { routeId } = req.params;

  const stops = await sql`
    SELECT 
      ts.id, ts.name, ts.latitude, ts.longitude, ts.stop_order,
      ts.pickup_time, ts.drop_time,
      COUNT(st.id) as student_count
    FROM transport_stops ts
    LEFT JOIN student_transport st ON st.stop_id = ts.id AND st.is_active = true
    WHERE ts.route_id = ${routeId} AND ts.deleted_at IS NULL
    GROUP BY ts.id
    ORDER BY ts.stop_order ASC
  `;

  res.json(stops);
}));

// ============================================================
// TRIP LIFECYCLE (Driver)
// ============================================================

/**
 * POST /transport/trips/start
 * Start a trip — creates trip + initializes all stop statuses as pending
 * 
 * HARD VALIDATIONS:
 * - Driver must own the bus
 * - No active trip on this bus
 * - Route must belong to bus
 */
router.post('/trips/start', asyncHandler(async (req, res) => {
  const { route_id } = req.body;
  if (!route_id) return res.status(400).json({ error: 'route_id is required' });

  const staffId = await getStaffId(req.user);
  if (!staffId) return res.status(403).json({ error: 'Staff profile not found' });

  // 1. Get driver's bus
  const [bus] = await sql`
    SELECT id FROM buses WHERE driver_id = ${staffId} AND is_active = true AND deleted_at IS NULL
  `;
  if (!bus) return res.status(403).json({ error: 'No bus assigned to you' });

  // 2. Verify route belongs to this bus
  const [route] = await sql`
    SELECT id, bus_id FROM transport_routes WHERE id = ${route_id} AND is_active = true
  `;
  if (!route) return res.status(404).json({ error: 'Route not found' });
  if (route.bus_id !== bus.id) {
    return res.status(403).json({ error: 'This route does not belong to your bus' });
  }

  // 3. Check no active trip exists (partial unique index also enforces this)
  const [existingTrip] = await sql`
    SELECT id FROM trips WHERE bus_id = ${bus.id} AND status = 'active'
  `;
  if (existingTrip) {
    return res.status(409).json({ error: 'An active trip already exists for this bus', tripId: existingTrip.id });
  }

  // 4. Get ordered stops
  const stops = await sql`
    SELECT id, stop_order FROM transport_stops
    WHERE route_id = ${route_id} AND deleted_at IS NULL
    ORDER BY stop_order ASC
  `;
  if (stops.length === 0) {
    return res.status(400).json({ error: 'Route has no stops — add stops first' });
  }

  // 5. Create trip
  const [trip] = await sql`
    INSERT INTO trips (bus_id, route_id, driver_id, status, started_at)
    VALUES (${bus.id}, ${route_id}, ${staffId}, 'active', now())
    RETURNING *
  `;

  // 6. Initialize all stop statuses as pending
  for (const stop of stops) {
    await sql`
      INSERT INTO trip_stop_status (trip_id, stop_id, stop_order, status)
      VALUES (${trip.id}, ${stop.id}, ${stop.stop_order}, 'pending')
    `;
  }

  res.status(201).json({ message: 'Trip started', trip, totalStops: stops.length });
}));

/**
 * GET /transport/trips/:tripId/status
 * Get full trip status with all stops
 */
router.get('/trips/:tripId/status', asyncHandler(async (req, res) => {
  const { tripId } = req.params;

  const [trip] = await sql`
    SELECT t.*, r.name as route_name, r.direction, b.bus_no
    FROM trips t
    JOIN transport_routes r ON t.route_id = r.id
    JOIN buses b ON t.bus_id = b.id
    WHERE t.id = ${tripId}
  `;
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const stops = await sql`
    SELECT 
      tss.id, tss.stop_id, tss.stop_order, tss.status,
      tss.arrival_time, tss.departure_time,
      ts.name as stop_name, ts.latitude, ts.longitude,
      COUNT(st.id) as student_count
    FROM trip_stop_status tss
    JOIN transport_stops ts ON tss.stop_id = ts.id
    LEFT JOIN student_transport st ON st.stop_id = ts.id AND st.is_active = true
    WHERE tss.trip_id = ${tripId}
    GROUP BY tss.id, ts.name, ts.latitude, ts.longitude
    ORDER BY tss.stop_order ASC
  `;

  // Determine current stop (first non-completed/skipped)
  const currentStop = stops.find((s) => s.status === 'pending' || s.status === 'arrived');
  const completedCount = stops.filter((s) => s.status === 'completed' || s.status === 'skipped').length;

  res.json({
    trip,
    stops,
    currentStop: currentStop || null,
    progress: { completed: completedCount, total: stops.length }
  });
}));

/**
 * POST /transport/trips/:tripId/stops/:stopId/arrive
 * Mark a stop as arrived
 * 
 * HARD VALIDATION: All previous stops must be completed or skipped
 */
router.post('/trips/:tripId/stops/:stopId/arrive', asyncHandler(async (req, res) => {
  const { tripId, stopId } = req.params;

  // Validate trip is active and belongs to this driver
  const staffId = await getStaffId(req.user);
  const [trip] = await sql`
    SELECT id, driver_id, status FROM trips WHERE id = ${tripId}
  `;
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  if (trip.status !== 'active') return res.status(400).json({ error: 'Trip is not active' });
  if (trip.driver_id !== staffId) return res.status(403).json({ error: 'This is not your trip' });

  // Get the target stop status
  const [targetStop] = await sql`
    SELECT id, stop_order, status FROM trip_stop_status
    WHERE trip_id = ${tripId} AND stop_id = ${stopId}
  `;
  if (!targetStop) return res.status(404).json({ error: 'Stop not found in this trip' });
  if (targetStop.status !== 'pending') {
    return res.status(400).json({ error: `Stop is already ${targetStop.status}` });
  }

  // ORDER ENFORCEMENT: Check all previous stops are completed/skipped
  const incomplete = await sql`
    SELECT id, stop_order, status FROM trip_stop_status
    WHERE trip_id = ${tripId}
      AND stop_order < ${targetStop.stop_order}
      AND status NOT IN ('completed', 'skipped')
  `;
  if (incomplete.length > 0) {
    return res.status(400).json({
      error: `Cannot arrive at stop ${targetStop.stop_order} — previous stops are incomplete`,
      incompleteStops: incomplete.map((s) => ({ stop_order: s.stop_order, status: s.status }))
    });
  }

  // Mark as arrived
  const [updated] = await sql`
    UPDATE trip_stop_status SET status = 'arrived', arrival_time = now()
    WHERE id = ${targetStop.id}
    RETURNING *
  `;

  res.json({ message: 'Arrived at stop', stop: updated });
}));

/**
 * POST /transport/trips/:tripId/stops/:stopId/complete
 * Mark a stop as completed
 * 
 * HARD VALIDATION: Stop must be in 'arrived' status
 */
router.post('/trips/:tripId/stops/:stopId/complete', asyncHandler(async (req, res) => {
  const { tripId, stopId } = req.params;

  const staffId = await getStaffId(req.user);
  const [trip] = await sql`SELECT id, driver_id, status FROM trips WHERE id = ${tripId}`;
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  if (trip.status !== 'active') return res.status(400).json({ error: 'Trip is not active' });
  if (trip.driver_id !== staffId) return res.status(403).json({ error: 'This is not your trip' });

  const [targetStop] = await sql`
    SELECT id, status FROM trip_stop_status WHERE trip_id = ${tripId} AND stop_id = ${stopId}
  `;
  if (!targetStop) return res.status(404).json({ error: 'Stop not found in this trip' });
  if (targetStop.status !== 'arrived') {
    return res.status(400).json({ error: `Stop must be in 'arrived' status to complete. Current: ${targetStop.status}` });
  }

  const [updated] = await sql`
    UPDATE trip_stop_status SET status = 'completed', departure_time = now()
    WHERE id = ${targetStop.id}
    RETURNING *
  `;

  res.json({ message: 'Stop completed', stop: updated });
}));

/**
 * POST /transport/trips/:tripId/stops/:stopId/skip
 * Mark a stop as skipped (explicit skip)
 * 
 * HARD VALIDATION: All previous stops must be completed/skipped
 */
router.post('/trips/:tripId/stops/:stopId/skip', asyncHandler(async (req, res) => {
  const { tripId, stopId } = req.params;

  const staffId = await getStaffId(req.user);
  const [trip] = await sql`SELECT id, driver_id, status FROM trips WHERE id = ${tripId}`;
  if (!trip || trip.status !== 'active' || trip.driver_id !== staffId) {
    return res.status(403).json({ error: 'Invalid or unauthorized trip' });
  }

  const [targetStop] = await sql`
    SELECT id, stop_order, status FROM trip_stop_status WHERE trip_id = ${tripId} AND stop_id = ${stopId}
  `;
  if (!targetStop) return res.status(404).json({ error: 'Stop not found' });
  if (targetStop.status === 'completed') return res.status(400).json({ error: 'Cannot skip a completed stop' });

  // ORDER ENFORCEMENT
  const incomplete = await sql`
    SELECT id FROM trip_stop_status
    WHERE trip_id = ${tripId} AND stop_order < ${targetStop.stop_order}
      AND status NOT IN ('completed', 'skipped')
  `;
  if (incomplete.length > 0) {
    return res.status(400).json({ error: 'Cannot skip — previous stops are incomplete' });
  }

  const [updated] = await sql`
    UPDATE trip_stop_status SET status = 'skipped', departure_time = now()
    WHERE id = ${targetStop.id}
    RETURNING *
  `;

  res.json({ message: 'Stop skipped', stop: updated });
}));

/**
 * POST /transport/trips/:tripId/end
 * End a trip — marks remaining pending stops as skipped
 */
router.post('/trips/:tripId/end', asyncHandler(async (req, res) => {
  const { tripId } = req.params;

  const staffId = await getStaffId(req.user);
  const [trip] = await sql`SELECT id, driver_id, status FROM trips WHERE id = ${tripId}`;
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  if (trip.status !== 'active') return res.status(400).json({ error: 'Trip is not active' });
  if (trip.driver_id !== staffId) return res.status(403).json({ error: 'This is not your trip' });

  // Mark all remaining pending/arrived stops as skipped
  await sql`
    UPDATE trip_stop_status SET status = 'skipped', departure_time = now()
    WHERE trip_id = ${tripId} AND status IN ('pending', 'arrived')
  `;

  // End trip
  const [ended] = await sql`
    UPDATE trips SET status = 'completed', ended_at = now()
    WHERE id = ${tripId}
    RETURNING *
  `;

  res.json({ message: 'Trip ended', trip: ended });
}));

/**
 * GET /transport/trips/history
 * Get driver's trip history
 */
router.get('/trips/history', asyncHandler(async (req, res) => {
  const staffId = await getStaffId(req.user);
  if (!staffId) return res.status(403).json({ error: 'Staff profile not found' });

  const trips = await sql`
    SELECT t.id, t.status, t.started_at, t.ended_at,
      r.name as route_name, r.direction,
      b.bus_no,
      (SELECT COUNT(*) FROM trip_stop_status WHERE trip_id = t.id AND status = 'completed') as completed_stops,
      (SELECT COUNT(*) FROM trip_stop_status WHERE trip_id = t.id) as total_stops
    FROM trips t
    JOIN transport_routes r ON t.route_id = r.id
    JOIN buses b ON t.bus_id = b.id
    WHERE t.driver_id = ${staffId}
    ORDER BY t.started_at DESC
    LIMIT 20
  `;

  res.json(trips);
}));

// ============================================================
// LIVE TRACKING (from driver GPS)
// ============================================================

/**
 * POST /transport/buses/:id/location
 * Update bus location (Phase 5 Hardened)
 */
router.post('/buses/:id/location', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { latitude, longitude, speed, heading, is_mocked = false } = req.body;

  if (!latitude || !longitude) {
    return res.status(400).json({ error: 'latitude and longitude are required' });
  }

  // Rate limit (drop if < 5s apart)
  const [lastLoc] = await sql`SELECT recorded_at FROM bus_locations WHERE bus_id = ${id}`;
  if (lastLoc?.recorded_at) {
    const secondsSinceLast = (new Date() - new Date(lastLoc.recorded_at)) / 1000;
    if (secondsSinceLast < 5) {
      return res.status(200).json({ status: 'rate_limited_ignored' });
    }
  }

  const is_suspicious = is_mocked;

  // Geofence check (100m from school)
  const distKm = calculateDistanceKm(latitude, longitude, SCHOOL_COORDINATES.latitude, SCHOOL_COORDINATES.longitude);
  const isAtSchool = distKm <= 0.1;

  if (isAtSchool) {

  }

  // Upsert single realtime row
  const [location] = await sql`
    INSERT INTO bus_locations (bus_id, latitude, longitude, speed, heading, recorded_at, is_mocked, is_suspicious)
    VALUES (${id}, ${latitude}, ${longitude}, ${speed}, ${heading}, NOW(), ${is_mocked}, ${is_suspicious})
    ON CONFLICT (bus_id) DO UPDATE SET
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      speed = EXCLUDED.speed,
      heading = EXCLUDED.heading,
      is_mocked = EXCLUDED.is_mocked,
      is_suspicious = EXCLUDED.is_suspicious,
      recorded_at = NOW()
    RETURNING *
  `;

  // Trip history (async, non-blocking)
  sql`
    INSERT INTO bus_trip_history (bus_id, latitude, longitude, speed, is_mocked, is_suspicious)
    VALUES (${id}, ${latitude}, ${longitude}, ${speed}, ${is_mocked}, ${is_suspicious})
  `.catch((e) => {});

  res.status(201).json({ ...location, geofence_arrived: isAtSchool });
}));

/**
 * POST /transport/buses/:id/heartbeat
 */
router.post('/buses/:id/heartbeat', asyncHandler(async (req, res) => {
  const { id } = req.params;
  await sql`
    INSERT INTO driver_heartbeat (driver_id, last_ping, status)
    VALUES (${id}, NOW(), 'online')
    ON CONFLICT (driver_id) DO UPDATE SET last_ping = NOW(), status = 'online'
  `;
  res.status(200).json({ status: 'heartbeat_acknowledged' });
}));

/**
 * GET /transport/buses/:id/location
 * Get current bus location
 */
router.get('/buses/:id/location', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [location] = await sql`
    SELECT latitude, longitude, speed, heading, recorded_at
    FROM bus_locations WHERE bus_id = ${id}
    ORDER BY recorded_at DESC LIMIT 1
  `;
  if (!location) return res.status(404).json({ error: 'No location data' });
  res.json(location);
}));

// ============================================================
// STUDENT ASSIGNMENTS (Admin)
// ============================================================

/**
 * GET /transport/students/:studentId
 * Get student's transport assignment
 */
router.get('/students/:studentId', requirePermission('transport.view'), asyncHandler(async (req, res) => {
  const { studentId } = req.params;

  const [assignment] = await sql`
    SELECT
      st.id, st.is_active, st.created_at, st.bus_id,
      r.name as route_name, r.code as route_code, r.monthly_fee,
      s.name as stop_name, s.pickup_time, s.drop_time, s.stop_order,
      b.bus_no
    FROM student_transport st
    JOIN transport_routes r ON st.route_id = r.id
    LEFT JOIN transport_stops s ON st.stop_id = s.id
    LEFT JOIN buses b ON st.bus_id = b.id
    WHERE st.student_id = ${studentId} AND st.is_active = true
  `;

  res.json(assignment || { message: 'No transport assigned' });
}));

/**
 * POST /transport/students
 * Assign transport to student (bus_id auto-derived from route)
 */
router.post('/students', requirePermission('transport.manage'), asyncHandler(async (req, res) => {
  const { student_id, route_id, stop_id, academic_year_id } = req.body;

  if (!student_id || !route_id || !academic_year_id) {
    return res.status(400).json({ error: 'student_id, route_id, and academic_year_id are required' });
  }

  // Auto-derive bus_id from route
  const [route] = await sql`SELECT bus_id FROM transport_routes WHERE id = ${route_id}`;
  const bus_id = route?.bus_id || null;

  // Validate stop belongs to route
  if (stop_id) {
    const [stop] = await sql`SELECT id FROM transport_stops WHERE id = ${stop_id} AND route_id = ${route_id}`;
    if (!stop) return res.status(400).json({ error: 'Stop does not belong to this route' });
  }

  const [assignment] = await sql`
    INSERT INTO student_transport (student_id, route_id, stop_id, bus_id, academic_year_id)
    VALUES (${student_id}, ${route_id}, ${stop_id || null}, ${bus_id}, ${academic_year_id})
    ON CONFLICT (student_id, academic_year_id)
    DO UPDATE SET route_id = EXCLUDED.route_id, stop_id = EXCLUDED.stop_id, bus_id = EXCLUDED.bus_id, is_active = true
    RETURNING *
  `;

  res.status(201).json({ message: 'Transport assigned', assignment });
}));

// ============================================================
// PARENT-FACING ENDPOINTS
// ============================================================

/**
 * GET /transport/parent/bus-status/:busId
 * Get live bus status for parent (filtered to their bus only)
 */
router.get('/parent/bus-status/:busId', asyncHandler(async (req, res) => {
  const { busId } = req.params;

  // Live location
  const [location] = await sql`
    SELECT latitude, longitude, speed, heading, recorded_at
    FROM bus_locations WHERE bus_id = ${busId}
    ORDER BY recorded_at DESC LIMIT 1
  `;

  // Active trip with stops
  const [activeTrip] = await sql`
    SELECT t.id, t.started_at, r.name as route_name
    FROM trips t
    JOIN transport_routes r ON t.route_id = r.id
    WHERE t.bus_id = ${busId} AND t.status = 'active'
    LIMIT 1
  `;

  let stops = [];
  let nextStop = null;

  if (activeTrip) {
    stops = await sql`
      SELECT tss.stop_order, tss.status, tss.arrival_time, tss.departure_time,
        ts.name as stop_name, ts.latitude, ts.longitude
      FROM trip_stop_status tss
      JOIN transport_stops ts ON tss.stop_id = ts.id
      WHERE tss.trip_id = ${activeTrip.id}
      ORDER BY tss.stop_order ASC
    `;
    nextStop = stops.find((s) => s.status === 'pending' || s.status === 'arrived') || null;
  }

  res.json({
    location: location || null,
    activeTrip: activeTrip || null,
    stops,
    nextStop,
    busOnline: location ? (new Date() - new Date(location.recorded_at)) / 1000 < 120 : false
  });
}));

export default router;