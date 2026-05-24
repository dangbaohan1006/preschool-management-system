-- Preschool Attendance & Billing System - Consolidated Base Schema (V10)
-- Last Updated: 2026-05-04 (Fixed attendance_locks)

PRAGMA foreign_keys = ON;

-- 1. CORE ARCHITECTURE
CREATE TABLE IF NOT EXISTS classes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'STANDARD',
    surcharge_amount REAL DEFAULT 0,
    surcharge_note TEXT,
    is_nursery INTEGER DEFAULT 0,
    block TEXT,
    config TEXT
);

CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    class_id TEXT NOT NULL,
    avatar TEXT,
    status TEXT DEFAULT 'ACTIVE',
    birth_year INTEGER,
    dropout_date TEXT,
    nickname TEXT,
    tag TEXT,
    tag_expiry DATE,
    resumption_date DATE,
    tag_created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    entry_date DATE,
    FOREIGN KEY (class_id) REFERENCES classes(id)
);

-- Add entry_date column if it doesn't exist (migration for existing databases)
ALTER TABLE students ADD COLUMN entry_date DATE;

-- Table for expired trial students
CREATE TABLE IF NOT EXISTS trial_history (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    class_id TEXT NOT NULL,
    birth_year INTEGER,
    nickname TEXT,
    tag_created_at DATETIME,
    trial_ended_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (class_id) REFERENCES classes(id)
);

-- Table for students who dropped out (after hanging or directly)
CREATE TABLE IF NOT EXISTS dropout_history (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    class_id TEXT NOT NULL,
    birth_year INTEGER,
    nickname TEXT,
    status TEXT,
    dropout_date TEXT DEFAULT CURRENT_DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (class_id) REFERENCES classes(id)
);

CREATE TABLE IF NOT EXISTS teachers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    pin TEXT NOT NULL,
    class_id TEXT NOT NULL,
    is_first_login INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (class_id) REFERENCES classes(id)
);

CREATE TABLE IF NOT EXISTS user_permissions (
    user_id TEXT PRIMARY KEY,
    tab_dashboard TEXT DEFAULT 'NONE' CHECK(tab_dashboard IN ('NONE', 'READ', 'WRITE')),
    tab_students TEXT DEFAULT 'NONE' CHECK(tab_students IN ('NONE', 'READ', 'WRITE')),
    tab_calendar TEXT DEFAULT 'NONE' CHECK(tab_calendar IN ('NONE', 'READ', 'WRITE')),
    tab_report TEXT DEFAULT 'NONE' CHECK(tab_report IN ('NONE', 'READ', 'WRITE')),
    tab_locks TEXT DEFAULT 'NONE' CHECK(tab_locks IN ('NONE', 'READ', 'WRITE')),
    tab_finance TEXT DEFAULT 'NONE' CHECK(tab_finance IN ('NONE', 'READ', 'WRITE')),
    tab_staff TEXT DEFAULT 'NONE' CHECK(tab_staff IN ('NONE', 'READ', 'WRITE')),
    FOREIGN KEY (user_id) REFERENCES teachers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS class_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL,
    from_class_id TEXT NOT NULL,
    to_class_id TEXT NOT NULL,
    transfer_date DATE,
    effective_date DATE,
    status TEXT DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'COMPLETED', 'CANCELLED')),
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (from_class_id) REFERENCES classes(id),
    FOREIGN KEY (to_class_id) REFERENCES classes(id)
);

CREATE INDEX IF NOT EXISTS idx_transfers_student ON class_transfers(student_id, status);

-- 2. ATTENDANCE & LOGGING
CREATE TABLE IF NOT EXISTS Raw_Attendance (
    log_id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL,
    student_name TEXT,
    class_id TEXT NOT NULL,
    date DATE NOT NULL,
    status TEXT CHECK(status IN ('PRESENT', 'ABSENT', 'TRANSFER')) NOT NULL,
    details TEXT,
    edge_sync_status INTEGER DEFAULT 0,
    created_by_teacher_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (class_id) REFERENCES classes(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id TEXT,
    teacher_name TEXT,
    action TEXT NOT NULL,
    student_id TEXT,
    student_name TEXT,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. FINANCIAL & ACCOUNTING
CREATE TABLE IF NOT EXISTS dim_fee_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    default_amount REAL NOT NULL,
    is_refundable INTEGER DEFAULT 0,
    group_id TEXT DEFAULT 'STANDARD',
    type TEXT DEFAULT 'FIXED'
);

CREATE TABLE IF NOT EXISTS dim_financial_periods (
    period_month TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'OPEN',
    closed_at DATETIME,
    closed_by TEXT
);

CREATE TABLE IF NOT EXISTS fact_monthly_billing (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    period_month TEXT NOT NULL,
    base_amount REAL NOT NULL DEFAULT 0,
    refund_amount REAL NOT NULL DEFAULT 0,
    extra_amount REAL NOT NULL DEFAULT 0,
    total_amount REAL NOT NULL DEFAULT 0,
    payment_status TEXT DEFAULT 'UNPAID',
    include_annual INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (period_month) REFERENCES dim_financial_periods(period_month)
);

CREATE TABLE IF NOT EXISTS fact_billing_items (
    id TEXT PRIMARY KEY,
    billing_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    amount REAL NOT NULL,
    quantity REAL DEFAULT 1,
    total REAL NOT NULL,
    note TEXT,
    FOREIGN KEY (billing_id) REFERENCES fact_monthly_billing(id),
    FOREIGN KEY (category_id) REFERENCES dim_fee_categories(id)
);

CREATE TABLE IF NOT EXISTS fact_payments (
    id TEXT PRIMARY KEY,
    billing_id TEXT NOT NULL,
    amount REAL NOT NULL,
    method TEXT,
    transaction_ref TEXT,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (billing_id) REFERENCES fact_monthly_billing(id)
);

-- 4. SYSTEM SETTINGS
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dim_holidays (
    holiday_date DATE PRIMARY KEY,
    description TEXT
);

-- 4b. ATTENDANCE LOCKS
CREATE TABLE IF NOT EXISTS attendance_locks (
    locked_date DATE PRIMARY KEY,
    locked_by TEXT NOT NULL,
    locked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    reason TEXT,
    is_locked INTEGER DEFAULT 1
);

-- 5. PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);
CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);
CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON Raw_Attendance(student_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON Raw_Attendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_class ON Raw_Attendance(class_id);
CREATE INDEX IF NOT EXISTS idx_billing_period_class ON fact_monthly_billing(period_month, student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_locks_date ON attendance_locks(locked_date);

-- 6. INITIAL SETTINGS
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('billing_std_days', '22');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('billing_formula', '([Học phí] + [Phí bán trú] + [Phí CSVC]) + [Tiền ăn] * ({{STANDARD_DAYS}} - {{ABSENT_DAYS}})');

-- Seed System Categories
INSERT OR IGNORE INTO dim_fee_categories (id, name, default_amount, group_id, type) 
VALUES ('SURCHARGE', 'Phụ thu/Điều chỉnh', 0, 'SYSTEM', 'FIXED');
