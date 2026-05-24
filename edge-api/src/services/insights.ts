/// <reference types="@cloudflare/workers-types" />

export class InsightService {
  constructor(private db: D1Database) {}

  private normalizeDate(value: string) {
      if (!value) return value;
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
      const parts = value.split('/');
      if (parts.length === 3) {
          const [day, month, year] = parts;
          return `${year}-${month}-${day}`;
      }
      return value;
  }

  async getDashboardInsights(startDate: string, endDate: string, classId?: string) {
    const normalStart = this.normalizeDate(startDate);
    const normalEnd = this.normalizeDate(endDate);
    const firstDay = normalStart;
    const dateRangePattern = `%`; // Not used anymore for ranges, but kept for pattern if needed

    // Helpers for filtering
    const classFilter = classId ? `AND class_id = ?` : "";
    const classFilterWhere = classId ? `WHERE class_id = ?` : "";
    
    // For finance, we'll use the month of the endDate as the reference for "current" billing stats
    const refMonth = endDate.substring(0, 7);

    // 1. Daily Attendance (Bar Chart) - Last day of the range
    const dailyQuery = `
      WITH LastDate AS (SELECT MAX(date) as d FROM Raw_Attendance WHERE date BETWEEN ? AND ?),
      LatestLogs AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY student_id, date ORDER BY log_id DESC) as rn
        FROM Raw_Attendance
        WHERE date = (SELECT d FROM LastDate) ${classFilter}
      )
      SELECT c.name as class_name, 
             SUM(CASE WHEN l.status = 'PRESENT' THEN 1 ELSE 0 END) as present_count,
             SUM(CASE WHEN l.status = 'ABSENT' THEN 1 ELSE 0 END) as absent_count
      FROM classes c
      LEFT JOIN LatestLogs l ON c.id = l.class_id AND l.rn = 1
      ${classId ? 'WHERE c.id = ?' : ''}
      GROUP BY c.id
      ORDER BY c.name
    `;
    
    // 2. Attendance Trends by Class Type (Daily Line Chart)
    const typeTrendsQuery = `
      WITH LatestLogs AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY student_id, date ORDER BY log_id DESC) as rn
        FROM Raw_Attendance
        WHERE date BETWEEN ? AND ? ${classFilter}
      )
      SELECT date, 
             SUM(CASE WHEN c.type = 'STANDARD' AND l.status = 'PRESENT' THEN 1 ELSE 0 END) as standard_present,
             SUM(CASE WHEN c.type = 'BILINGUAL' AND l.status = 'PRESENT' THEN 1 ELSE 0 END) as bilingual_present
      FROM LatestLogs l
      JOIN classes c ON l.class_id = c.id
      WHERE l.rn = 1
      GROUP BY date
      ORDER BY date ASC
    `;

    // 3. Financial Stats (Revenue estimate) - Uses refMonth
    const financeQuery = classId ? `
      SELECT 
        (SELECT COUNT(*) FROM students WHERE status = 'ACTIVE' AND class_id = ? AND (tag IS NULL OR tag != 'TEMPORARY_LEAVE')) as active_count,
        (SELECT COUNT(*) FROM students WHERE status = 'PENALTY' AND class_id = ?) as penalty_count,
        (SELECT SUM(b.total_amount) FROM fact_monthly_billing b JOIN students s ON b.student_id = s.id WHERE b.period_month = ? AND s.class_id = ? AND b.payment_status = 'PAID') as collected_revenue,
        (SELECT SUM(b.total_amount) FROM fact_monthly_billing b JOIN students s ON b.student_id = s.id WHERE b.period_month = ? AND s.class_id = ? AND b.payment_status != 'PAID') as pending_revenue,
        (SELECT SUM(b.refund_amount) FROM fact_monthly_billing b JOIN students s ON b.student_id = s.id WHERE b.period_month = ? AND s.class_id = ?) as actual_refund
    ` : `
      SELECT 
        (SELECT COUNT(*) FROM students WHERE status = 'ACTIVE' AND (tag IS NULL OR tag != 'TEMPORARY_LEAVE')) as active_count,
        (SELECT COUNT(*) FROM students WHERE status = 'PENALTY') as penalty_count,
        (SELECT SUM(total_amount) FROM fact_monthly_billing WHERE period_month = ? AND payment_status = 'PAID') as collected_revenue,
        (SELECT SUM(total_amount) FROM fact_monthly_billing WHERE period_month = ? AND payment_status != 'PAID') as pending_revenue,
        (SELECT SUM(refund_amount) FROM fact_monthly_billing WHERE period_month = ?) as actual_refund
    `;

    // 4. Student Composition (Pie Chart)
    const compositionQuery = `
      SELECT 
        CASE WHEN c.type = 'BILINGUAL' THEN 'Song Ngữ' ELSE 'Tiêu chuẩn' END as label,
        COUNT(*) as value
      FROM students s
      JOIN classes c ON s.class_id = c.id
      WHERE s.status = 'ACTIVE' AND (s.tag IS NULL OR s.tag != 'TEMPORARY_LEAVE') ${classFilter}
      GROUP BY c.type
    `;

    // 5. Student Movement (In/Out Bar Chart)
    const movementQuery = `
      SELECT 
          c.name as class_name,
          SUM(CASE WHEN (s.dropout_date IS NULL OR s.dropout_date >= ?) THEN 1 ELSE 0 END) as start_count,
          SUM(CASE WHEN s.status = 'ACTIVE' THEN 1 ELSE 0 END) as end_count,
          SUM(CASE WHEN s.dropout_date BETWEEN ? AND ? THEN 1 ELSE 0 END) as dropout_count
      FROM classes c
      LEFT JOIN students s ON c.id = s.class_id
      ${classId ? 'WHERE c.id = ?' : ''}
      GROUP BY c.id
      ORDER BY c.name
    `;

    // Bind parameters dynamically
    const dailyParams = classId ? [normalStart, normalEnd, classId, classId] : [normalStart, normalEnd];
    const trendsParams = classId ? [normalStart, normalEnd, classId] : [normalStart, normalEnd];
    const financeParams = classId ? [classId, classId, refMonth, classId, refMonth, classId, refMonth, classId] : [refMonth, refMonth, refMonth];
    const compositionParams = classId ? [classId] : [];
    const movementParams = classId ? [normalStart, normalStart, normalEnd, classId] : [normalStart, normalStart, normalEnd];

    const [daily, typeTrends, finance, composition, movement] = await Promise.all([
      this.db.prepare(dailyQuery).bind(...dailyParams).all(),
      this.db.prepare(typeTrendsQuery).bind(...trendsParams).all(),
      this.db.prepare(financeQuery).bind(...financeParams).first(),
      this.db.prepare(compositionQuery).bind(...compositionParams).all(),
      this.db.prepare(movementQuery).bind(...movementParams).all()
    ]);

    return {
      daily: daily.results,
      trends: typeTrends.results,
      finance: finance,
      composition: composition.results,
      movement: movement.results
    };
  }

  async getLiveSummary(date: string) {
    const normalizedDate = this.normalizeDate(date);
    const query = `
      WITH LatestLogs AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY student_id, date ORDER BY log_id DESC) as rn
        FROM Raw_Attendance
        WHERE date = ?
      )
      SELECT 
        COALESCE(SUM(CASE WHEN c.block = 'NURSERY' AND l.status = 'PRESENT' THEN 1 ELSE 0 END), 0) as nursery_count,
        COALESCE(SUM(CASE WHEN c.block IN ('LA', 'CHOI', 'MAM') AND l.status = 'PRESENT' THEN 1 ELSE 0 END), 0) as kindergarten_count,
        COALESCE(SUM(CASE WHEN c.block = 'LA' AND l.status = 'PRESENT' THEN 1 ELSE 0 END), 0) as la_count,
        COALESCE(SUM(CASE WHEN c.block = 'CHOI' AND l.status = 'PRESENT' THEN 1 ELSE 0 END), 0) as choi_count,
        COALESCE(SUM(CASE WHEN c.block = 'MAM' AND l.status = 'PRESENT' THEN 1 ELSE 0 END), 0) as mam_count
      FROM LatestLogs l
      JOIN classes c ON l.class_id = c.id
      WHERE l.rn = 1
    `;
    const result = await this.db.prepare(query).bind(normalizedDate).first<any>();
    return result || { nursery_count: 0, kindergarten_count: 0, la_count: 0, choi_count: 0, mam_count: 0 };
  }
}
