/// <reference types="@cloudflare/workers-types" />
// AttendanceService: Quản lý điểm danh và Nhật ký hoạt động (SOLID - SRP)

export class AttendanceService {
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

    // 1. Kiểm tra trạng thái kỳ kế toán
    async isPeriodClosed(date: string): Promise<boolean> {
        const normalizedDate = this.normalizeDate(date);
        const month = normalizedDate.substring(0, 7); // 'YYYY-MM'
        const period = await this.db.prepare(
            'SELECT status FROM dim_financial_periods WHERE period_month = ?'
        ).bind(month).first<{ status: string }>();

        return period?.status === 'CLOSED';
    }

    // 2. Ghi nhận điểm danh (Hỗ trợ Batch)
    async markAttendance(data: {
        student_id: string;
        student_name: string;
        class_id: string;
        date: string;
        status: string;
        teacher_id: string;
        teacher_name: string;
        details?: string;
    }) {
        return await this.markAttendanceBatch([data]);
    }

    async markAttendanceBatch(records: Array<{
        student_id: string;
        student_name: string;
        class_id: string;
        date: string;
        status: string;
        teacher_id: string;
        teacher_name: string;
        details?: string;
    }>) {
        if (records.length === 0) return;

        const normalizedRecords = records.map(record => ({
            ...record,
            date: this.normalizeDate(record.date)
        }));

        // Guardrail: Kiểm tra kỳ kế toán (Chỉ cần kiểm tra ngày đầu tiên vì thường là điểm danh cùng ngày)
        if (await this.isPeriodClosed(normalizedRecords[0].date)) {
            throw new Error(`Kỳ kế toán tháng ${normalizedRecords[0].date.substring(0, 7)} đã đóng.`);
        }

        // Guardrail: Kiểm tra khóa sổ - Kiểm tra tất cả các ngày duy nhất trong batch
        const uniqueDates = [...new Set(normalizedRecords.map(r => r.date))];
        for (const d of uniqueDates) {
            if (await this.isDateLocked(d)) {
                throw new Error(`Sổ điểm danh ngày ${d} đã bị khóa. Liên hệ Ban quản lý để mở khóa.`);
            }
        }

        const stmts = [];
        for (const data of normalizedRecords) {
            // Kiểm tra entry_date: Nếu bé nhập học sau ngày điểm danh, không lưu
            const student = await this.db.prepare('SELECT tag, entry_date FROM students WHERE id = ?').bind(data.student_id).first<{ tag: string, entry_date: string }>();
            
            // Skip nếu entry_date > attendance date
            if (student?.entry_date && student.entry_date > data.date) {
                continue;
            }
            
            let finalStatus = data.status;
            let finalDetails = data.details || '';

            if (student?.tag === 'HANGING') {
                const dateObj = new Date(data.date);
                const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
                
                // Lấy danh sách ngày lễ từ bảng dim_holidays
                const holiday = await this.db.prepare("SELECT holiday_date FROM dim_holidays WHERE holiday_date = ?").bind(data.date).first();

                if (isWeekend || holiday) {
                    // Nếu là ngày nghỉ, không tự động đánh vắng cho bé Hanging
                    continue; 
                }

                finalStatus = 'ABSENT';
                finalDetails = '[Tự động] Treo sĩ số - Luôn vắng';
            } else if (student?.tag === 'TEMPORARY_LEAVE') {
                // Skip students on temporary leave
                continue;
            }

            stmts.push(this.db.prepare(
                'INSERT INTO Raw_Attendance (student_id, student_name, class_id, date, status, details, edge_sync_status, created_by_teacher_id) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
            ).bind(data.student_id, data.student_name, data.class_id, data.date, finalStatus, finalDetails, data.teacher_id || 'UNKNOWN'));

            let actionText = 'ĐIỂM DANH: VẮNG';
            if (data.status === 'PRESENT') actionText = 'ĐIỂM DANH: CÓ';
            if (data.status === 'TRANSFER') actionText = 'ĐIỂM DANH: CHUYỂN LỚP';

            stmts.push(this.db.prepare(
                'INSERT INTO audit_logs (teacher_id, teacher_name, action, student_id, student_name, details) VALUES (?, ?, ?, ?, ?, ?)'
            ).bind(
                data.teacher_id, 
                data.teacher_name || 'Teacher', 
                actionText,
                data.student_id,
                data.student_name,
                data.details ? `${data.details} (Ngày: ${data.date})` : `Ngày: ${data.date}`
            ));

            // Smart Transfer Detection: Nếu có TRANSFER ở lớp này
            if (data.status === 'TRANSFER') {
                // 1. Kiểm tra lệnh chờ từ Admin (Priority)
                const pending = await this.db.prepare(
                    'SELECT id, to_class_id FROM class_transfers WHERE student_id = ? AND status = "PENDING" ORDER BY created_at DESC LIMIT 1'
                ).bind(data.student_id).first<{ id: number, to_class_id: string }>();

                if (pending) {
                    stmts.push(this.db.prepare(
                        'UPDATE class_transfers SET status = "COMPLETED", transfer_date = ? WHERE id = ?'
                    ).bind(data.date, pending.id));
                    
                    // Tự động cập nhật lớp mới cho học sinh
                    stmts.push(this.db.prepare('UPDATE students SET class_id = ? WHERE id = ?').bind(pending.to_class_id, data.student_id));
                } else {
                    // 2. Fallback: Nếu không có lệnh Admin, tìm PRESENT ở lớp khác trong cùng batch
                    const companion = records.find(r => r.student_id === data.student_id && r.status === 'PRESENT' && r.class_id !== data.class_id);
                    if (companion) {
                        stmts.push(this.db.prepare(
                            'INSERT OR IGNORE INTO class_transfers (student_id, from_class_id, to_class_id, transfer_date, status) VALUES (?, ?, ?, ?, "COMPLETED")'
                        ).bind(data.student_id, data.class_id, companion.class_id, data.date));
                        
                        stmts.push(this.db.prepare('UPDATE students SET class_id = ? WHERE id = ?').bind(companion.class_id, data.student_id));
                    }
                }
            }
        }

        if (stmts.length === 0) {
            return { skipped: true, updated: 0 };
        }

        return await this.db.batch(stmts);
    }

    // 3. Lấy dữ liệu điểm danh tháng (Tối ưu hóa query - OCP)
    // Cập nhật: Phân bổ số ngày kỳ vọng (expected days) dựa trên lịch sử chuyển lớp
    async getMonthlyReport(month: string) {
        // Lấy danh sách học sinh và lớp hiện tại
        // Loại trừ học sinh nghỉ tạm thời khỏi báo cáo tháng để không tính sĩ số
        const studentsRes = await this.db.prepare('SELECT id, name, class_id, entry_date FROM students WHERE status != "DROPOUT" AND (tag IS NULL OR tag != "TEMPORARY_LEAVE")').all<any>();
        const students = studentsRes.results;

        // Lấy lịch sử chuyển lớp trong tháng này
        const transfersRes = await this.db.prepare('SELECT student_id, from_class_id, to_class_id, effective_date FROM class_transfers WHERE effective_date LIKE ? AND status = "COMPLETED"').bind(`${month}%`).all<any>();
        const transfers = transfersRes.results;

        // Lấy tổng hợp điểm danh thực tế
        const attendanceQuery = `
          WITH LatestAttendance AS (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY student_id, date ORDER BY log_id DESC) as rn
            FROM Raw_Attendance
            WHERE date LIKE ?
          )
          SELECT l.student_id, l.class_id, l.status, COUNT(*) as count
          FROM LatestAttendance l
          LEFT JOIN students s ON l.student_id = s.id
          WHERE l.rn = 1
            AND (s.entry_date IS NULL OR s.entry_date <= l.date)
          GROUP BY l.student_id, l.class_id, l.status
        `;
        const attendanceRes = await this.db.prepare(attendanceQuery).bind(`${month}%`).all<any>();
        const attendance = attendanceRes.results;

        // Fetch settings to check if Saturday is a working day
        const settingsRes = await this.db.prepare('SELECT value FROM app_settings WHERE key = "billing_std_days"').first<{ value: string }>();
        const isSaturdayWorking = parseInt(settingsRes?.value || '22') > 23;

        // Fetch holidays for the month to exclude from expected days
        const holidaysRes = await this.db.prepare('SELECT holiday_date FROM dim_holidays WHERE holiday_date LIKE ?').bind(`${month}%`).all<{ holiday_date: string }>();
        const holidaySet = new Set((holidaysRes.results || []).map(h => h.holiday_date));

        // Helper: Tính số ngày làm việc (T2-T6 hoặc T2-T7) trong khoảng [start, end]
        const countWorkDays = (start: string, end: string) => {
            let count = 0;
            let cur = new Date(start);
            let stop = new Date(end);
            while (cur <= stop) {
                const day = cur.getDay();
                const dateStr = cur.toISOString().split('T')[0];
                const isWeekend = day === 0 || (day === 6 && !isSaturdayWorking);
                if (!isWeekend && !holidaySet.has(dateStr)) count++;
                cur.setDate(cur.getDate() + 1);
            }
            return count;
        };

        const year = parseInt(month.split('-')[0]);
        const m = parseInt(month.split('-')[1]);
        const firstDay = `${month}-01`;
        const lastDay = new Date(year, m, 0).toISOString().split('T')[0];

        // Kết quả sẽ chứa thông tin theo cặp (Sinh viên, Lớp)
        const reportMap = new Map<string, any>();

        for (const s of students) {
            // Xác định thời kỳ tính expected_days dựa trên entry_date
            let calcFirstDay = firstDay;
            if (s.entry_date && s.entry_date > lastDay) {
                // Học sinh nhập học sau cuối tháng, không có ngày làm việc
                continue;
            }
            if (s.entry_date && s.entry_date > firstDay) {
                // Học sinh nhập học trong tháng, tính từ entry_date
                calcFirstDay = s.entry_date;
            }

            // Xác định "Tenure" (thời gian ở từng lớp)
            const transfer = transfers.find(t => t.student_id === s.id);
            
            if (transfer) {
                // Lớp cũ
                const keyOld = `${s.id}_${transfer.from_class_id}`;
                const expectedOld = countWorkDays(calcFirstDay, new Date(new Date(transfer.effective_date).getTime() - 86400000).toISOString().split('T')[0]);
                reportMap.set(keyOld, {
                    student_id: s.id,
                    student_name: s.name,
                    class_id: transfer.from_class_id,
                    present_days: 0,
                    absent_days: 0,
                    expected_days: expectedOld
                });

                // Lớp mới
                const keyNew = `${s.id}_${transfer.to_class_id}`;
                const expectedNew = countWorkDays(transfer.effective_date, lastDay);
                reportMap.set(keyNew, {
                    student_id: s.id,
                    student_name: s.name,
                    class_id: transfer.to_class_id,
                    present_days: 0,
                    absent_days: 0,
                    expected_days: expectedNew
                });
            } else {
                // Chỉ ở 1 lớp suốt tháng
                const key = `${s.id}_${s.class_id}`;
                reportMap.set(key, {
                    student_id: s.id,
                    student_name: s.name,
                    class_id: s.class_id,
                    present_days: 0,
                    absent_days: 0,
                    expected_days: countWorkDays(calcFirstDay, lastDay)
                });
            }
        }

        // Điền dữ liệu thực tế vào reportMap
        for (const a of attendance) {
            const key = `${a.student_id}_${a.class_id}`;
            const entry = reportMap.get(key);
            if (entry) {
                if (a.status === 'PRESENT') entry.present_days += a.count;
                if (a.status === 'ABSENT' || a.status === 'TRANSFER') entry.absent_days += a.count;
            } else {
                // Record cho lớp mà học sinh không còn tenure (có thể là dữ liệu cũ hoặc lỗi logic)
                // Ta vẫn tạo một entry vãng lai
                reportMap.set(key, {
                    student_id: a.student_id,
                    student_name: 'Dữ liệu cũ',
                    class_id: a.class_id,
                    present_days: a.status === 'PRESENT' ? a.count : 0,
                    absent_days: (a.status === 'ABSENT' || a.status === 'TRANSFER') ? a.count : 0,
                    expected_days: 0
                });
            }
        }

        return Array.from(reportMap.values());
    }

    // 4. Lấy dữ liệu dạng lưới cho một lớp (Grid view)
    async getClassGrid(startDate: string, endDate: string, classId: string) {
        const normalStart = this.normalizeDate(startDate);
        const normalEnd = this.normalizeDate(endDate);

        const query = `
          WITH LatestLogs AS (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY student_id, date ORDER BY log_id DESC) as rn
            FROM Raw_Attendance
            WHERE date BETWEEN ? AND ?
          )
          SELECT l.student_id, l.date, l.status, l.details
          FROM LatestLogs l
          JOIN students s ON l.student_id = s.id
          WHERE l.rn = 1
            AND s.class_id = ?
            AND (s.entry_date IS NULL OR s.entry_date <= l.date)
        `;
        const { results } = await this.db.prepare(query).bind(normalStart, normalEnd, classId).all();
        return results;
    }

    async getRangeAttendanceSummary(startDate: string, endDate: string) {
        const normalStart = this.normalizeDate(startDate);
        const normalEnd = this.normalizeDate(endDate);

        // 1. Get all configured classes
        const classesRes = await this.db.prepare('SELECT id, name, is_nursery FROM classes').all<any>();
        const classes = classesRes.results || [];

        // 2. Get all students (ACTIVE or PENALTY or whatever, but exclude DROPOUT)
        const studentsRes = await this.db.prepare("SELECT id, name, class_id, status, tag, entry_date, dropout_date FROM students WHERE status != 'DROPOUT'").all<any>();
        const allStudents = studentsRes.results || [];

        // 3. Get holidays
        const holidaysRes = await this.db.prepare('SELECT holiday_date FROM dim_holidays WHERE holiday_date BETWEEN ? AND ?').bind(normalStart, normalEnd).all<any>();
        const holidayDates = new Set((holidaysRes.results || []).map(h => h.holiday_date));

        // 4. Get attendance logs
        const logsQuery = `
          WITH LatestLogs AS (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY student_id, date ORDER BY log_id DESC) as rn
            FROM Raw_Attendance
            WHERE date BETWEEN ? AND ?
          )
          SELECT student_id, class_id, date, status FROM LatestLogs WHERE rn = 1
        `;
        const logsRes = await this.db.prepare(logsQuery).bind(normalStart, normalEnd).all<any>();
        const logs = logsRes.results || [];

        // Group logs by student_id
        const studentLogsMap = new Map<string, Array<{ student_id: string, class_id: string, date: string, status: string }>>();
        for (const log of logs) {
            if (!studentLogsMap.has(log.student_id)) {
                studentLogsMap.set(log.student_id, []);
            }
            studentLogsMap.get(log.student_id)!.push(log);
        }

        // Generate date list (using UTC to prevent local timezone issues)
        const dateList: string[] = [];
        let curr = new Date(normalStart + 'T00:00:00Z');
        const stop = new Date(normalEnd + 'T00:00:00Z');
        while (curr <= stop) {
            const y = curr.getUTCFullYear();
            const m = String(curr.getUTCMonth() + 1).padStart(2, '0');
            const d = String(curr.getUTCDate()).padStart(2, '0');
            dateList.push(`${y}-${m}-${d}`);
            curr.setUTCDate(curr.getUTCDate() + 1);
        }

        // Get union of all class IDs from configured classes and logs
        const classIdsSet = new Set<string>(classes.map(c => c.id));
        for (const log of logs) {
            classIdsSet.add(log.class_id);
        }

        const results = [];

        for (const classId of classIdsSet) {
            // Filter students for this class, matching frontend loadMonthlyReport
            const loggedStudentIds = new Set(logs.filter(l => l.class_id === classId).map(l => l.student_id));
            const classStudents = allStudents.filter((s: any) => {
                const hasLog = loggedStudentIds.has(s.id);
                const isCurrentClass = s.class_id === classId;
                const isDeleted = s.name.includes('DELETED_DUP');
                
                if (classId === 'DOLPHIN_4B' && (s.name.includes('Hải Long') || s.name.includes('Nguyễn Thành Gia Phát'))) {
                    return false;
                }

                const isLeave = s.tag === 'TEMPORARY_LEAVE';
                return ( (isCurrentClass && !isLeave) || hasLog ) && !isDeleted;
            });

            let sumOfIndividualRates = 0;
            let validStudentsForRate = 0;

            for (const s of classStudents) {
                let totalPresent = 0;
                let totalAbsent = 0;
                const sLogs = studentLogsMap.get(s.id) || [];

                for (const dateStr of dateList) {
                    const parsedDate = new Date(dateStr + 'T00:00:00Z');
                    const isWeekend = parsedDate.getUTCDay() === 0 || parsedDate.getUTCDay() === 6;
                    const isHoliday = holidayDates.has(dateStr);

                    if (isWeekend || isHoliday) {
                        continue;
                    }

                    const log = sLogs.find(l => l.date === dateStr);
                    if (log) {
                        if (log.status === 'PRESENT') {
                            totalPresent++;
                        } else if (log.status === 'ABSENT') {
                            totalAbsent++;
                        } else if (log.status === 'TRANSFER') {
                            // Exclude transfer
                        } else if (log.status === 'DROPOUT') {
                            // Exclude dropout
                        } else {
                            totalAbsent++;
                        }
                    } else {
                        const reportMonth = dateStr.substring(0, 7);
                        const dropoutMonth = s.dropout_date ? s.dropout_date.substring(0, 7) : null;
                        if (s.status === 'PENALTY' && dropoutMonth && reportMonth > dropoutMonth) {
                            totalAbsent++;
                        }
                    }
                }

                const possibleDays = totalPresent + totalAbsent;
                if (possibleDays > 0) {
                    sumOfIndividualRates += (totalPresent / possibleDays);
                    validStudentsForRate++;
                }
            }

            const attendanceRate = validStudentsForRate > 0 
                ? ((sumOfIndividualRates / validStudentsForRate) * 100).toFixed(2)
                : "0.00";

            results.push({
                class_id: classId,
                student_count: classStudents.length,
                attendance_rate: attendanceRate
            });
        }

        return results;
    }

    // 5. Xóa dữ liệu hàng loạt
    async deleteAttendanceBatch(filters: { student_id?: string, date?: string, start_date?: string, end_date?: string, class_id?: string }) {
        // Normalize dates in filters
        if (filters.date) filters.date = this.normalizeDate(filters.date);
        if (filters.start_date) filters.start_date = this.normalizeDate(filters.start_date);
        if (filters.end_date) filters.end_date = this.normalizeDate(filters.end_date);

        // Guardrail: Kiểm tra khóa sổ trước khi xóa
        if (filters.date && await this.isDateLocked(filters.date)) {
            throw new Error(`Sổ điểm danh ngày ${filters.date} đã bị khóa. Không thể xóa dữ liệu.`);
        }
        
        let query = 'DELETE FROM Raw_Attendance WHERE 1=1';
        const params: any[] = [];

        if (filters.student_id) {
            query += ' AND student_id = ?';
            params.push(filters.student_id);
        }
        if (filters.class_id) {
            query += ' AND class_id = ?';
            params.push(filters.class_id);
        }
        if (filters.date) {
            query += ' AND date = ?';
            params.push(filters.date);
        }
        if (filters.start_date && filters.end_date) {
            query += ' AND date BETWEEN ? AND ?';
            params.push(filters.start_date, filters.end_date);
        }

        if (params.length === 0) throw new Error('Cần ít nhất một bộ lọc để xóa!');
        
        return await this.db.prepare(query).bind(...params).run();
    }

    // 6. Lấy lịch sử Audit Logs
    async getAuditLogs(limit: number = 500) {
        const { results } = await this.db.prepare(
            'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?'
        ).bind(limit).all();
        return results;
    }

    // 6. Dữ liệu Dashboard hôm nay
    async getTodayStats(date: string) {
        const normalizedDate = this.normalizeDate(date);
        const query = `
          WITH LatestLogs AS (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY student_id, date ORDER BY log_id DESC) as rn
            FROM Raw_Attendance
            WHERE date = ?
          )
          SELECT class_id, 
                 SUM(CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END) as present_count,
                 SUM(CASE WHEN (status = 'ABSENT' OR status = 'TRANSFER') THEN 1 ELSE 0 END) as absent_count
          FROM LatestLogs
          WHERE rn = 1
          GROUP BY class_id
        `;
        const { results } = await this.db.prepare(query).bind(normalizedDate).all();
        return results;
    }

    // 7. Quản lý Khóa sổ điểm danh hàng ngày
    async isDateLocked(date: string): Promise<boolean> {
        const normalizedDate = this.normalizeDate(date);
        const lock = await this.db.prepare(
            'SELECT locked_date FROM attendance_locks WHERE locked_date = ? AND is_locked = 1'
        ).bind(normalizedDate).first<{ locked_date: string }>();
        return !!lock;
    }

    async lockDate(date: string, lockedBy: string, reason?: string): Promise<{ success: boolean }> {
        const normalizedDate = this.normalizeDate(date);
        try {
            await this.db.prepare(
                'INSERT OR REPLACE INTO attendance_locks (locked_date, locked_by, reason, is_locked) VALUES (?, ?, ?, 1)'
            ).bind(normalizedDate, lockedBy, reason || '').run();
            return { success: true };
        } catch (err: any) {
            throw new Error(`Lỗi khóa sổ ngày ${normalizedDate}: ${err?.message}`);
        }
    }

    async unlockDate(date: string): Promise<{ success: boolean }> {
        const normalizedDate = this.normalizeDate(date);
        try {
            await this.db.prepare(
                'UPDATE attendance_locks SET is_locked = 0 WHERE locked_date = ?'
            ).bind(normalizedDate).run();
            return { success: true };
        } catch (err: any) {
            throw new Error(`Lỗi mở khóa sổ ngày ${normalizedDate}: ${err?.message}`);
        }
    }

    async getLockedDates(startDate?: string, endDate?: string): Promise<Array<{ locked_date: string, locked_by: string, locked_at: string, reason: string }>> {
        let query = 'SELECT locked_date, locked_by, locked_at, reason FROM attendance_locks WHERE is_locked = 1';
        const params: any[] = [];

        if (startDate && endDate) {
            const normalStart = this.normalizeDate(startDate);
            const normalEnd = this.normalizeDate(endDate);
            query += ' AND locked_date BETWEEN ? AND ?';
            params.push(normalStart, normalEnd);
        }

        query += ' ORDER BY locked_date DESC';

        const { results } = await this.db.prepare(query).bind(...params).all();
        return results || [];
    }

    // 8. Sync Support (Edge to Local)
    async getPendingSyncRecords() {
        const query = `
            SELECT * FROM Raw_Attendance 
            WHERE edge_sync_status = 0 
            ORDER BY created_at ASC 
            LIMIT 500
        `;
        const { results } = await this.db.prepare(query).all();
        return results;
    }

    async acknowledgeSync(logIds: number[]) {
        if (!logIds || logIds.length === 0) return;
        const placeholders = logIds.map(() => '?').join(',');
        const query = `UPDATE Raw_Attendance SET edge_sync_status = 1 WHERE log_id IN (${placeholders})`;
        return await this.db.prepare(query).bind(...logIds).run();
    }
}

