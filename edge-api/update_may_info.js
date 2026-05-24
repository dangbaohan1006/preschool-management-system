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

const results = {
    updates: []
};

const dbMatchedIndices = new Set();

excelStudents.forEach(ex => {
    const normExName = normalizeName(ex.name);
    const normExClass = normalizeName(ex.className);
    
    let matchIndex = students.findIndex((s, index) => {
        if (dbMatchedIndices.has(index)) return false;
        return normalizeName(s.name) === normExName;
    });

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

        const update = {};
        
        // Parent Name
        if (ex.parent && (match.parent_name || '').trim() !== ex.parent) {
            update.parent_name = ex.parent;
        }
        
        // Phone
        const dbPhone = normalizePhone(match.phone);
        if (ex.phone && dbPhone !== ex.phone) {
            update.phone = ex.phone;
        }

        // Birthday & Birth Year
        const cleanExBirthday = ex.birthday.replace(/[^0-9\/]/g, '');
        if (cleanExBirthday && (match.birthday || '').trim() !== cleanExBirthday) {
            // Only update if it's a valid looking date or year
            if (cleanExBirthday.length >= 4) {
                update.birthday = cleanExBirthday;
                
                // Extract year
                const yearMatch = cleanExBirthday.match(/\d{4}$/);
                if (yearMatch) {
                    const year = parseInt(yearMatch[0]);
                    if (match.birth_year !== year) {
                        update.birth_year = year;
                    }
                }
            }
        }

        if (Object.keys(update).length > 0) {
            results.updates.push({ id: match.id, name: match.name, exName: ex.name, updates: update });
        }
    }
});

let sql = '-- Update Parent Name, Phone, Birthday, and Birth Year from May Excel List\n';
results.updates.forEach(up => {
    const sets = Object.entries(up.updates).map(([k, v]) => {
        if (typeof v === 'number') return `${k} = ${v}`;
        return `${k} = '${v.toString().replace(/'/g, "''")}'`;
    }).join(', ');
    sql += `UPDATE students SET ${sets} WHERE id = '${up.id}'; -- ${up.name} (Excel: ${up.exName})\n`;
});

fs.writeFileSync('update_may_info.sql', sql);
console.log(`Matching completed. Found ${results.updates.length} students needing updates.`);
if (results.updates.length > 0) {
    console.log('Sample update:', results.updates[0]);
}
