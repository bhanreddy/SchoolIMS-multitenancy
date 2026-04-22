import sql from './db.js';

async function test() {
  try {
    const routes = await sql`
      SELECT
        r.id, r.name, r.name_te, r.code, r.description, r.start_point, r.end_point,
        r.total_stops, r.monthly_fee, r.is_active, r.direction, r.bus_id,
        b.bus_no,
        COUNT(DISTINCT ts.id) AS stop_count,
        COUNT(DISTINCT st.id) AS student_count,
        MAX(dp.display_name) AS route_driver_name,
        MAX(dra.driver_id::text) AS route_driver_id
      FROM transport_routes r
      LEFT JOIN buses b ON r.bus_id = b.id
      LEFT JOIN transport_stops ts ON ts.route_id = r.id AND ts.deleted_at IS NULL
      LEFT JOIN student_transport st ON st.route_id = r.id AND st.is_active = true
      LEFT JOIN driver_route_assignments dra ON dra.route_id = r.id
        AND dra.school_id = 1
        AND dra.is_active = TRUE
        AND dra.deleted_at IS NULL
      LEFT JOIN staff drv ON drv.id = dra.driver_id AND drv.school_id = 1
      LEFT JOIN persons dp ON dp.id = drv.person_id
      WHERE r.school_id = 1 
      GROUP BY r.id, b.bus_no
      ORDER BY r.name
    `;
    console.log('Success!', routes.length);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
test();
