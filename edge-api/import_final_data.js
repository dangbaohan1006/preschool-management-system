const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const MASTER_FILE = path.join(__dirname, '../DANH SÁCH TRẺ 2026 - T04.csv');
const ATTENDANCE_FILE = path.join(__dirname, '../ĐIỂM DANH THÁNG - 13 LỚP - Tháng 4.csv');
const SQL_OUTPUT_FILE = path.join(__dirname, '../import_data.sql');

function removeAccents(str) {
    return str.normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

function normalize(str, keepAccents = true) {
    if (!str) return '';
    let res = str.toString().trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
    return keepAccents ? res : removeAccents(res);
}

function extractNickname(fullName) {
    const regex = /\(([^)]+)\)/;
    const match = fullName.match(regex);
    const nickname = match ? match[1].trim() : null;
    const cleanName = fullName.replace(regex, '').trim();
    return { cleanName, nickname };
}

function levenshtein(a, b) {
    const tmp = [];
    for (let i = 0; i <= a.length; i++) tmp[i] = [i];
    for (let j = 0; j <= b.length; j++) tmp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            tmp[i][j] = Math.min(
                tmp[i - 1][j] + 1,
                tmp[i][j - 1] + 1,
                tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
        }
    }
    return tmp[a.length][b.length];
}

function isSimilar(s1, s2) {
    const n1 = normalize(s1, false);
    const n2 = normalize(s2, false);
    if (n1.length < 3 || n2.length < 3) return false;
    const dist = levenshtein(n1, n2);
    return dist <= Math.max(2, Math.floor(Math.min(n1.length, n2.length) * 0.25));
}

function generateClassId(className) {
    return removeAccents(className).toUpperCase().replace(/\s+/g, '_');
}

async function runImport() {
    console.log('--- ĐANG CHUẨN BỊ SQL IMPORT (PHASE 3) ---');

    // 1. Đọc Master List
    const masterWb = XLSX.readFile(MASTER_FILE);
    let masterData = [];
    masterWb.SheetNames.forEach(name => {
        const sheet = masterWb.Sheets[name];
        const rows = XLSX.utils.sheet_to_json(sheet);
        masterData = masterData.concat(rows);
    });

    const masterMap = new Map();
    const masterNoAccentMap = new Map();
    const classesToEnsure = new Set();

    masterData.forEach(row => {
        const rawName = row['Họ và tên học sinh'] || '';
        const rawClass = row['Lớp'] || '';
        if (!rawName || !rawClass) return;

        const name = normalize(rawName, true);
        const className = normalize(rawClass, true);
        const key = `${name}|${className}`;
        masterMap.set(key, row);

        const noAccentKey = `${normalize(rawName, false)}|${normalize(rawClass, false)}`;
        masterNoAccentMap.set(noAccentKey, key);
        
        classesToEnsure.add(rawClass.trim());
    });

    // 2. Đọc Attendance List
    const attendanceContent = fs.readFileSync(ATTENDANCE_FILE, 'utf8');
    const attendanceLines = attendanceContent.split(/\r?\n/);
    const attendanceHeaders = attendanceLines[0].split(',');
    
    // Tìm các cột ngày (1-30)
    const dayColumns = [];
    for (let i = 5; i < attendanceHeaders.length; i++) {
        if (!isNaN(parseInt(attendanceHeaders[i]))) {
            dayColumns.push({ index: i, day: parseInt(attendanceHeaders[i]) });
        }
    }

    // --- MANUAL FIXES & ADDITIONS ---
    const MANUAL_FIXES = {
        "72710305252": { name: "Nguyễn Lý Gia Hân" }, // Phụ huynh nói Master sai họ
        "72710305211": { classId: "DOLPHIN_2A" },    // Phùng Hoàng Thiên Hy chuyển lớp
        "72710305231": { classId: "DOLPHIN_2B" }     // Lê Gia Khánh chuyển lớp
    };

    const EXTRA_STUDENTS = [
        { id: "hanging_01", name: "Hải Long", class_id: "DOLPHIN_4B", tag: "HANGING", expiryDays: 60 },
        { id: "hanging_02", name: "Lin Min Hy", class_id: "DOLPHIN_4B", tag: "HANGING", expiryDays: 60 },
        { id: "trial_01", name: "Nguyễn Thành Gia Phát", class_id: "DOLPHIN_4B", tag: "TRIAL", expiryDays: 7 },
        { id: "hanging_03", name: "Phan Thái Hoàng Thiện", class_id: "DOLPHIN_4B", tag: "HANGING", expiryDays: 60 },
        { id: "hanging_04", name: "Thịnh", class_id: "DOLPHIN_4B", tag: "HANGING", expiryDays: 60 }
    ];

    const NAME_TO_ID_MAPPING = {
        "Phùng Hoàng Thiên Hi": "72710305211",
        "Lý Tinh Trạch": "72710305243",
        "Lê Thanh Tuyết": "72710305246",
        "Nguyễn Hoàng Nhã Thy": "72710305220",
        "Nguyễn Lý Gia Hân": "72710305252",
        "Nguyễn Thiên Thanh": "72710305207",
        "Mỹ Lan": "72710305208",
        "Tiểu Vy": "72710305210",
        "Trần Bùi Tuệ An": "72710305278",
        "Lê Gia Khánh": "72710305231"
    };

    // --- Tự động load ID từ backup JSON nếu có ---
    const BACKUP_JSON = path.join(__dirname, '../scratch/system_students_final.json');
    const autoMapping = new Map();
    if (fs.existsSync(BACKUP_JSON)) {
        try {
            const backupData = JSON.parse(fs.readFileSync(BACKUP_JSON, 'utf8'));
            const list = Array.isArray(backupData) ? (backupData[0]?.results || backupData) : (backupData.results || []);
            list.forEach(s => {
                const key = normalize(s.name, true) + '|' + normalize(s.class_id, true);
                autoMapping.set(key, s.id);
                // Thêm mapping theo tên duy nhất nếu không trùng
                if (!autoMapping.has(normalize(s.name, true))) {
                    autoMapping.set(normalize(s.name, true), s.id);
                }
            });
            console.log(`✅ Đã load ${autoMapping.size} ID từ backup JSON.`);
        } catch (e) {
            console.warn("⚠️ Không thể load backup JSON:", e.message);
        }
    }

    // Đảm bảo các lớp từ Manual Fixes và Extra Students cũng tồn tại
    Object.values(MANUAL_FIXES).forEach(f => {
        if (f.classId) classesToEnsure.add(f.classId.replace(/_/g, ' ')); // Dùng tên tạm từ ID
    });
    EXTRA_STUDENTS.forEach(s => {
        classesToEnsure.add(s.class_id.replace(/_/g, ' '));
    });

    const sqlCommands = [];
    sqlCommands.push('-- AUTO GENERATED IMPORT SQL (V4 Final Sync)');
    sqlCommands.push('PRAGMA foreign_keys = OFF;');
    sqlCommands.push('DELETE FROM fact_payments;');
    sqlCommands.push('DELETE FROM fact_billing_items;');
    sqlCommands.push('DELETE FROM fact_monthly_billing;');
    sqlCommands.push('DELETE FROM class_transfers;');
    sqlCommands.push('DELETE FROM audit_logs;'); // Xóa logs cũ nếu có
    sqlCommands.push('DELETE FROM trial_history;'); // Dọn kho lịch sử cũ
    sqlCommands.push('DELETE FROM dropout_history;'); // Dọn kho dropout cũ
    sqlCommands.push('DELETE FROM Raw_Attendance;');
    sqlCommands.push('DELETE FROM students;');
    sqlCommands.push('DELETE FROM classes;'); 
    sqlCommands.push('PRAGMA foreign_keys = ON;');

    // Đảm bảo các lớp tồn tại
    classesToEnsure.forEach(className => {
        const id = generateClassId(className);
        sqlCommands.push(`INSERT OR IGNORE INTO classes (id, name) VALUES ('${id}', '${className}');`);
    });

    const todayStr = new Date().toISOString().split('T')[0];

    // Insert Students from Master
    masterData.forEach(row => {
        let rawName = row['Họ và tên học sinh'] || '';
        let rawClass = row['Lớp'] || '';
        if (!rawName || !rawClass) return;

        let id = row['ID']?.toString();
        
        if (!id && rawName) {
            const key = normalize(rawName, true) + '|' + normalize(generateClassId(rawClass), true);
            id = autoMapping.get(key) || NAME_TO_ID_MAPPING[rawName] || autoMapping.get(normalize(rawName, true));
        }

        if (!id) {
            // Nếu vẫn không có ID, tạo ID tạm dựa trên STT và Class? 
            // Không, ta nên log để biết
            // console.warn(`⚠️ Không tìm thấy ID cho: ${rawName} (${rawClass})`);
            return; 
        }

        // Áp dụng Fixes
        if (MANUAL_FIXES[id]) {
            if (MANUAL_FIXES[id].name) rawName = MANUAL_FIXES[id].name;
            if (MANUAL_FIXES[id].classId) {
                // Ta giữ nguyên rawClass để lấy text, nhưng classId SQL sẽ khác
            }
        }
        
        const classId = MANUAL_FIXES[id]?.classId || generateClassId(rawClass);
        const status = 'ACTIVE';
        
        // Trích xuất thông tin mở rộng (dựa trên cấu trúc Excel đã research)
        const parentName = row['Phụ huynh'] || row['Dương Thị Mỹ Lệ'] || ''; 
        const birthday = row['Ngày sinh'] || row['29/09/2023'] || '';
        const address = row['Địa chỉ'] || row['Khu phố 1, Nội ô A, Thị trấn Gò Dầu, Tây Ninh'] || '';
        const phone = row['SĐT'] || row['0777130080'] || '';
        
        const birthYear = birthday ? birthday.toString().split('/').pop() : 'NULL';
        const nickname = extractNickname(row['Họ và tên học sinh'] || row['Nguyễn Thái Nam Dương']).nickname;

        sqlCommands.push(`INSERT INTO students (id, name, class_id, status, birth_year, nickname, parent_name, address, phone, birthday) VALUES ('${id}', '${rawName.replace(/'/g, "''")}', '${classId}', '${status}', ${birthYear}, ${nickname ? "'" + nickname.replace(/'/g, "''") + "'" : 'NULL'}, ${parentName ? "'" + parentName.toString().replace(/'/g, "''") + "'" : 'NULL'}, ${address ? "'" + address.toString().replace(/'/g, "''") + "'" : 'NULL'}, ${phone ? "'" + phone.toString().replace(/'/g, "''") + "'" : 'NULL'}, ${birthday ? "'" + birthday.toString().replace(/'/g, "''") + "'" : 'NULL'});`);
    });

    // Insert Extra Students (Trial/Hanging)
    EXTRA_STUDENTS.forEach(s => {
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + s.expiryDays);
        const expiryStr = expiryDate.toISOString().split('T')[0];

        sqlCommands.push(`INSERT INTO students (id, name, class_id, status, tag, tag_expiry) VALUES ('${s.id}', '${s.name}', '${s.class_id}', 'ACTIVE', '${s.tag}', '${expiryStr}');`);
    });

    // Insert Attendance
    let importedAttendanceCount = 0;
    attendanceLines.slice(1).forEach(line => {
        if (!line.trim()) return;
        const values = line.split(',');
        const row = {};
        attendanceHeaders.forEach((h, i) => row[h] = (values[i] || '').trim());

        const rawFullName = row['Họ và tên'] || '';
        const rawClass = row['Lớp'] || '';
        const { cleanName, nickname } = extractNickname(rawFullName);
        
        // Tìm ID sinh viên
        let studentId = null;
        let finalStudentName = rawFullName;

        // 1. Kiểm tra Mapping tên đặc biệt
        if (NAME_TO_ID_MAPPING[cleanName]) {
            studentId = NAME_TO_ID_MAPPING[cleanName];
            // Lấy tên thật từ master để log vào attendance cho đẹp
            const masterFix = Object.values(masterMap).find(m => m.ID == studentId);
            if (masterFix) finalStudentName = masterFix['Họ và tên học sinh'];
        } 
        // 2. Kiểm tra Special Cases (Extra)
        else {
            const extra = EXTRA_STUDENTS.find(e => e.name === cleanName);
            if (extra) {
                studentId = extra.id;
                finalStudentName = extra.name;
            }
        }

        // 3. Nếu chưa có, thử tìm bình thường
        if (!studentId) {
            const nameKey = normalize(cleanName, true) + '|' + normalize(rawClass, true);
            let masterRow = masterMap.get(nameKey);

            if (!masterRow) {
                const noAccentKey = normalize(cleanName, false) + '|' + normalize(rawClass, false);
                if (masterNoAccentMap.has(noAccentKey)) {
                    masterRow = masterMap.get(masterNoAccentMap.get(noAccentKey));
                } else {
                    for (const [mKey, mRow] of masterMap) {
                        if (normalize(mRow['Lớp']) === normalize(rawClass) && isSimilar(cleanName, mRow['Họ và tên học sinh'])) {
                            masterRow = mRow;
                            break;
                        }
                    }
                }
            }
            if (masterRow) {
                studentId = masterRow['ID'];
                finalStudentName = masterRow['Họ và tên học sinh'];
            }
        }

        if (studentId) {
            const classId = (studentId.startsWith('hanging_') || studentId.startsWith('trial_')) 
                ? EXTRA_STUDENTS.find(e => e.id === studentId).class_id
                : (MANUAL_FIXES[studentId]?.classId || generateClassId(rawClass));
            
            dayColumns.forEach(dayInfo => {
                const statusChar = row[attendanceHeaders[dayInfo.index]];
                if (statusChar && statusChar.toLowerCase() !== '') {
                    let status = 'PRESENT';
                    if (['v', 'phep', 'l', 'p', 'cl', 'ntt', 'nl'].includes(statusChar.toLowerCase())) {
                        status = (statusChar.toLowerCase() === 'cl') ? 'TRANSFER' : 'ABSENT';
                    }
                    if (statusChar.toLowerCase() === 'x') status = 'PRESENT';
                    
                    const date = `2026-04-${dayInfo.day.toString().padStart(2, '0')}`;
                    sqlCommands.push(`INSERT INTO Raw_Attendance (student_id, student_name, class_id, date, status) VALUES ('${studentId}', '${finalStudentName.replace(/'/g, "''")}', '${classId}', '${date}', '${status}');`);
                    importedAttendanceCount++;
                }
            });
        }
    });

    fs.writeFileSync(SQL_OUTPUT_FILE, sqlCommands.join('\n'), 'utf8');
    console.log(`✅ Đã tạo xong file SQL: ${SQL_OUTPUT_FILE}`);
    console.log(`Dự kiến nạp: ${masterData.length + EXTRA_STUDENTS.length} học sinh và ${importedAttendanceCount} bản ghi điểm danh.`);
}

runImport();
