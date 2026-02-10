import express from 'express';
import sql from '../db.js';
import { requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

/**
 * GET /invoices
 * List all invoices (student fees)
 */
router.get('/', requirePermission('fees.view'), asyncHandler(async (req, res) => {
    const { student_id, status, limit = 50, offset = 0 } = req.query;

    const invoices = await sql`
    SELECT 
      sf.id, sf.student_id, sf.fee_structure_id, sf.amount_due, sf.amount_paid, sf.status,
      sf.due_date, sf.created_at, sf.updated_at,
      p.display_name as student_name,
      s.admission_no,
      ft.name as fee_type
    FROM student_fees sf
    JOIN students s ON sf.student_id = s.id
    JOIN persons p ON s.person_id = p.id
    JOIN fee_structures fs ON sf.fee_structure_id = fs.id
    JOIN fee_types ft ON fs.fee_type_id = ft.id
    WHERE TRUE
      ${student_id ? sql`AND sf.student_id = ${student_id}` : sql``}
      ${status ? sql`AND sf.status = ${status}` : sql``}
    ORDER BY sf.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

    // Formatting to match Invoice interface expected by frontend
    const formattedInvoices = invoices.map(inv => ({
        ...inv,
        student: {
            person: {
                display_name: inv.student_name
            }
        },
        fee_structure: {
            fee_type: {
                name: inv.fee_type
            }
        }
    }));

    res.json(formattedInvoices);
}));

/**
 * GET /invoices/:id
 * Get specific invoice details
 */
router.get('/:id', requirePermission('fees.view'), asyncHandler(async (req, res) => {
    const { id } = req.params;

    const [invoice] = await sql`
    SELECT 
      sf.id, sf.student_id, sf.fee_structure_id, sf.amount_due, sf.amount_paid, sf.status,
      sf.due_date, sf.created_at, sf.updated_at,
      p.display_name as student_name,
      s.admission_no,
      ft.name as fee_type
    FROM student_fees sf
    JOIN students s ON sf.student_id = s.id
    JOIN persons p ON s.person_id = p.id
    JOIN fee_structures fs ON sf.fee_structure_id = fs.id
    JOIN fee_types ft ON fs.fee_type_id = ft.id
    WHERE sf.id = ${id}
  `;

    if (!invoice) {
        return res.status(404).json({ error: 'Invoice not found' });
    }

    const formattedInvoice = {
        ...invoice,
        student: {
            person: {
                display_name: invoice.student_name
            }
        },
        fee_structure: {
            fee_type: {
                name: invoice.fee_type
            }
        }
    };

    res.json(formattedInvoice);
}));

export default router;
