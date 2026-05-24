import { expect, test, vi, beforeEach } from 'vitest';
import { AttendanceService } from './attendance';

// Mock D1Database
let lastQuery = '';
const mockDb = {
  prepare: vi.fn().mockImplementation((query) => {
    lastQuery = query;
    return mockDb;
  }),
  bind: vi.fn().mockReturnThis(),
  first: vi.fn().mockImplementation(async () => {
    if (lastQuery.includes('dim_financial_periods')) {
      return { status: 'OPEN' };
    }
    if (lastQuery.includes('attendance_locks')) {
      return null;
    }
    if (lastQuery.includes('students')) {
      return { tag: null, entry_date: null };
    }
    return null;
  }),
  batch: vi.fn(),
  all: vi.fn(),
} as any;

const service = new AttendanceService(mockDb);

beforeEach(() => {
    vi.clearAllMocks();
    lastQuery = '';
    // Re-establish default mock implementation
    mockDb.first.mockImplementation(async () => {
      if (lastQuery.includes('dim_financial_periods')) {
        return { status: 'OPEN' };
      }
      if (lastQuery.includes('attendance_locks')) {
        return null;
      }
      if (lastQuery.includes('students')) {
        return { tag: null, entry_date: null };
      }
      return null;
    });
});

test('markAttendanceBatch: Phải gửi chính xác số lượng câu lệnh SQL (Batch)', async () => {
    mockDb.batch.mockResolvedValue([{ success: true }]);

    const records = [
        { 
            student_id: 'S1', student_name: 'Bé A', class_id: 'Lop1', 
            date: '2026-04-09', status: 'PRESENT', 
            teacher_id: 'GV1', teacher_name: 'Cô Hồng' 
        },
        { 
            student_id: 'S2', student_name: 'Bé B', class_id: 'Lop1', 
            date: '2026-04-09', status: 'ABSENT', 
            teacher_id: 'GV1', teacher_name: 'Cô Hồng', details: 'Nghỉ ốm' 
        }
    ];

    await service.markAttendanceBatch(records);

    // Mỗi học sinh có 2 Row (Attendance + AuditLog) => 2 học sinh = 4 stmts
    const batchCalls = mockDb.batch.mock.calls[0][0];
    expect(batchCalls.length).toBe(4);
});

test('markAttendanceBatch: Ghi nhận chính xác Ghi chú (Notes)', async () => {
    const records = [{ 
        student_id: 'S1', student_name: 'Bé A', class_id: 'Lop1', 
        date: '2026-04-09', status: 'ABSENT', 
        teacher_id: 'GV1', teacher_name: 'Cô Hồng', details: 'Lý do: Đau bụng' 
    }];

    await service.markAttendanceBatch(records);

    // Thứ tự lệnh bind:
    // 0: Kiểm tra kỳ kế toán (bind month)
    // 1: Kiểm tra khóa sổ ngày (bind date)
    // 2: SELECT tag, entry_date FROM students (bind student_id)
    // 3: INSERT Raw_Attendance của S1 (bind student_id, student_name, class_id, date, status, details, teacher_id)
    // 4: INSERT audit_logs của S1 (bind teacher_id, teacher_name, action, student_id, student_name, details)
    const auditParams = mockDb.bind.mock.calls[4];
    
    expect(auditParams).toContain('Lý do: Đau bụng (Ngày: 2026-04-09)');
});

test('markAttendanceBatch: Mô phỏng "Nhiều người điểm danh cùng lúc"', async () => {
    // Giả lập 2 giáo viên cùng gửi điểm danh cho cùng 1 lớp (2 cụm request riêng biệt)
    const call1 = service.markAttendanceBatch([{ student_id: 'S1', status: 'PRESENT', teacher_id: 'GV1', date: '2026-04-09', class_id: 'Lop1', student_name: 'A', teacher_name: 'H' }]);
    const call2 = service.markAttendanceBatch([{ student_id: 'S1', status: 'ABSENT', teacher_id: 'GV2', date: '2026-04-09', class_id: 'Lop1', student_name: 'A', teacher_name: 'M' }]);

    await Promise.all([call1, call2]);

    // DB Batch phải được gọi 2 lần riêng biệt
    expect(mockDb.batch).toHaveBeenCalledTimes(2); 
});

test('markAttendanceBatch: Phải chặn nếu kỳ kế toán đã ĐÓNG', async () => {
    // Giả lập kỳ kế toán đã ĐÓNG
    mockDb.first.mockImplementation(async () => {
      if (lastQuery.includes('dim_financial_periods')) {
        return { status: 'CLOSED' };
      }
      return null;
    });

    const records = [
        { student_id: 'S1', date: '2026-04-09', status: 'PRESENT' }
    ] as any;

    await expect(service.markAttendanceBatch(records)).rejects.toThrow(/đã đóng/);
});
