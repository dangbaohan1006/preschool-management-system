const fs = require('fs');
const path = require('path');

const STUDENTS_JSON = path.join(__dirname, '../scratch/system_students_final.json');
const SQL_OUTPUT = path.join(__dirname, '../restore_students.sql');

let raw = fs.readFileSync(STUDENTS_JSON, 'utf8').trim();
// Handle case where it might be wrapped in wrangler results
if (raw.startsWith('[') && !raw.includes('"results"')) {
    // Array at root
} else {
    try {
        let parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            if (parsed[0] && parsed[0].results) {
                raw = JSON.stringify(parsed[0].results);
            }
        } else if (parsed.results) {
            raw = JSON.stringify(parsed.results);
        }
    } catch (e) {}
}

const students = JSON.parse(raw);
const studentsList = Array.isArray(students) ? students : (students.results || []);

const sql = studentsList.map(s => {
    return `INSERT OR REPLACE INTO students (id, name, class_id, status, birth_year, address, birthday) VALUES ('${s.id}', '${s.name.replace(/'/g, "''")}', '${s.class_id}', '${s.status}', ${s.birth_year || 'NULL'}, ${s.address ? "'" + s.address.replace(/'/g, "''") + "'" : 'NULL'}, ${s.birthday ? "'" + s.birthday.replace(/'/g, "''") + "'" : 'NULL'});`;
});

const finalSql = `PRAGMA foreign_keys = OFF;\n${sql.join('\n')}\nPRAGMA foreign_keys = ON;`;
fs.writeFileSync(SQL_OUTPUT, finalSql, 'utf8');
console.log(`Generated ${sql.length} insert statements.`);
