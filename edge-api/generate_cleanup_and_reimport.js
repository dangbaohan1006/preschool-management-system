const fs = require('fs');
const path = require('path');

const output = path.join(__dirname, './cleanup_and_reimport.sql');

let sql = '';

// Delete old April 2026 data
sql += `-- Clean up old April 2026 attendance data\n`;
sql += `DELETE FROM Raw_Attendance WHERE date >= '2026-04-01' AND date <= '2026-04-30';\n`;
sql += `DELETE FROM audit_logs WHERE details LIKE '%2026-04%';\n\n`;

// Insert corrected classes
sql += `-- Ensure classes exist\n`;
const classes = [
    ['LA_1', 'Lá 1'],
    ['LA_2', 'Lá 2'],
    ['CHOI_2', 'Chồi 2'],
    ['THO_TRANG', 'Thỏ trắng'],
    ['MAM_1', 'Mầm 1'],
    ['MAM_2', 'Mầm 2'],
    ['DOLPHIN_1A', 'Dolphin 1A'],
    ['DOLPHIN_1B', 'Dolphin 1B'],
    ['DOLPHIN_2A', 'Dolphin 2A'],
    ['DOLPHIN_2B', 'Dolphin 2B'],
    ['DOLPHIN_3', 'Dolphin 3'],
    ['DOLPHIN_4A', 'Dolphin 4A'],
    ['DOLPHIN_4B', 'Dolphin 4B'],
];

classes.forEach(([id, name]) => {
    sql += `INSERT OR IGNORE INTO classes (id, name, type, is_nursery) VALUES ('${id}', '${name}', 'STANDARD', 0);\n`;
});

sql += `\n-- Import corrected attendance data\n`;

// Append the corrected attendance data
const attendanceData = fs.readFileSync(path.join(__dirname, './import_april_attendance.sql'), 'utf8');
sql += attendanceData;

fs.writeFileSync(output, sql);

console.log(`✅ Generated cleanup + reimport file: ${output}`);
console.log(`📊 File includes:`);
console.log(`  - DELETE old April attendance records`);
console.log(`  - 13 class INSERT statements`);
console.log(`  - 5640 corrected attendance INSERT statements`);
console.log(`\n📝 Status mapping:`);
console.log(`  - x = PRESENT (có mặt)`);
console.log(`  - P = ABSENT (nghỉ có phép)`);
console.log(`  - CL = TRANSFER (chuyển lớp)`);
console.log(`  - NL = ABSENT (nghỉ luôn)`);
console.log(`  - blank = skip (không dữ liệu)`);
console.log(`\n🚀 Ready to import!`);
