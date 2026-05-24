const fs = require('fs');
const path = require('path');

// Configuration
const CSV_FILE = path.join(__dirname, '../ĐIỂM DANH THÁNG 04.csv');
const STUDENTS_FILE = path.join(__dirname, './students_data.json');

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
    
    const headers = lines[0].split(',').map(h => h.trim());
    const records = [];
    const seenNames = new Set();
    
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        
        const className = values[0];
        const stt = values[1];
        const studentName = values[2];
        
        if (!className || !studentName) continue;
        
        const key = `${className}|${studentName}`;
        if (!seenNames.has(key)) {
            seenNames.add(key);
            records.push({
                className,
                stt,
                studentName
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
            bestMatch = { student, distance };
        }
    });
    
    return bestMatch;
}

function checkMatches() {
    console.log('🔍 Checking student matches...\n');
    
    const csvRecords = parseCSV(CSV_FILE);
    const studentsData = loadStudentsData(STUDENTS_FILE);
    const { studentsByClass, studentsByNameAndClass } = studentsData;
    
    console.log(`📋 CSV has ${csvRecords.length} unique students`);
    console.log(`📚 System has ${Object.values(studentsByClass).reduce((sum, arr) => sum + arr.length, 0)} students\n`);
    
    const notMatched = [];
    const matched = [];
    
    csvRecords.forEach(csvRecord => {
        const { className, stt, studentName } = csvRecord;
        const classId = CLASS_MAP[className];
        
        if (!classId) {
            notMatched.push({ studentName, className, reason: 'Unknown class' });
            return;
        }
        
        // Try exact match
        const normalizedName = normalize(studentName);
        let student = studentsByNameAndClass[`${classId}|${normalizedName}`];
        
        if (student) {
            matched.push({ csvName: studentName, systemName: student.name, studentId: student.id, className });
            return;
        }
        
        // Try fuzzy match
        const bestMatch = findBestMatch(studentName, classId, studentsByClass);
        
        if (bestMatch && bestMatch.distance <= 3) {
            matched.push({ 
                csvName: studentName, 
                systemName: bestMatch.student.name, 
                studentId: bestMatch.student.id, 
                className,
                distance: bestMatch.distance
            });
        } else {
            notMatched.push({ 
                studentName, 
                className, 
                closestMatch: bestMatch ? `${bestMatch.student.name} (distance: ${bestMatch.distance})` : 'No match found',
                reason: 'No good match'
            });
        }
    });
    
    console.log(`✅ Matched: ${matched.length} students`);
    console.log(`❌ Not matched: ${notMatched.length} students\n`);
    
    if (notMatched.length > 0) {
        console.log('------- Not Matched Students -------');
        notMatched.forEach(item => {
            console.log(`\n${item.studentName} (${item.className})`);
            console.log(`  Reason: ${item.reason}`);
            if (item.closestMatch) {
                console.log(`  Closest: ${item.closestMatch}`);
            }
        });
    }
    
    console.log('\n------- Sample Matched -------');
    matched.slice(0, 10).forEach(item => {
        console.log(`\n${item.csvName} → ${item.systemName} (ID: ${item.studentId})`);
        if (item.distance) {
            console.log(`  Distance: ${item.distance}`);
        }
    });
    
    if (matched.length > 10) {
        console.log(`\n... and ${matched.length - 10} more matched students`);
    }
}

checkMatches();
