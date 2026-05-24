const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const MASTER_FILE = path.join(__dirname, '../DANH SÁCH TRẺ 2026 - T04.xlsx');
const ATTENDANCE_FILE = path.join(__dirname, '../ĐIỂM DANH THÁNG - 13 LỚP - Tháng 4.csv');

// --- MANUAL OVERRIDES ---
const MANUAL_MAPPINGS = {
    "Phùng Hoàng Thiên Hi": { masterName: "Phùng Hoàng Thiên Hy", masterClass: "Dolphin 2A" },
    "Lê Gia Khánh": { masterName: "Lê Gia Khánh", masterClass: "Dolphin 2B" },
    "Lê Thanh Tuyết": "Lê Thanh Thiên Tuyết",
    "Nguyễn Hoàng Nhã Thy": "Lê Hoàng Nhã Thy",
    "Nguyễn Thiên Thanh": "Phạm Nguyễn Thiên Thanh",
    "Mỹ Lan": "Phạm Mỹ Lan",
    "Tiểu Vy": "Huỳnh Lê Tiểu Vy",
    "Trần Bùi Tuệ An": "Bùi Trần Tuệ An",
    "Lý Tinh Trạch": "LI XINGZE (Lý Tinh Trạch)",
    "Nguyễn Lý Gia Hân": "Lý Nguyễn Gia Hân"
};

const SPECIAL_CASES = {
    "Hải Long": { id: "hanging_01", note: "Treo sĩ số (Hanging)" },
    "Lin Min Hy": { id: "hanging_02", note: "Treo sĩ số (Hanging)" },
    "Nguyễn Thành Gia Phát": { id: "trial_01", note: "Học trải nghiệm (Trial)" },
    "Lê Gia Khánh": { id: "72710305XXX", note: "Học sinh mới - Chuyển sang DOL 2B" }
};

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
    for (let i = 0; i <= a.length; i++) {
        tmp[i] = [i];
    }
    for (let j = 0; j <= b.length; j++) {
        tmp[0][j] = j;
    }
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
    // Cho phép sai lệch khoảng 25% độ dài chuỗi
    return dist <= Math.max(2, Math.floor(Math.min(n1.length, n2.length) * 0.25));
}

function runComparison() {
    console.log('--- ĐANG BẮT ĐẦU ĐỐI SOÁT DỮ LIỆU (CÓ XỬ LÝ NICKNAME) ---');

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

    masterData.forEach(row => {
        const rawName = row['Họ và tên học sinh'] || '';
        const rawClass = row['Lớp'] || '';
        if (!rawName) return;

        const name = normalize(rawName, true);
        const className = normalize(rawClass, true);
        const key = `${name}|${className}`;
        masterMap.set(key, row);

        const noAccentKey = `${normalize(rawName, false)}|${normalize(rawClass, false)}`;
        masterNoAccentMap.set(noAccentKey, key);
    });

    console.log(`Master List: Có ${masterMap.size} học sinh.`);

    // 2. Đọc Attendance List
    const attendanceContent = fs.readFileSync(ATTENDANCE_FILE, 'utf8');
    const attendanceLines = attendanceContent.split(/\r?\n/);
    const attendanceHeaders = attendanceLines[0].split(',');
    
    const attendanceMap = new Map();
    attendanceLines.slice(1).forEach(line => {
        if (!line.trim()) return;
        const values = line.split(',');
        const row = {};
        attendanceHeaders.forEach((h, i) => row[h] = values[i]);

        const rawFullName = row['Họ và tên'] || '';
        const { cleanName, nickname } = extractNickname(rawFullName);
        row._cleanName = cleanName;
        row._nickname = nickname;

        const name = normalize(cleanName, true);
        const className = normalize(row['Lớp'], true);
        if (!name || !className) return; 
        const key = `${name}|${className}`;
        attendanceMap.set(key, row);
    });

    console.log(`Attendance List: Có ${attendanceMap.size} học sinh.`);

    // 3. So sánh
    const suggestedFixes = [];
    const matchedMasterKeys = new Set();
    const finalMissingInMaster = [];

    for (const [key, attendanceRow] of attendanceMap) {
        const cleanName = attendanceRow._cleanName;
        const className = attendanceRow['Lớp'];

        // 1. Kiểm tra Manual Mapping trước (Xử lý các em đổi tên/sai khác nhiều)
        const mapped = MANUAL_MAPPINGS[cleanName];
        if (mapped) {
            const mName = typeof mapped === 'object' ? mapped.masterName : mapped;
            const mClass = typeof mapped === 'object' ? mapped.masterClass : className;
            
            const masterKeyExact = `${normalize(mName, true)}|${normalize(mClass, true)}`;
            if (masterMap.has(masterKeyExact)) {
                const mRow = masterMap.get(masterKeyExact);
                suggestedFixes.push({
                    attendance: attendanceRow['Họ và tên'],
                    master: mRow['Họ và tên học sinh'],
                    class: mClass,
                    actualAttendanceClass: className,
                    nickname: attendanceRow._nickname,
                    id: mRow['ID'],
                    reason: 'Ánh xạ thủ công (Xác nhận từ User)'
                });
                matchedMasterKeys.add(masterKeyExact);
                continue;
            }
        }

        // 2. Kiểm tra Special Cases (Học thử, Treo sĩ số)
        if (SPECIAL_CASES[cleanName]) {
            suggestedFixes.push({
                attendance: attendanceRow['Họ và tên'],
                master: `(N/A - ${SPECIAL_CASES[cleanName].note})`,
                class: className,
                nickname: attendanceRow._nickname,
                id: SPECIAL_CASES[cleanName].id,
                reason: SPECIAL_CASES[cleanName].note
            });
            continue;
        }

        // 3. Khớp chính xác hoàn toàn
        if (masterMap.has(key)) {
            matchedMasterKeys.add(key);
            continue;
        }

        // 4. Khớp không dấu / Sai dấu nhẹ
        const noAccentKey = `${normalize(cleanName, false)}|${normalize(className, false)}`;
        if (masterNoAccentMap.has(noAccentKey)) {
            const originalMasterKey = masterNoAccentMap.get(noAccentKey);
            const mRow = masterMap.get(originalMasterKey);
            suggestedFixes.push({
                attendance: attendanceRow['Họ và tên'],
                master: mRow['Họ và tên học sinh'],
                class: className,
                nickname: attendanceRow._nickname,
                id: mRow['ID'],
                reason: 'Sai dấu/Typo nhẹ'
            });
            matchedMasterKeys.add(originalMasterKey);
        } else {
            finalMissingInMaster.push(attendanceRow);
        }
    }

    const missingInAttendance = [];
    for (const [key, masterRow] of masterMap) {
        if (!matchedMasterKeys.has(key)) {
            missingInAttendance.push(masterRow);
        }
    }

    // Fuzzy Match cho những em còn lại
    const fuzzySuggestions = [];
    const trulyMissingInMaster = [];
    
    finalMissingInMaster.forEach(att => {
        let found = false;
        for (let i = 0; i < missingInAttendance.length; i++) {
            const mas = missingInAttendance[i];
            const masKey = `${normalize(mas['Họ và tên học sinh'], true)}|${normalize(mas['Lớp'], true)}`;
            if (matchedMasterKeys.has(masKey)) continue;

            const sameClass = normalize(att['Lớp']) === normalize(mas['Lớp']);
            if (sameClass && isSimilar(att._cleanName, mas['Họ và tên học sinh'])) {
                fuzzySuggestions.push({
                    attendance: att['Họ và tên'],
                    master: mas['Họ và tên học sinh'],
                    class: att['Lớp'],
                    nickname: att._nickname,
                    id: mas['ID'],
                    reason: 'Gần giống (Fuzzy Match)'
                });
                matchedMasterKeys.add(masKey);
                found = true;
                break;
            }
        }
        if (!found) trulyMissingInMaster.push(att);
    });

    const finalMissingInAttendance = [];
    for (const [key, masterRow] of masterMap) {
        if (!matchedMasterKeys.has(key)) {
            finalMissingInAttendance.push(masterRow);
        }
    }

    // 4. Báo cáo Markdown
    let md = '# Báo cáo Đối soát Dữ liệu học sinh Tháng 4/2026 (v4 - Final Sync)\n\n';
    md += `Thời gian thực hiện: ${new Date().toLocaleString('vi-VN')}\n\n`;

    // Nhóm 1: Gợi ý Khớp dữ liệu (Độ tin cậy cao + Thủ công)
    md += '## 1. Xác nhận Khớp dữ liệu (Thủ công & Tự động)\n';
    md += 'Các trường hợp này đã được xác nhận khớp dựa trên ánh xạ thủ công hoặc sai lệch dấu nhẹ.\n\n';
    if (suggestedFixes.length > 0) {
        md += '| STT | Tên trong Điểm danh | Biệt danh | Tên trong Master List | ID dự kiến | Ghi chú |\n';
        md += '|-----|----------------------|-----------|-----------------------|------------|---------|\n';
        suggestedFixes.forEach((f, i) => {
            md += `| ${i+1} | ${f.attendance} | ${f.nickname || '-'} | ${f.master} | ${f.id} | ${f.reason} |\n`;
        });
    } else {
        md += 'Không có trường hợp nào.\n';
    }
    md += '\n';

    // Nhóm 2: Gợi ý Fuzzy Match
    md += '## 2. Gợi ý Khớp mờ (Cần kiểm tra lại)\n';
    md += 'Các trường hợp này có tên gần giống nhau nhưng sai khác họ hoặc có lỗi chính tả nặng hơn.\n\n';
    if (fuzzySuggestions.length > 0) {
        md += '| STT | Tên trong Điểm danh | Biệt danh | Tên trong Master List | ID dự kiến | Kết quả đối soát |\n';
        md += '|-----|----------------------|-----------|-----------------------|------------|------------------|\n';
        fuzzySuggestions.forEach((f, i) => {
            md += `| ${i+1} | ${f.attendance} | ${f.nickname || '-'} | ${f.master} | ${f.id} | ${f.reason} |\n`;
        });
    } else {
        md += 'Không tìm thấy gợi ý mờ nào thêm.\n';
    }
    md += '\n';

    // Nhóm 3: Thực sự thiếu
    md += '## 3. Học sinh có trong Điểm danh nhưng KHÔNG CÓ trong Master List\n';
    md += 'Các em này không tìm thấy bất kỳ ai giống trong Master List và chưa có hướng xử lý.\n\n';
    if (trulyMissingInMaster.length > 0) {
        md += '| STT | Họ và tên | Biệt danh | Lớp | Tình trạng |\n';
        md += '|-----|-----------|-----------|-----|-----------|\n';
        trulyMissingInMaster.forEach((s, i) => {
            md += `| ${i+1} | ${s['Họ và tên']} | ${s._nickname || '-'} | ${s['Lớp']} | Không tìm thấy trong Master |\n`;
        });
    } else {
        md += '✅ Toàn bộ điểm danh đã tìm được người tương ứng hoặc đã nạp diện đặc biệt.\n';
    }
    md += '\n';

    // Nhóm 4: Missing in Attendance
    md += '## 4. Học sinh có trong Master List nhưng KHÔNG THẤY Điểm danh\n';
    if (finalMissingInAttendance.length > 0) {
        md += '| STT | Họ và tên | Lớp | ID | Tình trạng |\n';
        md += '|-----|-----------|-----|----|-----------|\n';
        finalMissingInAttendance.forEach((s, i) => {
            md += `| ${i+1} | ${s['Họ và tên học sinh']} | ${s['Lớp']} | ${s['ID']} | Có trong Master, thiếu Điểm danh |\n`;
        });
    } else {
        md += '✅ Toàn bộ học sinh trong Master đã có điểm danh.\n';
    }

    const reportPath = path.join(__dirname, '../report.md');
    fs.writeFileSync(reportPath, md, 'utf8');

    console.log(`\n✅ Đã xuất báo cáo chi tiết v3 ra file: ${reportPath}`);
}

try {
    runComparison();
} catch (err) {
    console.error('Lỗi khi đối soát:', err.message);
}
