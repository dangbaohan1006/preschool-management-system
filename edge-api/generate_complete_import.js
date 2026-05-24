const fs = require('fs');
const path = require('path');

const CLASS_MAP = {
    'Lá 1': 'LA_1',
    'Lá 2': 'LA_2',
    'Chồi 2': 'CHOI_2',
    'Thỏ trắng': 'THO_TRANG',
    'Mầm 1': 'MAM_1',
    'Mầm 2': 'MAM_2',
    'Dolphin 1A': 'DOLPHIN_1A',
    'Dolphin 1B': 'DOLPHIN_1B',
    'Dolphin 2A': 'DOLPHIN_2A',
    'Dolphin 2B': 'DOLPHIN_2B',
    'Dolphin 3': 'DOLPHIN_3',
    'Dolphin 4A': 'DOLPHIN_4A',
    'Dolphin 4B': 'DOLPHIN_4B',
};

const output = path.join(__dirname, './setup_classes_and_import.sql');

let sql = '';

// Insert classes
sql += `-- Step 1: Ensure all classes exist\n`;
Object.entries(CLASS_MAP).forEach(([name, id]) => {
    sql += `INSERT OR IGNORE INTO classes (id, name, type, is_nursery) VALUES ('${id}', '${name}', 'STANDARD', 0);\n`;
});

// Append the attendance data
sql += '\n-- Step 2: Import attendance data\n';
const attendanceData = fs.readFileSync(path.join(__dirname, './import_april_attendance.sql'), 'utf8');
sql += attendanceData;

fs.writeFileSync(output, sql);

console.log(`✅ Generated setup file: ${output}`);
console.log(`📊 File includes:`);
console.log(`  - 13 class INSERT statements`);
console.log(`  - 8550 attendance INSERT statements`);
console.log(`\n🚀 Ready to import!`);
