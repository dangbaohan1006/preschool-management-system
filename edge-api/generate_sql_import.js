const fs = require('fs');
const path = require('path');

// Configuration
const CSV_FILE = path.join(__dirname, '../ĐIỂM DANH THÁNG 04.csv');
const STUDENTS_FILE = path.join(__dirname, './students_data.json');
const SQL_OUTPUT_FILE = path.join(__dirname, './import_april_attendance.sql');
const MONTH = '2026-04';

// Class mapping
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

// Status mapping
const STATUS_MAP = {
    'x': 'PRESENT',      // có mặt
    'p': 'ABSENT',       // nghỉ có phép
    'P': 'ABSENT',       // nghỉ có phép
    'cl': 'TRANSFER',    // chuyển lớp
    'CL': 'TRANSFER',    // chuyển lớp
    'nl': 'ABSENT',      // nghỉ luôn
    'NL': 'ABSENT',      // nghỉ luôn
    'v': 'ABSENT',       // vắng
    'V': 'ABSENT',
    'l': 'ABSENT',       // leave
    'L': 'ABSENT',
    '': null             // blank - skip
};

function normalize(str) {
    if (!str) return '';
    return str.toString().trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd');
}

function parseCSV(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/).filter(line => line.trim());
    
    const records = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        
        const className = values[0];
        const stt = values[1];
        const studentName = values[2];
        const gender = values[3];
        
        if (!className || !studentName) continue;
        
        // Parse all 30 days
        for (let dayIndex = 5; dayIndex < values.length && dayIndex - 5 <= 30; dayIndex++) {
            const day = dayIndex - 4;
            const status = values[dayIndex] || '';
            
            records.push({
                className,
                stt,
                studentName,
                day,
                status
            });
        }
    }
    
    return records;
}

function loadStudentsData(filePath) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    const studentsByClass = {};
    const studentsByNameAndClass = {};
    
    data.forEach(student => {
        if (!studentsByClass[student.class_id]) {
            studentsByClass[student.class_id] = [];
        }
        studentsByClass[student.class_id].push(student);
        
        const normalizedName = normalize(student.name);
        const key = `${student.class_id}|${normalizedName}`;
        studentsByNameAndClass[key] = student;
    });
    
    return { studentsByClass, studentsByNameAndClass };
}

function levenshteinDistance(a, b) {
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

function findBestMatch(csvName, classId, studentsByClass) {
    const normalizeCsv = normalize(csvName);
    const students = studentsByClass[classId] || [];
    
    let bestMatch = null;
    let bestDistance = Infinity;
    
    students.forEach(student => {
        const normalizedName = normalize(student.name);
        const distance = levenshteinDistance(normalizeCsv, normalizedName);
        
        if (distance < bestDistance) {
            bestDistance = distance;
            bestMatch = student;
        }
    });
    
    if (bestMatch && bestDistance <= Math.max(4, Math.floor(Math.max(normalizeCsv.length, normalize(bestMatch.name).length) * 0.4))) {
        return bestMatch;
    }
    
    return null;
}

function escapeSql(str) {
    if (!str) return 'NULL';
    return "'" + str.toString().replace(/'/g, "''") + "'";
}

function main() {
    console.log('🔍 Parsing CSV file...');
    const records = parseCSV(CSV_FILE);
    console.log(`✅ Parsed ${records.length} attendance records from CSV`);
    
    console.log('\n📚 Loading students data...');
    const studentsData = loadStudentsData(STUDENTS_FILE);
    const { studentsByClass, studentsByNameAndClass } = studentsData;
    
    console.log('\n🔄 Converting to SQL and matching students...');
    const sqlStatements = [];
    let matched = 0;
    let unmatched = 0;
    
    for (const record of records) {
        const { className, stt, studentName, day, status } = record;
        
        if (!studentName) continue;
        
        const classId = CLASS_MAP[className];
        if (!classId) continue;
        
        // Try exact match
        const normalizedName = normalize(studentName);
        let student = studentsByNameAndClass[`${classId}|${normalizedName}`];
        
        // Try fuzzy match
        if (!student) {
            student = findBestMatch(studentName, classId, studentsByClass);
        }
        
        if (!student) {
            unmatched++;
            continue;
        }
        
        matched++;
        
        const attendanceStatus = STATUS_MAP[status];
        
        // Skip if no status (blank in CSV)
        if (!attendanceStatus) {
            continue;
        }
        
        const date = `${MONTH}-${String(day).padStart(2, '0')}`;
        
        // Generate SQL INSERT
        const sql = `INSERT INTO Raw_Attendance (student_id, student_name, class_id, date, status, details, edge_sync_status, created_by_teacher_id) ` +
            `VALUES (${escapeSql(student.id)}, ${escapeSql(student.name)}, ${escapeSql(classId)}, ${escapeSql(date)}, ${escapeSql(attendanceStatus)}, '', 0, 'IMPORT_APRIL_2026');`;
        
        sqlStatements.push(sql);
    }
    
    console.log(`✅ Matched ${matched} records, Unmatched: ${unmatched}`);
    
    // Write to file
    const sqlContent = `-- April 2026 Attendance Import (${new Date().toISOString()})
-- Total Records: ${sqlStatements.length}

${sqlStatements.join('\n')}
`;
    
    fs.writeFileSync(SQL_OUTPUT_FILE, sqlContent);
    console.log(`\n💾 SQL file generated: ${SQL_OUTPUT_FILE}`);
    console.log(`📊 Total SQL statements: ${sqlStatements.length}`);
    
    // Show sample
    console.log('\n📋 Sample SQL statements:');
    sqlStatements.slice(0, 3).forEach(sql => console.log(sql));
    console.log('...\n');
    
    console.log('✅ Ready to import via Wrangler D1!');
    console.log('\n🚀 Run this command to import:');
    console.log('   npx wrangler d1 execute preschool-buffer --remote --file=./import_april_attendance.sql');
}

main();
