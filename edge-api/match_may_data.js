const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const students = JSON.parse(fs.readFileSync('students.json', 'utf8'));
const classes = JSON.parse(fs.readFileSync('classes.json', 'utf8'));

const filePath = path.join(__dirname, '..', 'DANH SÁCH TRẺ 2026 - T05.xls');
const workbook = XLSX.readFile(filePath);

function normalizeName(name) {
    if (!name) return '';
    let n = name.toString().trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[đĐ]/g, 'd')
        .replace(/\s+/g, ' ');
    n = n.replace(/hy/g, 'hi');
    return n;
}

function normalizePhone(p) {
    if (!p) return '';
    return p.toString().replace(/[^0-9]/g, '').replace(/^84/, '0');
}

const classMap = {};
classes.forEach(c => {
    classMap[c.id] = normalizeName(c.name);
});

const results = {
    matches: [],
    name_mismatches: [],
    missing_in_db: [],
    missing_in_excel: [],
    updates: []
};

const excelStudents = [];
workbook.SheetNames.forEach(sheetName => {
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    data.forEach(row => {
        if (row[0] && !isNaN(row[0]) && row[1]) {
            excelStudents.push({
                name: row[1].trim(),
                parent: row[2] ? row[2].toString().trim() : '',
                className: row[3] ? row[3].toString().trim() : sheetName,
                birthday: row[5] ? row[5].toString().trim() : '',
                phone: normalizePhone(row[7]),
                sheet: sheetName
            });
        }
    });
});

const dbMatchedIndices = new Set();

excelStudents.forEach(ex => {
    const normExName = normalizeName(ex.name);
    const normExClass = normalizeName(ex.className);
    
    // 1. Exact match
    let matchIndex = students.findIndex((s, index) => {
        if (dbMatchedIndices.has(index)) return false;
        return normalizeName(s.name) === normExName;
    });

    // 2. Substring match + Class match
    if (matchIndex === -1) {
        matchIndex = students.findIndex((s, index) => {
            if (dbMatchedIndices.has(index)) return false;
            const normDbName = normalizeName(s.name);
            const normDbClass = classMap[s.class_id] || '';
            const isNameRelated = normExName.includes(normDbName) || normDbName.includes(normExName);
            const isClassRelated = normExClass.includes(normDbClass) || normDbClass.includes(normExClass) || normExClass === 'tho trang' && normDbClass === 'tho trang';
            return isNameRelated && isClassRelated;
        });
    }

    if (matchIndex !== -1) {
        const match = students[matchIndex];
        dbMatchedIndices.add(matchIndex);

        if (match.name.trim() !== ex.name.trim()) {
            results.name_mismatches.push({ db: match.name, excel: ex.name, id: match.id });
        }

        const update = {};
        if (ex.parent && match.parent_name !== ex.parent) {
            update.parent_name = ex.parent;
        }
        const dbPhone = normalizePhone(match.phone);
        if (ex.phone && dbPhone !== ex.phone) {
            update.phone = ex.phone;
        }
        const cleanExBirthday = ex.birthday.replace(/[^0-9\/]/g, '');
        if (cleanExBirthday && match.birthday !== cleanExBirthday && cleanExBirthday.length >= 6) {
            update.birthday = cleanExBirthday;
        }

        if (Object.keys(update).length > 0) {
            results.updates.push({ id: match.id, name: ex.name, updates: update });
        }
        results.matches.push({ id: match.id, name: ex.name });
    } else {
        results.missing_in_db.push(ex);
    }
});

students.forEach((s, index) => {
    if (!dbMatchedIndices.has(index)) {
        results.missing_in_excel.push(s);
    }
});

let sql = '-- Updates from May Excel List\n';
results.updates.forEach(up => {
    const sets = Object.entries(up.updates).map(([k, v]) => `${k} = '${v.replace(/'/g, "''")}'`).join(', ');
    sql += `UPDATE students SET ${sets} WHERE id = '${up.id}'; -- ${up.name}\n`;
});

// We generate name updates too but keep them commented or separate
let nameSql = '-- Name Corrections (Optional)\n';
results.name_mismatches.forEach(mm => {
    nameSql += `UPDATE students SET name = '${mm.excel.replace(/'/g, "''")}' WHERE id = '${mm.id}'; -- From ${mm.db}\n`;
});

fs.writeFileSync('update_may_data.sql', sql + '\n' + nameSql);

const report = `
# Báo cáo đối soát dữ liệu trẻ - Tháng 05/2026

## Tổng quan
- Tổng số bé trong Excel: ${excelStudents.length}
- Tổng số bé ACTIVE trong hệ thống: ${students.length}
- Số bé khớp thành công: ${results.matches.length}

## Cập nhật thông tin (${results.updates.length} bé)
${results.updates.length > 0 ? 'Phát hiện sự sai lệch thông tin Phụ huynh/SĐT/Ngày sinh. Đã tạo lệnh cập nhật trong `update_may_data.sql`.' : 'Dữ liệu Phụ huynh, SĐT và Ngày sinh của các bé đã khớp hoàn toàn với hệ thống.'}

## Bé có trong Excel nhưng KHÔNG tìm thấy trong hệ thống (${results.missing_in_db.length} bé)
Các bé này có thể là học sinh mới hoặc tên sai khác quá nhiều:
${results.missing_in_db.map(s => `- ${s.name} (${s.className})`).join('\n')}

## Bé có trong hệ thống nhưng KHÔNG có trong Excel (${results.missing_in_excel.length} bé)
Các bé này có thể đã nghỉ học hoặc không có tên trong danh sách tháng 5:
${results.missing_in_excel.map(s => `- ${s.name} (${s.class_id})`).join('\n')}

## Các trường hợp khớp tên gần đúng (Hệ thống -> Excel)
${results.name_mismatches.map(m => `- "${m.db}" -> "${m.excel}" (ID: ${m.id})`).join('\n')}
`;

fs.writeFileSync('matching_report.md', report);
console.log(`Summary: ${results.matches.length} matches, ${results.updates.length} updates.`);
