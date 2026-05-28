/// <reference types="@cloudflare/workers-types" />
import { Hono } from 'hono';
import { cors } from 'hono/cors';

// Import Services (OOP Refactoring)
import { AdminService, AuthService } from './services/admin';
import { AttendanceService } from './services/attendance';
import { FinanceService } from './services/finance';
import { InsightService } from './services/insights';

type Bindings = {
  DB: D1Database;
  API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-bypass-locks'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  exposeHeaders: ['Content-Length'],
  maxAge: 600,
  credentials: true,
}));

// Authentication Middleware (Shared Secret for Admin & Teachers)
app.use('/api/*', async (c, next) => {
  // BẢO VỆ: Không áp dụng Authentication cho Preflight (OPTIONS)
  if (c.req.method === 'OPTIONS') {
    return await next();
  }

  // BỎ QUA AUTH: Cho phép debug endpoint
  if (c.req.path === '/api/admin/debug-schema') {
    return await next();
  }
  
  const incomingKey = c.req.header('x-api-key');
  if (incomingKey !== "SECRET_INTERNAL_KEY_2026") {
    return c.json({ error: 'Unauthorized Access' }, 401);
  }
  await next();
});

// --- Dependency Injection Setup ---
const getServices = (db: D1Database) => ({
  admin: new AdminService(db),
  auth: new AuthService(db),
  attendance: new AttendanceService(db),
  finance: new FinanceService(db),
  insights: new InsightService(db)
});

// --- API Endpoints (Normalized Architectural Design) ---

// 1. Admin Management (Classes & Students)
app.get('/api/admin/classes', async (c) => {
  const { admin } = getServices(c.env.DB);
  const { results } = await admin.getClasses();
  return c.json({ results });
});

app.post('/api/admin/classes', async (c) => {
  const { id, name, type, surcharge_amount, surcharge_note, is_nursery, block, config } = await c.req.json();
  const { admin } = getServices(c.env.DB);
  await admin.addClass(id, name, type, surcharge_amount, surcharge_note, is_nursery, block, config);
  return c.json({ success: true });
});

app.put('/api/admin/classes/:id', async (c) => {
  const id = c.req.param('id');
  const data = await c.req.json();
  const { admin } = getServices(c.env.DB);
  await admin.updateClass(id, data);
  return c.json({ success: true });
});

app.get('/api/admin/students', async (c) => {
  const classId = c.req.query('class_id');
  const asOfDate = c.req.query('as_of_date');
  const includeLeave = c.req.query('include_leave') !== 'false';
  const { admin } = getServices(c.env.DB);
  
  // Tự động kích hoạt lại các bé hết hạn bảo lưu (nghỉ tạm thời)
  try {
    await admin.autoResumeStudents();
  } catch (e) {
    console.error("Auto resume failed:", e);
  }
  
  const { results } = await admin.getStudents(classId, asOfDate, includeLeave);
  return c.json({ results });
});

app.post('/api/admin/students', async (c) => {
  try {
    const { id, name, class_id, tag, parent_name, address, phone, birthday, tag_expiry, entry_date, resumption_date } = await c.req.json();
    
    if (!id || !name) {
      return c.json({ success: false, error: 'ID và Tên bé là bắt buộc' }, 400);
    }
    
    if (!class_id) {
      return c.json({ success: false, error: 'Lớp học là bắt buộc' }, 400);
    }
    
    const { admin } = getServices(c.env.DB);
    await admin.addStudent(id, name, class_id, undefined, tag, parent_name, address, phone, birthday, tag_expiry, entry_date, resumption_date);
    return c.json({ success: true });
  } catch (err: any) {
    console.error('Error adding student:', err);
    return c.json({ success: false, error: err?.message || 'Lỗi thêm học sinh' }, 500);
  }
});

app.delete('/api/admin/students/:id', async (c) => {
  const id = c.req.param('id');
  const { admin } = getServices(c.env.DB);
  try {
    await admin.deleteStudent(id);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err?.message || 'Không thể xóa học sinh' }, 400);
  }
});

app.get('/api/admin/students/trash', async (c) => {
  const { admin } = getServices(c.env.DB);
  try {
    const { results } = await admin.getTrashStudents();
    return c.json({ results });
  } catch (err: any) {
    return c.json({ error: err?.message || 'Lỗi tải thùng rác' }, 500);
  }
});

app.post('/api/admin/students/:id/restore', async (c) => {
  const id = c.req.param('id');
  const { admin } = getServices(c.env.DB);
  try {
    await admin.restoreStudent(id);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err?.message || 'Lỗi khôi phục học sinh' }, 400);
  }
});

app.post('/api/admin/students/purge-trash', async (c) => {
  const { admin } = getServices(c.env.DB);
  try {
    const result = await admin.purgeExpiredTrash();
    return c.json({ success: true, ...result });
  } catch (err: any) {
    return c.json({ error: err?.message || 'Lỗi dọn dẹp thùng rác' }, 500);
  }
});

app.post('/api/admin/students/:id/purge', async (c) => {
  const id = c.req.param('id');
  const { pin } = await c.req.json();
  const { admin } = getServices(c.env.DB);
  try {
    await admin.checkAdminPin(pin);
    await admin.hardDeleteStudent(id);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err?.message || 'Lỗi xóa vĩnh viễn học sinh' }, 400);
  }
});

app.post('/api/admin/students/:id/migrate', async (c) => {
  const oldId = c.req.param('id');
  const { newId } = await c.req.json();
  const { admin } = getServices(c.env.DB);
  try {
    await admin.migrateStudentId(oldId, newId);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

app.post('/api/admin/students/:id/dropout', async (c) => {
  const { admin } = getServices(c.env.DB);
  await admin.markStudentDropout(c.req.param('id'));
  return c.json({ success: true });
});

app.put('/api/admin/students/:id', async (c) => {
  const data = await c.req.json();
  const { admin } = getServices(c.env.DB);
  await admin.updateStudent(c.req.param('id'), data);
  return c.json({ success: true });
});

app.post('/api/admin/students/bulk-transfer', async (c) => {
  const { student_ids, to_class_id, effective_date, note, pin } = await c.req.json();
  const { admin } = getServices(c.env.DB);
  try {
    await admin.checkAdminPin(pin);
    await admin.bulkTransferStudents(student_ids, to_class_id, effective_date, note);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

app.post('/api/admin/students/bulk-status', async (c) => {
  const { student_ids, status, pin } = await c.req.json();
  const { admin } = getServices(c.env.DB);
  try {
    await admin.checkAdminPin(pin);
    await admin.bulkUpdateStatus(student_ids, status);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

app.post('/api/admin/students/clear-tag', async (c) => {
  const { student_ids } = await c.req.json();
  const { admin } = getServices(c.env.DB);
  try {
    await admin.clearStudentTags(student_ids);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// 1b. Student Status Change Requests (Teacher to Admin workflow)
app.post('/api/teacher/students/:id/status-request', async (c) => {
  const studentId = c.req.param('id');
  const payload = await c.req.json();
  const { admin } = getServices(c.env.DB);
  try {
    const result = await admin.createStatusRequest({
      student_id: studentId,
      ...payload
    });
    return c.json({ success: true, result });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

app.get('/api/admin/debug-schema', async (c) => {
  try {
    const { results } = await c.env.DB.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all();
    return c.json({ results });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.get('/api/admin/status-requests', async (c) => {
  const statusFilter = c.req.query('status') || 'PENDING';
  const { admin } = getServices(c.env.DB);
  try {
    const results = await admin.getStatusRequests(statusFilter);
    return c.json({ results });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post('/api/admin/status-requests/:id/review', async (c) => {
  const requestId = parseInt(c.req.param('id'));
  const { action, admin_name, review_note, is_hanging } = await c.req.json();
  const { admin } = getServices(c.env.DB);
  try {
    await admin.reviewStatusRequest(requestId, action, admin_name || 'Admin', review_note, is_hanging !== false);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// 2. Attendance & Reporting
app.post('/api/admin/attendance', async (c) => {
  const body = await c.req.json();
  const { attendance } = getServices(c.env.DB);
  const bypassLocks = c.req.query('bypass_locks') === 'true' || c.req.header('x-bypass-locks') === 'true';
  try {
    if (Array.isArray(body)) {
      await attendance.markAttendanceBatch(body, bypassLocks);
    } else {
      await attendance.markAttendance(body, bypassLocks);
    }
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 403);
  }
});

app.get('/api/admin/report/monthly', async (c) => {
  const month = c.req.query('month');
  if (!month) return c.json({ error: 'Missing month' }, 400);
  const { attendance } = getServices(c.env.DB);
  const results = await attendance.getMonthlyReport(month);
  return c.json({ results, month });
});

app.get('/api/admin/report/class-grid', async (c) => {
  const { start_date, end_date, class_id } = c.req.query();
  if (!start_date || !end_date || !class_id) return c.json({ error: 'Missing parameters' }, 400);
  const { attendance } = getServices(c.env.DB);
  const results = await attendance.getClassGrid(start_date, end_date, class_id);
  return c.json({ results });
});

app.get('/api/admin/attendance/summary/range', async (c) => {
  const { start, end } = c.req.query();
  if (!start || !end) return c.json({ error: 'Missing start or end date' }, 400);
  const { attendance } = getServices(c.env.DB);
  try {
    const results = await attendance.getRangeAttendanceSummary(start, end);
    return c.json({ results });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.get('/api/admin/audit-logs', async (c) => {
  const { attendance } = getServices(c.env.DB);
  const results = await attendance.getAuditLogs();
  return c.json({ results });
});

app.get('/api/admin/transfers', async (c) => {
  const { admin } = getServices(c.env.DB);
  const results = await admin.getTransfers();
  return c.json({ results });
});

app.post('/api/admin/transfers', async (c) => {
  const { student_id, to_class_id, effective_date, note } = await c.req.json();
  const { admin } = getServices(c.env.DB);
  try {
    await admin.createTransferRequest(student_id, to_class_id, effective_date, note);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

app.post('/api/admin/transfers/:id/cancel', async (c) => {
  const id = parseInt(c.req.param('id'));
  const { admin } = getServices(c.env.DB);
  await admin.cancelTransferRequest(id);
  return c.json({ success: true });
});

app.get('/api/admin/dashboard/today', async (c) => {
  const date = c.req.query('date');
  if (!date) return c.json({ error: 'Missing date' }, 400);
  const { attendance } = getServices(c.env.DB);
  const results = await attendance.getTodayStats(date);
  return c.json({ results });
});

app.get('/api/admin/dashboard/live-summary', async (c) => {
  const date = c.req.query('date');
  if (!date) return c.json({ error: 'Missing date' }, 400);
  const { insights } = getServices(c.env.DB);
  const results = await insights.getLiveSummary(date);
  return c.json({ results });
});

app.get('/api/admin/dashboard/insights', async (c) => {
  const { start_date, end_date, class_id } = c.req.query();
  
  // Backwards compatibility or default range (current month)
  let finalStart = start_date;
  let finalEnd = end_date;
  
  if (!finalStart || !finalEnd) {
    const now = new Date();
    finalStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().substring(0, 10);
    finalEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().substring(0, 10);
  }

  const { insights } = getServices(c.env.DB);
  const results = await insights.getDashboardInsights(finalStart, finalEnd, class_id);
  return c.json({ results });
});

// 3. Teacher Management
app.get('/api/admin/teachers', async (c) => {
  const { admin } = getServices(c.env.DB);
  const { results } = await admin.getTeachers();
  return c.json({ results });
});

app.post('/api/admin/teachers', async (c) => {
  const { id, name, pin, class_id } = await c.req.json();
  const { admin } = getServices(c.env.DB);
  await admin.addTeacher(id, name, pin, class_id);
  return c.json({ success: true });
});

app.delete('/api/admin/teachers/:id', async (c) => {
  const { admin } = getServices(c.env.DB);
  await admin.deleteTeacher(c.req.param('id'));
  return c.json({ success: true });
});

app.post('/api/admin/teachers/reset-password', async (c) => {
  const { id, new_password } = await c.req.json();
  const { admin } = getServices(c.env.DB);
  await admin.resetTeacherPassword(id, new_password);
  return c.json({ success: true });
});

app.put('/api/admin/teachers/:id', async (c) => {
  const id = c.req.param('id');
  const { name, pin, class_id } = await c.req.json();
  const { admin } = getServices(c.env.DB);
  await admin.updateTeacher(id, name, pin, class_id);
  return c.json({ success: true });
});

app.post('/api/admin/staff/permissions', async (c) => {
  const { user_id, permissions } = await c.req.json();
  const { admin } = getServices(c.env.DB);
  await admin.updateTeacherPermissions(user_id, permissions);
  return c.json({ success: true });
});

// 3.5 Holidays Management
app.get('/api/admin/holidays', async (c) => {
  const month = c.req.query('month');
  const { admin } = getServices(c.env.DB);
  const { results } = await admin.getHolidays(month);
  return c.json({ results });
});

app.post('/api/admin/holidays', async (c) => {
  const { date, description } = await c.req.json();
  const { admin } = getServices(c.env.DB);
  await admin.addHoliday(date, description);
  return c.json({ success: true });
});

app.delete('/api/admin/holidays/:date', async (c) => {
  const { admin } = getServices(c.env.DB);
  await admin.deleteHoliday(c.req.param('date'));
  return c.json({ success: true });
});

// 4. Financial & Accounting
app.get('/api/admin/finance/fee-categories', async (c) => {
  const { finance } = getServices(c.env.DB);
  return c.json({ results: await finance.getFeeCategories() });
});

app.post('/api/admin/finance/fee-categories', async (c) => {
  const data = await c.req.json();
  const { finance } = getServices(c.env.DB);
  await finance.upsertFeeCategory(data);
  return c.json({ success: true });
});

app.delete('/api/admin/finance/fee-categories/:id', async (c) => {
  const { finance } = getServices(c.env.DB);
  try {
    await finance.deleteFeeCategory(c.req.param('id'));
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 403);
  }
});

app.get('/api/admin/finance/periods', async (c) => {
  const { finance } = getServices(c.env.DB);
  return c.json({ results: await finance.getFinancialPeriods() });
});

app.post('/api/admin/finance/periods/status', async (c) => {
  const { month, status, user } = await c.req.json();
  const { finance } = getServices(c.env.DB);
  await finance.setPeriodStatus(month, status, user);
  return c.json({ success: true });
});

app.get('/api/admin/finance/bills', async (c) => {
  const { month, class_id } = c.req.query();
  if (!month) return c.json({ error: 'Missing month' }, 400);
  const { finance } = getServices(c.env.DB);
  return c.json({ results: await finance.getMonthlyBills(month, class_id) });
});

app.post('/api/admin/finance/bills/batch', async (c) => {
  try {
    const { month, class_id } = await c.req.json();
    const { finance, admin } = getServices(c.env.DB);
    const studentsRes = await admin.getStudents(class_id);
    const students = (studentsRes.results || []) as any[];
    
    // Create bills for each student (Batch processing)
    let count = 0;
    for (const s of students) {
      const billId = `${month}_${(s.id as string).replace(/[^a-zA-Z0-9]/g, '')}`;
      await finance.createBill({ 
        id: billId,
        student_id: s.id as string, 
        period_month: month 
      });
      count++;
    }
    return c.json({ success: true, count });
  } catch (error: any) {
    console.error('Batch billing error:', error);
    return c.json({ success: false, error: error.message || 'Internal Server Error' }, 500);
  }
});

app.post('/api/admin/finance/bills', async (c) => {
  const data = await c.req.json();
  const { finance } = getServices(c.env.DB);
  await finance.createBill(data);
  return c.json({ success: true });
});

app.get('/api/admin/finance/bills/:id/details', async (c) => {
  const id = c.req.param('id');
  const { finance } = getServices(c.env.DB);
  const results = await finance.getBillDetails(id);
  return c.json({ results });
});

app.post('/api/admin/finance/bills/:id/discount', async (c) => {
  const id = c.req.param('id');
  const { discount_amount, note, discount_percent } = await c.req.json();
  const { finance } = getServices(c.env.DB);
  try {
    const result = await finance.applyDiscount(id, discount_amount, note, discount_percent);
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

app.post('/api/admin/finance/bills/:id/toggle-annual', async (c) => {
  const id = c.req.param('id');
  const { include } = await c.req.json();
  const { finance } = getServices(c.env.DB);
  await finance.toggleAnnualSubscription(id, !!include);
  return c.json({ success: true });
});

app.post('/api/admin/finance/bills/:id/toggle-payment', async (c) => {
  const id = c.req.param('id');
  const { payment_date, payment_method } = await c.req.json().catch(() => ({}));
  const { finance } = getServices(c.env.DB);
  await finance.toggleBillPaymentStatus(id, payment_date, payment_method);
  return c.json({ success: true });
});

app.post('/api/admin/finance/payment', async (c) => {
  const data = await c.req.json();
  const { finance } = getServices(c.env.DB);
  try {
    await finance.recordPayment(data);
    return c.json({ success: true });
  } catch (err: any) {
    if (err.message === 'Hóa đơn không tồn tại') {
        return c.json({ error: err.message }, 404);
    }
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// 4. Authenticaton (Teachers)
app.post('/api/auth/teacher', async (c) => {
  const { pin, id } = await c.req.json();
  const { auth } = getServices(c.env.DB);
  const teacher = await auth.authenticateTeacher(id, pin);
  if (!teacher) return c.json({ error: 'Auth failed' }, 401);
  return c.json({ success: true, ...teacher });
});

app.post('/api/auth/teacher/password', async (c) => {
  const { id, new_password } = await c.req.json();
  const { auth } = getServices(c.env.DB);
  await auth.changePassword(id, new_password);
  return c.json({ success: true });
});

app.post('/api/auth/admin', async (c) => {
  const { password } = await c.req.json();
  const { admin } = getServices(c.env.DB);
  const { results } = await admin.getSettings();
  const adminPassword = (results || []).find((s: any) => s.key === 'admin_password')?.value || '123456';
  
  if (password !== adminPassword) {
    return c.json({ error: 'Mật khẩu quản trị viên không chính xác!' }, 401);
  }
  return c.json({ success: true, role: 'admin', name: 'Quản trị viên' });
});

// 5. System Settings
app.get('/api/admin/settings', async (c) => {
  const { admin } = getServices(c.env.DB);
  const { results } = await admin.getSettings();
  return c.json({ results });
});

app.post('/api/admin/settings', async (c) => {
  const { entries } = await c.req.json();
  const { admin } = getServices(c.env.DB);
  await admin.updateSettings(entries);
  return c.json({ success: true });
});

// 6. Bulk Data Import (Maintenance)
app.post('/api/admin/attendance/bulk-import', async (c) => {
  const { records } = await c.req.json();
  const { attendance } = getServices(c.env.DB);
  try {
    await attendance.markAttendanceBatch(records);
    return c.json({ success: true, count: records.length });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post('/api/admin/attendance/delete-batch', async (c) => {
  const { student_id, date, start_date, end_date, class_id } = await c.req.json();
  const { attendance } = getServices(c.env.DB);
  try {
    await attendance.deleteAttendanceBatch({ student_id, date, start_date, end_date, class_id });
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// 5. Attendance Lock Management
app.get('/api/admin/locks', async (c) => {
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');
  const { attendance } = getServices(c.env.DB);
  try {
    const results = await attendance.getLockedDates(startDate, endDate);
    return c.json({ results });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

app.post('/api/admin/locks', async (c) => {
  const { date, locked_by, reason } = await c.req.json();
  const { attendance } = getServices(c.env.DB);
  try {
    await attendance.lockDate(date, locked_by, reason);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

app.delete('/api/admin/locks/:date', async (c) => {
  const date = c.req.param('date');
  const { attendance } = getServices(c.env.DB);
  try {
    await attendance.unlockDate(date);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// 7. Data Sync (Edge to Local ETL)
app.get('/api/sync/pending', async (c) => {
  const { attendance } = getServices(c.env.DB);
  const results = await attendance.getPendingSyncRecords();
  return c.json({ results });
});

app.post('/api/sync/ack', async (c) => {
  const { log_ids } = await c.req.json();
  const { attendance } = getServices(c.env.DB);
  await attendance.acknowledgeSync(log_ids);
  return c.json({ success: true });
});

export default app;
