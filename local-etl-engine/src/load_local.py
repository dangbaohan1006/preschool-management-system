import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'local_master.db')

def init_db():
    """Initializes the local master database schema."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS Fact_Attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        log_id_edge INTEGER UNIQUE,
        student_id TEXT NOT NULL,
        student_name TEXT,
        class_id TEXT NOT NULL,
        date TEXT NOT NULL,
        status TEXT NOT NULL,
        sheet_sync_status INTEGER DEFAULT 0,
        sync_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    conn.commit()
    conn.close()

def save_records(records):
    """Saves a batch of records from Edge API into the local master database."""
    if not records:
        return []

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    saved_ids = []
    
    for rec in records:
        try:
            cursor.execute('''
            INSERT INTO Fact_Attendance (log_id_edge, student_id, student_name, class_id, date, status, sheet_sync_status)
            VALUES (?, ?, ?, ?, ?, ?, 0)
            ''', (rec['log_id'], rec['student_id'], rec['student_name'], rec['class_id'], rec['date'], rec['status']))
            saved_ids.append(rec['log_id'])
        except sqlite3.IntegrityError:
            print(f"Record with log_id {rec['log_id']} already exists local. Skipping...")
            saved_ids.append(rec['log_id']) # Still return as saved to acknowledge sync

    conn.commit()
    conn.close()
    return saved_ids

def get_unsynced_for_sheets():
    """Fetches records that are not yet synced to Google Sheets."""
    conn = sqlite3.connect(DB_PATH)
    # Return as list of lists for gspread [student_id, student_name, class_id, date, status, sync_time]
    cursor = conn.cursor()
    cursor.execute('SELECT student_id, student_name, class_id, date, status, sync_time FROM Fact_Attendance WHERE sheet_sync_status = 0')
    data = cursor.fetchall()
    conn.close()
    return data

def mark_sheets_synced():
    """Marks all pending records as successfully synced to Google Sheets."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('UPDATE Fact_Attendance SET sheet_sync_status = 1 WHERE sheet_sync_status = 0')
    conn.commit()
    conn.close()
