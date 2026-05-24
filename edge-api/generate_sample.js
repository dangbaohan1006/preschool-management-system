const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const data = [
    ["student_id", "student_name", "class_id", "date", "status", "details"],
    ["S_LA_1_2", "Nguyễn Ngọc An Nguyên", "LA_1", "2026-04-16", "x", "Đi trễ"],
    ["S_LA_1_3", "Phạm Kim Ngân", "LA_1", "2026-04-16", "x", ""],
    ["S_LA_1_4", "Đỗ Hoàng Gia Phúc", "LA_1", "2026-04-16", "v", "Bệnh"],
    ["S_LA_1_2", "Nguyễn Ngọc An Nguyên", "LA_1", "2026-04-17", "P", "Có phép"],
    ["S_LA_1_3", "Phạm Kim Ngân", "LA_1", "2026-04-17", "x", ""],
];

const ws = XLSX.utils.aoa_to_sheet(data);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Attendance");

const targetPath = path.join(__dirname, '../sample_attendance.xlsx');
XLSX.writeFile(wb, targetPath);

console.log(`Đã tạo file mẫu tại: ${targetPath}`);
