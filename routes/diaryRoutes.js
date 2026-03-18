import express from 'express';
import sql from '../db.js';
import { requirePermission } from '../middleware/auth.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendNotificationToUsers } from '../services/notificationService.js';
import fs from 'fs';
import { translateFields } from '../services/geminiTranslator.js';

const router = express.Router();

function logDebug(msg) {
  try {
    fs.appendFileSync('debug_log.txt', `${new Date().toISOString()} - ${msg}\n`);
  } catch (e) {}
}

/**
 * GET /diary
 * DR1: All branches now filter by school_id via diary_entries.school_id
 */
router.get('/', requirePermission('diary.view'), asyncHandler(async (req, res) => {
  const { class_section_id, entry_date, from_date, to_date, subject_id, page = 1, limit = 20, updated_since } = req.query;
  const offset = (page - 1) * limit;
  const schoolId = req.schoolId;

  logDebug(`[Diary] Fetch Request: class=${class_section_id}, updated_since=${updated_since}, user=${req.user?.id}`);

  let entries;

  // Sync Logic
  if (updated_since && class_section_id) {
    const sinceDate = new Date(parseInt(updated_since));
    entries = await sql`
      SELECT
        d.id, d.entry_date, d.title, d.title_te, d.content, d.content_te, d.homework_due_date, d.attachments,
        d.class_section_id, d.subject_id, d.created_by, d.created_at, d.updated_at,
        s.name as subject_name,
        creator.display_name as created_by_name
      FROM diary_entries d
      LEFT JOIN subjects s ON d.subject_id = s.id
      JOIN users u ON d.created_by = u.id
      JOIN persons creator ON u.person_id = creator.id
      WHERE d.class_section_id = ${class_section_id} AND school_id = ${req.schoolId}
        AND d.school_id = ${schoolId}
        AND (d.updated_at > ${sinceDate} OR d.created_at > ${sinceDate})
      ORDER BY d.updated_at DESC
    `;
    logDebug(`[Diary] Sync found ${entries.length} entries`);
    res.set('ETag', false);
    return sendSuccess(res, req.schoolId, entries);
  }

  if (class_section_id && entry_date) {
    entries = await sql`
      SELECT
        d.id, d.entry_date, d.title, d.title_te, d.content, d.content_te, d.homework_due_date, d.attachments,
        d.class_section_id,
        s.name as subject_name,
        creator.display_name as created_by_name,
        d.created_at
      FROM diary_entries d
      LEFT JOIN subjects s ON d.subject_id = s.id
      JOIN users u ON d.created_by = u.id
      JOIN persons creator ON u.person_id = creator.id
      WHERE d.class_section_id = ${class_section_id} AND school_id = ${req.schoolId}
        AND d.school_id = ${schoolId}
        AND d.entry_date = ${entry_date}
        ${subject_id ? sql`AND d.subject_id = ${subject_id}` : sql``}
      ORDER BY s.name NULLS LAST
    `;
  } else if (class_section_id && from_date && to_date) {
    entries = await sql`
      SELECT
        d.id, d.entry_date, d.title, d.title_te, d.content, d.content_te, d.homework_due_date,
        d.class_section_id,
        s.name as subject_name,
        creator.display_name as created_by_name
      FROM diary_entries d
      LEFT JOIN subjects s ON d.subject_id = s.id
      JOIN users u ON d.created_by = u.id
      JOIN persons creator ON u.person_id = creator.id
      WHERE d.class_section_id = ${class_section_id} AND school_id = ${req.schoolId}
        AND d.school_id = ${schoolId}
        AND d.entry_date BETWEEN ${from_date} AND ${to_date}
      ORDER BY d.entry_date DESC, s.name NULLS LAST
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else if (class_section_id) {
    entries = await sql`
      SELECT
        d.id, d.entry_date, d.title, d.title_te, d.content, d.content_te, d.homework_due_date, d.attachments,
        d.subject_id, d.created_by, d.created_at, d.updated_at,
        d.class_section_id,
        s.name as subject_name
      FROM diary_entries d
      LEFT JOIN subjects s ON d.subject_id = s.id
      WHERE d.class_section_id = ${class_section_id} AND school_id = ${req.schoolId}
        AND d.school_id = ${schoolId}
      ORDER BY d.entry_date DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    // Teacher's own entries — scoped to school
    entries = await sql`
      SELECT
        d.id, d.entry_date, d.title, d.title_te, d.content, d.content_te, d.homework_due_date,
        s.name as subject_name,
        c.name as class_name, sec.name as section_name,
        d.class_section_id, d.subject_id,
        d.created_at, d.updated_at
      FROM diary_entries d
      JOIN class_sections csec ON d.class_section_id = csec.id
      JOIN classes c ON csec.class_id = c.id
      JOIN sections sec ON csec.section_id = sec.id
      LEFT JOIN subjects s ON d.subject_id = s.id
      WHERE d.created_by = ${req.user.internal_id}
        AND d.school_id = ${schoolId}
        AND EXISTS (
          SELECT 1 FROM class_subjects csub
          JOIN staff st ON csub.teacher_id = st.id
          JOIN users u ON st.person_id = u.person_id
          WHERE u.id = ${req.user.id}
            AND csub.class_section_id = d.class_section_id
            AND csub.subject_id = d.subject_id
        )
      ORDER BY d.homework_due_date DESC NULLS LAST, d.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  return sendSuccess(res, req.schoolId, entries);
}));

/**
 * GET /diary/:id
 * DR2: Ownership check via class_sections.school_id
 */
router.get('/:id', requirePermission('diary.view'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const schoolId = req.schoolId;

  const [entry] = await sql`
    SELECT
      d.id, d.entry_date, d.title, d.title_te, d.content, d.content_te, d.homework_due_date, d.attachments,
      d.subject_id, d.created_by, d.created_at, d.updated_at,
      d.class_section_id,
      s.name as subject_name,
      c.name as class_name, sec.name as section_name,
      creator.display_name as created_by_name
    FROM diary_entries d
    LEFT JOIN subjects s ON d.subject_id = s.id
    JOIN class_sections cs ON d.class_section_id = cs.id
    JOIN classes c ON cs.class_id = c.id
    JOIN sections sec ON cs.section_id = sec.id
    JOIN users u ON d.created_by = u.id
    JOIN persons creator ON u.person_id = creator.id
    WHERE d.id = ${id}
      AND d.school_id = ${schoolId}
  `;

  if (!entry) {
    return res.status(404).json({ error: 'Diary entry not found' });
  }

  return sendSuccess(res, req.schoolId, entry);
}));

/**
 * POST /diary — Create diary entry
 */
router.post('/', requirePermission('diary.create'), asyncHandler(async (req, res) => {
  const { class_section_id, subject_id, entry_date, title, content, homework_due_date, attachments } = req.body;
  const schoolId = req.schoolId;

  logDebug(`[Diary] Creating entry: class=${class_section_id}, date=${entry_date}, subject=${subject_id}, user=${req.user.internal_id}`);

  if (!class_section_id || !content || !entry_date) {
    return res.status(400).json({ error: 'class_section_id, content, and entry_date are required' });
  }

  let title_te = null;
  let content_te = null;
  try {
    const te = await translateFields({ title: title || '', content: content || '' });
    if (title) title_te = te.title || null;
    if (content) content_te = te.content || null;
  } catch (e) {}

  let entry;
  try {
    const result = await sql`
      INSERT INTO diary_entries (school_id, class_section_id, subject_id, entry_date, title, title_te, content, content_te, homework_due_date, attachments, created_by)
      VALUES (${schoolId}, ${class_section_id}, ${subject_id}, ${entry_date}, ${title}, ${title_te}, ${content}, ${content_te},
              ${homework_due_date || null}, ${attachments ? JSON.stringify(attachments) : null}, ${req.user.internal_id})
      RETURNING *
    `;
    entry = result[0];
  } catch (dbErr) {
    logDebug(`[Diary] DB Insert Error: ${dbErr.message}`);
    throw dbErr;
  }

  // Notification: DIARY_UPDATED (Students in class section from this school only)
  (async () => {
    try {
      const recipients = await sql`
        SELECT DISTINCT u.id
        FROM users u
        JOIN students s ON u.person_id = s.person_id
        JOIN student_enrollments se ON s.id = se.student_id
        WHERE se.class_section_id = ${class_section_id} AND school_id = ${req.schoolId}
          AND se.status = 'active'
          AND u.account_status = 'active'
          AND s.school_id = ${schoolId}

        UNION

        SELECT DISTINCT u.id
        FROM users u
        JOIN parents p ON u.person_id = p.person_id
        JOIN student_parents sp ON p.id = sp.parent_id
        JOIN students s ON sp.student_id = s.id
        JOIN student_enrollments se ON s.id = se.student_id
        WHERE se.class_section_id = ${class_section_id} AND school_id = ${req.schoolId}
          AND se.status = 'active'
          AND u.account_status = 'active'
          AND s.school_id = ${schoolId}
      `;

      if (recipients.length > 0) {
        const userIds = recipients.map((r) => r.id);
        await sendNotificationToUsers(userIds, 'DIARY_UPDATED', { message: title || 'New diary entry posted.' });
      }
    } catch (err) {}
  })();

  return sendSuccess(res, req.schoolId, { message: 'Diary entry created', entry }, 201);
}));

/**
 * PUT /diary/:id
 * DR3: Ownership check query scoped to school_id
 */
router.put('/:id', requirePermission('diary.create'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { subject_id, title, content, homework_due_date, attachments } = req.body;
  const schoolId = req.schoolId;

  // DR3: Scoped ownership check
  const [existing] = await sql`
    SELECT created_by FROM diary_entries WHERE id = ${id} AND school_id = ${schoolId}
  `;
  if (!existing) return res.status(404).json({ error: 'Diary entry not found' });

  const isAdmin = req.user?.roles.includes('admin');
  if (!isAdmin && existing.created_by !== req.user.internal_id) {
    return res.status(403).json({ error: 'Can only update your own entries' });
  }

  logDebug(`[Diary] Updating entry: id=${id}, subject=${subject_id}`);

  let sql_title_te = sql`title_te`;
  let sql_content_te = sql`content_te`;

  if (title || content) {
    try {
      const fields = {};
      if (title) fields.title = title;
      if (content) fields.content = content;
      const te = await translateFields(fields);
      if (te.title) sql_title_te = sql`${te.title}`;
      if (te.content) sql_content_te = sql`${te.content}`;
    } catch (e) {}
  }

  let updated;
  try {
    const result = await sql`
      UPDATE diary_entries
      SET
        subject_id = COALESCE(${subject_id ?? null}, subject_id),
        title = COALESCE(${title || null}, title),
        content = COALESCE(${content || null}, content),
        title_te = ${sql_title_te},
        content_te = ${sql_content_te},
        homework_due_date = COALESCE(${homework_due_date || null}, homework_due_date),
        attachments = COALESCE(${attachments ? JSON.stringify(attachments) : null}, attachments),
        updated_at = now()
      WHERE id = ${id}
      AND school_id = ${req.schoolId}
      RETURNING *
    `;
    updated = result[0];
  } catch (dbErr) {
    logDebug(`[Diary] DB Update Error: ${dbErr.message}`);
    throw dbErr;
  }

  return sendSuccess(res, req.schoolId, { message: 'Diary entry updated', entry: updated });
}));

/**
 * DELETE /diary/:id
 * DR3: Ownership check query scoped to school_id
 */
router.delete('/:id', requirePermission('diary.create'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const schoolId = req.schoolId;

  // DR3: Scoped ownership check
  const [existing] = await sql`
    SELECT created_by FROM diary_entries WHERE id = ${id} AND school_id = ${schoolId}
  `;
  if (!existing) return res.status(404).json({ error: 'Diary entry not found' });

  const isAdmin = req.user?.roles.includes('admin');
  if (!isAdmin && existing.created_by !== req.user.internal_id) {
    return res.status(403).json({ error: 'Can only delete your own entries' });
  }

  await sql`DELETE FROM diary_entries WHERE id = ${id} AND school_id = ${req.schoolId}`;
  return sendSuccess(res, req.schoolId, { message: 'Diary entry deleted' });
}));

export default router;