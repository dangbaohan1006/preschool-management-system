const XLSX = require('xlsx');
const path = require('path');

// Cấu hình API (Thay đổi URL nếu cần)
const API_URL = 'http://127.0.0.1:8787/api/admin/attendance';
const API_KEY = 'SECRET_INTERNAL_KEY_2026';

// Bản đồ chuyển đổi trạng thái
const STATUS_MAP = {
    'x': 'PRESENT',
    'p': 'PRESENT',
    'c': 'PRESENT',
    'v': 'ABSENT',
    'l': 'ABSENT',
    'phep': 'ABSENT',
    'cl': 'TRANSFER',
    'ntt': 'ABSENT',
    'present': 'PRESENT',
    'absent': 'ABSENT'
};

async function importAttendance(filePath) {
    console.log(`Bắt đầu xử lý file: ${filePath}`);
    
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    const formattedData = data.map(row => {
        const rawStatus = (row.status || '').toString().toLowerCase().trim();
        const status = STATUS_MAP[rawStatus] || 'PRESENT'; // Mặc định là PRESENT nếu không khớp

        return {
            student_id: row.student_id,
            student_name: row.student_name,
            class_id: row.class_id,
            date: row.date,
            status: status,
            teacher_id: 'IMPORT_SCRIPT',
            teacher_name: 'Hệ thống Import',
            details: row.details || ''
        };
    });

    console.log(`Đang gửi ${formattedData.length} bản ghi tới API...`);

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': API_KEY
            },
            body: JSON.stringify(formattedData)
        });

        const result = await response.json();
        if (response.ok) {
            console.log('✅ Import thành công!', result);
        } else {
            console.error('❌ Import thất bại:', result.error || response.statusText);
        }
    } catch (error) {
        console.error('❌ Lỗi kết nối API:', error.message);
    }
}

// Lấy tham số file từ dòng lệnh
const targetFile = process.argv[2] || '../sample_attendance.xlsx';
const absolutePath = path.resolve(__dirname, targetFile);

importAttendance(absolutePath);
