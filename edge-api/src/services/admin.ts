/// <reference types="@cloudflare/workers-types" />
// AdminService & AuthService: SOLID - SRP (Management & Auth logic)

export class AdminService {
  constructor(private db: D1Database) {}

  // --- Classes ---
  async getClasses() {
    return await this.db.prepare('SELECT * FROM classes ORDER BY name').all();
  }

  async addClass(id: string, name: string, type: string = 'STANDARD', surcharge_amount: number = 0, surcharge_note: string = '', is_nursery: number = 0, block: string = '', config: string = '{}') {
    return await this.db.prepare('INSERT OR REPLACE INTO classes (id, name, type, surcharge_amount, surcharge_note, is_nursery, block, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, name, type, surcharge_amount, surcharge_note, is_nursery, block, config).run();
  }

  async updateClass(id: string, data: { name?: string, type?: string, surcharge_amount?: number, surcharge_note?: string, is_nursery?: number, block?: string, config?: string }) {
    const fields = [];
    const values = [];
    
    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
    if (data.type !== undefined) { fields.push('type = ?'); values.push(data.type); }
    if (data.surcharge_amount !== undefined) { fields.push('surcharge_amount = ?'); values.push(data.surcharge_amount); }
    if (data.surcharge_note !== undefined) { fields.push('surcharge_note = ?'); values.push(data.surcharge_note); }
    if (data.is_nursery !== undefined) { fields.push('is_nursery = ?'); values.push(data.is_nursery); }
    if (data.block !== undefined) { fields.push('block = ?'); values.push(data.block); }
    if (data.config !== undefined) { fields.push('config = ?'); values.push(data.config); }

    if (fields.length === 0) return null;

    values.push(id);
    const query = `UPDATE classes SET ${fields.join(', ')} WHERE id = ?`;
    return await this.db.prepare(query).bind(...values).run();
  }

  // --- Students ---
  async getStudents(classId?: string, asOfDate?: string, includeLeave: boolean = true) {
    let query = 'SELECT * FROM students';
    const conditions = [];
    const params: any[] = [];
    
    // Mặc định chỉ lấy học sinh hoạt động, ẩn các bé đã bị xóa
    conditions.push("status = 'ACTIVE'");
    
    if (classId) {
      conditions.push(`class_id = ?`);
      params.push(classId);
    }
    
    // Nếu có ngày, lọc những bé mà entry_date <= asOfDate
    if (asOfDate) {
      conditions.push(`(entry_date IS NULL OR entry_date <= ?)`);
      params.push(asOfDate);
    }

    // Nếu không include học sinh nghỉ tạm thời (Bảo lưu)
    if (!includeLeave) {
      const currentDate = asOfDate || new Date().toISOString().substring(0, 10);
      conditions.push(`(tag IS NULL OR tag != 'TEMPORARY_LEAVE' OR resumption_date IS NULL OR resumption_date <= ?)`);
      params.push(currentDate);
    }
    
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    
    query += ' ORDER BY name';
    const stmt = this.db.prepare(query);
    return await (params.length > 0 ? stmt.bind(...params).all() : stmt.all());
  }

  async addStudent(id: string, name: string, classId: string, birthYear?: number, tag?: string, parent_name?: string, address?: string, phone?: string, birthday?: string, tag_expiry?: string | null, entry_date?: string, resumption_date?: string | null) {
    // Nếu có Tag, mặc định status là ACTIVE
    const status = 'ACTIVE';

    return await this.db.prepare('INSERT OR IGNORE INTO students (id, name, class_id, birth_year, tag, tag_expiry, resumption_date, parent_name, address, phone, birthday, status, entry_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, name, classId, birthYear || null, tag || null, tag_expiry || null, resumption_date || null, parent_name || null, address || null, phone || null, birthday || null, status, entry_date || null)
      .run();
  }

  /**
   * Chuyển lớp học sinh ngay lập tức và ghi lại lịch sử để tính chuyên cần riêng biệt
   */
  async transferStudent(studentId: string, toClassId: string, effectiveDate: string, note?: string) {
    const student = await this.db.prepare('SELECT class_id FROM students WHERE id = ?').bind(studentId).first<{ class_id: string }>();
    if (!student) throw new Error('Học sinh không tồn tại');
    if (student.class_id === toClassId) throw new Error('Học sinh đã ở lớp này rồi');

    const stmts = [];
    // 1. Ghi nhận lịch sử chuyển lớp (Status COMPLETED vì admin thực hiện trực tiếp)
    stmts.push(this.db.prepare(
      'INSERT INTO class_transfers (student_id, from_class_id, to_class_id, effective_date, transfer_date, status, note) VALUES (?, ?, ?, ?, CURRENT_DATE, "COMPLETED", ?)'
    ).bind(studentId, student.class_id, toClassId, effectiveDate, note || null));

    // 2. Cập nhật class_id mới trong hồ sơ học sinh
    stmts.push(this.db.prepare('UPDATE students SET class_id = ? WHERE id = ?').bind(toClassId, studentId));

    // 3. Ghi vào Audit Log
    stmts.push(this.db.prepare(
      'INSERT INTO audit_logs (teacher_id, teacher_name, action, student_id, student_name, details) VALUES ("ADMIN", "Quản trị viên", "CHUYỂN LỚP", ?, ?, ?)'
    ).bind(studentId, 'Học sinh', `Chuyển từ ${student.class_id} sang ${toClassId} kể từ ${effectiveDate}`));

    return await this.db.batch(stmts);
  }

  async updateStudent(id: string, data: { name?: string, class_id?: string, status?: string, birth_year?: number, tag?: string, parent_name?: string, address?: string, phone?: string, birthday?: string, tag_expiry?: string | null, resumption_date?: string | null, dropout_date?: string | null }) {
    const fields = [];
    const values = [];
    
    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
    if (data.class_id !== undefined) { fields.push('class_id = ?'); values.push(data.class_id); }
    if (data.parent_name !== undefined) { fields.push('parent_name = ?'); values.push(data.parent_name); }
    if (data.address !== undefined) { fields.push('address = ?'); values.push(data.address); }
    if (data.phone !== undefined) { fields.push('phone = ?'); values.push(data.phone); }
    if (data.birthday !== undefined) { fields.push('birthday = ?'); values.push(data.birthday); }

    if (data.status !== undefined) { 
        fields.push('status = ?'); 
        values.push(data.status); 
        if (data.status === 'DROPOUT' || data.status === 'PENALTY') {
            if (data.dropout_date !== undefined) {
                fields.push('dropout_date = ?');
                values.push(data.dropout_date);
            } else {
                fields.push('dropout_date = CURRENT_DATE');
            }
        } else {
            fields.push('dropout_date = NULL');
        }
    } else if (data.dropout_date !== undefined) {
        fields.push('dropout_date = ?');
        values.push(data.dropout_date);
    }
    if (data.birth_year !== undefined) { fields.push('birth_year = ?'); values.push(data.birth_year); }

    // --- Tag & Status Lifecycle Integration ---
    if (data.tag !== undefined) {
      const current = await this.db.prepare('SELECT tag, status FROM students WHERE id = ?').bind(id).first<{ tag: string, status: string }>();
      
      // 1. Nếu gỡ Tag -> Tự động chuyển DROPOUT (trừ khi có status mới là ACTIVE)
      // Lưu ý: Nếu là TEMPORARY_LEAVE thì khi gỡ tag (đi học lại) thì không chuyển DROPOUT
      if (current?.tag && (data.tag === null || data.tag === '')) {
        if (data.status === undefined && current.tag !== 'TEMPORARY_LEAVE') {
          fields.push("status = 'DROPOUT'");
          fields.push("dropout_date = CURRENT_DATE");
          fields.push("class_id = 'DROPOUT'");
        }
      }

      // 2. Nếu thêm Tag -> Tự động đảm bảo status là ACTIVE
      if (data.tag && data.status === undefined) {
          fields.push("status = 'ACTIVE'");
          fields.push("dropout_date = NULL");
      }

      fields.push('tag = ?');
      values.push(data.tag || null);

      // 3. Cập nhật ngày hết hạn hoặc ngày đi học lại
      if (data.tag_expiry !== undefined || !data.tag) {
        fields.push('tag_expiry = ?');
        values.push(data.tag ? (data.tag_expiry || null) : null);
      }
      
      if (data.resumption_date !== undefined || !data.tag) {
        fields.push('resumption_date = ?');
        values.push(data.tag === 'TEMPORARY_LEAVE' ? (data.resumption_date || null) : null);
      }
    } else if (data.resumption_date !== undefined) {
        // Chỉ cập nhật resumption_date nếu được truyền lên mà không thay đổi tag
        fields.push('resumption_date = ?');
        values.push(data.resumption_date || null);
    }

    // 4. Đồng bộ ngược: Nếu chuyển sang DROPOUT -> Xóa Tag
    if (data.status === 'DROPOUT' && data.tag === undefined) {
      fields.push('tag = NULL');
      fields.push('tag_expiry = NULL');
    }

    if (fields.length === 0) return null;

    values.push(id);
    const query = `UPDATE students SET ${fields.join(', ')} WHERE id = ?`;
    return await this.db.prepare(query).bind(...values).run();
  }

  async getTransfers(limit: number = 200) {
    const query = `
      SELECT t.*, s.name as student_name, c1.name as from_class_name, c2.name as to_class_name
      FROM class_transfers t
      JOIN students s ON t.student_id = s.id
      JOIN classes c1 ON t.from_class_id = c1.id
      JOIN classes c2 ON t.to_class_id = c2.id
      ORDER BY t.created_at DESC
      LIMIT ?
    `;
    const { results } = await this.db.prepare(query).bind(limit).all();
    return results;
  }

  async createTransferRequest(student_id: string, to_class_id: string, effective_date: string, note?: string) {
    const student = await this.db.prepare('SELECT class_id FROM students WHERE id = ?').bind(student_id).first<{ class_id: string }>();
    if (!student) throw new Error('Học sinh không tồn tại');
    
    return await this.db.prepare(
      'INSERT INTO class_transfers (student_id, from_class_id, to_class_id, effective_date, status, note) VALUES (?, ?, ?, ?, "PENDING", ?)'
    ).bind(student_id, student.class_id, to_class_id, effective_date, note || null).run();
  }

  async cancelTransferRequest(transfer_id: number) {
    return await this.db.prepare('UPDATE class_transfers SET status = "CANCELLED" WHERE id = ?').bind(transfer_id).run();
  }

  async deleteStudent(id: string) {
    return await this.db.prepare(
      "UPDATE students SET status = 'DELETED', deleted_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(id).run();
  }

  async migrateStudentId(oldId: string, newId: string) {
    // Update all tables that reference student_id. 
    // Since student_id is part of the billing_id, we also need to update fact_monthly_billing.id and its references.
    
    // Check if newId already exists
    const existing = await this.db.prepare('SELECT id FROM students WHERE id = ?').bind(newId).first();
    if (existing) throw new Error('Mã học sinh mới đã tồn tại trên hệ thống!');

    const stmts = [
      this.db.prepare('PRAGMA foreign_keys = OFF;'),
      // 1. Update students table
      this.db.prepare('UPDATE students SET id = ? WHERE id = ?').bind(newId, oldId),
      // 2. Update referencing tables
      this.db.prepare('UPDATE class_transfers SET student_id = ? WHERE student_id = ?').bind(newId, oldId),
      this.db.prepare('UPDATE Raw_Attendance SET student_id = ? WHERE student_id = ?').bind(newId, oldId),
      this.db.prepare('UPDATE audit_logs SET student_id = ? WHERE student_id = ?').bind(newId, oldId),
      this.db.prepare('UPDATE fact_monthly_billing SET student_id = ? WHERE student_id = ?').bind(newId, oldId),
      // 3. Update history tables
      this.db.prepare('UPDATE trial_history SET id = ? WHERE id = ?').bind(newId, oldId),
      this.db.prepare('UPDATE dropout_history SET id = ? WHERE id = ?').bind(newId, oldId),
      // 4. Update Billing IDs (Format: {month}_{student_id_cleaned})
      // Using REPLACE for simplicity as bill IDs are predictably formatted
      this.db.prepare("UPDATE fact_monthly_billing SET id = REPLACE(id, ?, ?) WHERE student_id = ?").bind(oldId.replace(/[^a-zA-Z0-9]/g, ''), newId.replace(/[^a-zA-Z0-9]/g, ''), newId),
      this.db.prepare("UPDATE fact_billing_items SET billing_id = REPLACE(billing_id, ?, ?) WHERE billing_id LIKE ?").bind(oldId.replace(/[^a-zA-Z0-9]/g, ''), newId.replace(/[^a-zA-Z0-9]/g, ''), `%${oldId.replace(/[^a-zA-Z0-9]/g, '')}%`),
      this.db.prepare("UPDATE fact_payments SET billing_id = REPLACE(billing_id, ?, ?) WHERE billing_id LIKE ?").bind(oldId.replace(/[^a-zA-Z0-9]/g, ''), newId.replace(/[^a-zA-Z0-9]/g, ''), `%${oldId.replace(/[^a-zA-Z0-9]/g, '')}%`),
      // 5. Update individual item IDs in fact_billing_items (Format: {billId}_{catId})
      this.db.prepare("UPDATE fact_billing_items SET id = REPLACE(id, ?, ?) WHERE id LIKE ?").bind(oldId.replace(/[^a-zA-Z0-9]/g, ''), newId.replace(/[^a-zA-Z0-9]/g, ''), `%${oldId.replace(/[^a-zA-Z0-9]/g, '')}%`),
      this.db.prepare('PRAGMA foreign_keys = ON;')
    ];
    
    return await this.db.batch(stmts);
  }

  async markStudentDropout(id: string) {
    return await this.db.prepare(
        "UPDATE students SET status = 'PENALTY', dropout_date = CURRENT_DATE WHERE id = ?"
    ).bind(id).run();
  }

  // --- Bulk Actions & Security ---
  async checkAdminPin(pin: string) {
    const setting = await this.db.prepare("SELECT value FROM app_settings WHERE key = 'admin_pin'").first<{ value: string }>();
    const validPin = setting ? setting.value : '123456';
    if (pin !== validPin) throw new Error('Mã PIN không chính xác!');
    return true;
  }

  async bulkTransferStudents(studentIds: string[], toClassId: string, effectiveDate: string, note?: string) {
    if (!studentIds || studentIds.length === 0) return;
    const stmts = [];
    for (const sid of studentIds) {
        const student = await this.db.prepare('SELECT class_id FROM students WHERE id = ?').bind(sid).first<{ class_id: string }>();
        if (student && student.class_id !== toClassId) {
            stmts.push(this.db.prepare(
                'INSERT INTO class_transfers (student_id, from_class_id, to_class_id, effective_date, status, note) VALUES (?, ?, ?, ?, "PENDING", ?)'
            ).bind(sid, student.class_id, toClassId, effectiveDate, note || null));
        }
    }
    if (stmts.length > 0) await this.db.batch(stmts);
  }

  async bulkUpdateStatus(studentIds: string[], status: string) {
    if (!studentIds || studentIds.length === 0) return;
    const isDropoutOrPenalty = status === 'DROPOUT' || status === 'PENALTY';
    const dropoutDate = isDropoutOrPenalty ? 'CURRENT_DATE' : 'NULL';
    const classIdUpdates = status === 'DROPOUT' ? ", class_id = 'DROPOUT'" : "";
    const tagUpdates = status === 'DROPOUT' ? ", tag = NULL, tag_expiry = NULL" : "";

    const stmts = studentIds.map(sid => 
      this.db.prepare(`UPDATE students SET status = ?, dropout_date = ${dropoutDate}${classIdUpdates}${tagUpdates} WHERE id = ?`).bind(status, sid)
    );
    if (stmts.length > 0) await this.db.batch(stmts);
  }

  async clearStudentTags(studentIds: string[]) {
    if (!studentIds || studentIds.length === 0) return;
    const stmts = studentIds.map(sid => 
        this.db.prepare('UPDATE students SET tag = NULL, tag_expiry = NULL WHERE id = ?').bind(sid)
    );
    return await this.db.batch(stmts);
  }

  // --- Teachers Management ---
  async getTeachers() {
    return await this.db.prepare(`
      SELECT t.*, 
             COALESCE(p.tab_dashboard, 'NONE') as tab_dashboard,
             COALESCE(p.tab_students, 'NONE') as tab_students,
             COALESCE(p.tab_calendar, 'NONE') as tab_calendar,
             COALESCE(p.tab_report, 'WRITE') as tab_report,
             COALESCE(p.tab_locks, 'NONE') as tab_locks,
             COALESCE(p.tab_finance, 'NONE') as tab_finance,
             COALESCE(p.tab_staff, 'NONE') as tab_staff
      FROM teachers t
      LEFT JOIN user_permissions p ON t.id = p.user_id
    `).all();
  }

  async addTeacher(id: string, name: string, pin: string, classId: string) {
    const tStmt = this.db.prepare('INSERT INTO teachers (id, name, pin, class_id, is_first_login) VALUES (?, ?, ?, ?, 1)').bind(id, name, pin, classId);
    const pStmt = this.db.prepare('INSERT INTO user_permissions (user_id, tab_report) VALUES (?, "WRITE")').bind(id);
    return await this.db.batch([tStmt, pStmt]);
  }

  async deleteTeacher(id: string) {
    return await this.db.prepare('DELETE FROM teachers WHERE id = ?').bind(id).run();
  }

  async resetTeacherPassword(id: string, newPin: string) {
    return await this.db.prepare('UPDATE teachers SET pin = ?, is_first_login = 1 WHERE id = ?').bind(newPin, id).run();
  }

  async updateTeacher(id: string, name: string, pin: string, classId: string) {
    return await this.db.prepare('UPDATE teachers SET name = ?, pin = ?, class_id = ? WHERE id = ?')
      .bind(name, pin, classId, id).run();
  }

  async updateTeacherPermissions(userId: string, data: {
    tab_dashboard?: string,
    tab_students?: string,
    tab_calendar?: string,
    tab_report?: string,
    tab_locks?: string,
    tab_finance?: string,
    tab_staff?: string
  }) {
    const fields = [];
    const values = [];
    const tabs = ['tab_dashboard', 'tab_students', 'tab_calendar', 'tab_report', 'tab_locks', 'tab_finance', 'tab_staff'];
    
    tabs.forEach(tab => {
      if (data[tab] !== undefined) {
        fields.push(`${tab} = ?`);
        values.push(data[tab]);
      }
    });
    
    if (fields.length === 0) return null;
    
    values.push(userId);
    const query = `UPDATE user_permissions SET ${fields.join(', ')} WHERE user_id = ?`;
    
    // Đảm bảo có dòng trong user_permissions trước
    await this.db.prepare('INSERT OR IGNORE INTO user_permissions (user_id) VALUES (?)').bind(userId).run();
    
    return await this.db.prepare(query).bind(...values).run();
  }

  // --- Settings ---
  async getSettings() {
    return await this.db.prepare('SELECT * FROM app_settings').all();
  }

  async updateSettings(entries: Array<{ key: string, value: string }>) {
    const statements = entries.map(e => 
      this.db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').bind(e.key, e.value)
    );
    return await this.db.batch(statements);
  }

  // --- Holidays ---
  async getHolidays(month?: string) {
    let query = 'SELECT * FROM dim_holidays';
    if (month) {
        query += ` WHERE holiday_date LIKE ?`;
        return await this.db.prepare(query + ' ORDER BY holiday_date ASC').bind(`${month}%`).all();
    }
    return await this.db.prepare(query + ' ORDER BY holiday_date ASC').all();
  }

  async addHoliday(date: string, description: string) {
    return await this.db.prepare('INSERT OR REPLACE INTO dim_holidays (holiday_date, description) VALUES (?, ?)')
      .bind(date, description).run();
  }

  async deleteHoliday(date: string) {
    return await this.db.prepare('DELETE FROM dim_holidays WHERE holiday_date = ?').bind(date).run();
  }

  // --- Trash & Soft Delete ---
  async restoreStudent(id: string) {
    return await this.db.prepare(
      "UPDATE students SET status = 'ACTIVE', deleted_at = NULL WHERE id = ?"
    ).bind(id).run();
  }

  async getTrashStudents() {
    return await this.db.prepare(`
      SELECT s.*, c.name as class_name 
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE s.status = 'DELETED' AND s.deleted_at IS NOT NULL
      ORDER BY s.deleted_at DESC
    `).all();
  }

  async hardDeleteStudent(id: string) {
    const stmts = [
      this.db.prepare('DELETE FROM fact_payments WHERE billing_id IN (SELECT id FROM fact_monthly_billing WHERE student_id = ?)').bind(id),
      this.db.prepare('DELETE FROM fact_billing_items WHERE billing_id IN (SELECT id FROM fact_monthly_billing WHERE student_id = ?)').bind(id),
      this.db.prepare('DELETE FROM fact_monthly_billing WHERE student_id = ?').bind(id),
      this.db.prepare('DELETE FROM Raw_Attendance WHERE student_id = ?').bind(id),
      this.db.prepare('DELETE FROM class_transfers WHERE student_id = ?').bind(id),
      this.db.prepare('DELETE FROM audit_logs WHERE student_id = ?').bind(id),
      this.db.prepare('DELETE FROM trial_history WHERE id = ?').bind(id),
      this.db.prepare('DELETE FROM dropout_history WHERE id = ?').bind(id),
      this.db.prepare('DELETE FROM students WHERE id = ?').bind(id)
    ];
    return await this.db.batch(stmts);
  }

  async purgeExpiredTrash() {
    const { results } = await this.db.prepare(
      "SELECT id FROM students WHERE status = 'DELETED' AND deleted_at <= datetime('now', '-30 days')"
    ).all<{ id: string }>();

    let count = 0;
    for (const s of results || []) {
      await this.hardDeleteStudent(s.id);
      count++;
    }
    return { count };
  }

  // --- Auto-Resumption (Kích hoạt lại bảo lưu) ---
  async autoResumeStudents() {
    const { results } = await this.db.prepare(`
      SELECT id FROM students 
      WHERE status = 'ACTIVE' 
        AND tag = 'TEMPORARY_LEAVE' 
        AND resumption_date IS NOT NULL 
        AND resumption_date <= DATE('now', 'localtime')
    `).all<{ id: string }>();

    const stmts = [];
    for (const s of results || []) {
      stmts.push(this.db.prepare(
        "UPDATE students SET tag = NULL, tag_expiry = NULL, resumption_date = NULL WHERE id = ?"
      ).bind(s.id));
      stmts.push(this.db.prepare(
        'INSERT INTO audit_logs (teacher_id, teacher_name, action, student_id, student_name, details) VALUES ("SYSTEM", "Hệ thống tự động", "BẢO LƯU_HẾT HẠN", ?, ?, "Tự động kích hoạt lại học sinh đi học lại theo ngày hẹn")'
      ).bind(s.id, 'Học sinh'));
    }

    if (stmts.length > 0) {
      await this.db.batch(stmts);
    }
    return { count: results?.length || 0 };
  }
}

export class AuthService {
  constructor(private db: D1Database) {}

  async authenticateTeacher(id: string, pin: string) {
    const teacher = await this.db.prepare(`
      SELECT t.*, 
             COALESCE(p.tab_dashboard, 'NONE') as tab_dashboard,
             COALESCE(p.tab_students, 'NONE') as tab_students,
             COALESCE(p.tab_calendar, 'NONE') as tab_calendar,
             COALESCE(p.tab_report, 'WRITE') as tab_report,
             COALESCE(p.tab_locks, 'NONE') as tab_locks,
             COALESCE(p.tab_finance, 'NONE') as tab_finance,
             COALESCE(p.tab_staff, 'NONE') as tab_staff
      FROM teachers t
      LEFT JOIN user_permissions p ON t.id = p.user_id
      WHERE t.pin = ? AND t.id = ?
    `).bind(pin, id).first<any>();
    
    if (!teacher) return null;

    const className = await this.db.prepare('SELECT name FROM classes WHERE id = ?').bind(teacher.class_id).first<{ name: string }>();
    
    return {
      ...teacher,
      class_name: className ? className.name : 'Chưa phân lớp'
    };
  }

  async changePassword(id: string, newPassword: string) {
    return await this.db.prepare('UPDATE teachers SET pin = ?, is_first_login = 0 WHERE id = ?')
      .bind(newPassword, id).run();
  }
}
