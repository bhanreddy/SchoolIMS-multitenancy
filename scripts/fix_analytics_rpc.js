import sql from '../db.js';

const fixAnalytics = async () => {
    try {
        console.log('Fixing get_financial_analytics RPC...');

        // redefined without 'deleted_at' check on student_fees
        await sql`
            CREATE OR REPLACE FUNCTION get_financial_analytics(
                p_from_date DATE,
                p_to_date DATE,
                p_group_by TEXT DEFAULT 'month'
            )
            RETURNS JSONB
            SET search_path = public
            AS $$
            DECLARE
                v_total_collected DECIMAL(12,2) := 0;
                v_total_outstanding DECIMAL(12,2) := 0;
                v_trend_data JSONB;
            BEGIN
                -- 1. Total Collected in Range (from fee_transactions)
                SELECT COALESCE(SUM(amount), 0) INTO v_total_collected
                FROM fee_transactions
                WHERE paid_at::DATE BETWEEN p_from_date AND p_to_date;

                -- 2. Total Outstanding (Snapshot from student_fees)
                -- REMOVED: deleted_at check as column prevents loading
                SELECT COALESCE(SUM(amount_due - discount - amount_paid), 0) INTO v_total_outstanding
                FROM student_fees
                WHERE status != 'waived';
                
                -- Ensure non-negative
                IF v_total_outstanding < 0 THEN v_total_outstanding := 0; END IF;

                -- 3. Trend Data
                IF p_group_by = 'month' THEN
                    SELECT jsonb_agg(dataset) INTO v_trend_data
                    FROM (
                        SELECT 
                            TO_CHAR(date_trunc('month', paid_at), 'Mon') as label,
                            SUM(amount) as value
                        FROM fee_transactions
                        WHERE paid_at::DATE BETWEEN p_from_date AND p_to_date
                        GROUP BY date_trunc('month', paid_at)
                        ORDER BY date_trunc('month', paid_at)
                    ) dataset;
                ELSE
                     SELECT jsonb_agg(dataset) INTO v_trend_data
                    FROM (
                        SELECT 
                            TO_CHAR(date_trunc('week', paid_at), 'DD Mon') as label,
                            SUM(amount) as value
                        FROM fee_transactions
                        WHERE paid_at::DATE BETWEEN p_from_date AND p_to_date
                        GROUP BY date_trunc('week', paid_at)
                        ORDER BY date_trunc('week', paid_at)
                    ) dataset;
                END IF;

                RETURN jsonb_build_object(
                    'total_collected', v_total_collected,
                    'outstanding_dues', v_total_outstanding,
                    'collection_efficiency', CASE WHEN (v_total_collected + v_total_outstanding) > 0 THEN ROUND((v_total_collected * 100.0 / (v_total_collected + v_total_outstanding)), 1) ELSE 0 END,
                    'trend', COALESCE(v_trend_data, '[]'::jsonb)
                );
            END;
            $$ LANGUAGE plpgsql;
        `;

        console.log('Successfully updated get_financial_analytics.');
        process.exit(0);
    } catch (error) {
        console.error('Error updating RPC:', error);
        process.exit(1);
    }
};

fixAnalytics();
