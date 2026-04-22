import sql from './db.js';

async function test() {
  const routeId = '21b0f150-a520-4776-a0fd-f5a2459d942a';
  const schoolId = 1;
  const limit = 500;

  try {
    console.log("Testing 1. GET /routes/:id/stops");
    const stops = await sql`
      SELECT id, name, stop_order, latitude, longitude, created_at
      FROM transport_stops
      WHERE route_id = ${routeId}
        AND school_id = ${schoolId}
        AND deleted_at IS NULL
      ORDER BY stop_order ASC
      LIMIT ${limit}
    `;
    console.log("Stops ok.");
  } catch (e) {
    console.error("Stops fail:", e);
  }

  try {
    console.log("Testing 2. GET /routes/:id/students");
    const students = await sql`
      SELECT
        st.id as assignment_id, st.student_id, st.stop_id, st.is_active,
        p.display_name as student_name, s.admission_no,
        c.name as class_name, sec.name as section_name,
        tsp.name as stop_name, tsp.stop_order
      FROM student_transport st
      JOIN students s ON st.student_id = s.id AND s.school_id = ${schoolId}
      JOIN persons p ON s.person_id = p.id
      LEFT JOIN transport_stops tsp ON st.stop_id = tsp.id AND tsp.school_id = ${schoolId}
      LEFT JOIN student_enrollments se ON s.id = se.student_id AND se.status = 'active' AND se.school_id = ${schoolId}
      LEFT JOIN class_sections cs ON se.class_section_id = cs.id
      LEFT JOIN classes c ON cs.class_id = c.id
      LEFT JOIN sections sec ON cs.section_id = sec.id
      WHERE st.route_id = ${routeId}
        AND st.school_id = ${schoolId}
        AND st.is_active = true
      ORDER BY tsp.stop_order NULLS LAST, p.display_name
      LIMIT ${limit}
    `;
    console.log("Students ok.");
  } catch (e) {
    console.error("Students fail:", e);
  }

  try {
    console.log("Testing 3. GET /routes/:id");
    const [route] = await sql`
      SELECT id, school_id, name, code, description, start_point, end_point, total_stops, monthly_fee,
        direction, bus_id, is_active, created_at, updated_at
      FROM transport_routes
      WHERE id = ${routeId} AND school_id = ${schoolId}
    `;
    console.log("Route ok.");
  } catch (e) {
    console.error("Route fail:", e);
  }

  try {
    console.log("Testing 4. GET /routes/:id/live");
    // Wait, let's see if this endpoint is defined in transportRoutes.js
    // I can grep_search again for `/live`
  } catch(e) {}
  
  process.exit(0);
}
test();
