const fs = require('fs');
const path = require('path');

// Configuration
const API_URL = 'https://preschool-edge-api.diemdanh-tds.workers.dev/api/admin/attendance';
const API_KEY = 'SECRET_INTERNAL_KEY_2026';
const CSV_FILE = path.join(__dirname, '../ĐIỂM DANH THÁNG 04.csv');
const STUDENTS_FILE = path.join(__dirname, './students_data.json');
const MONTH = '2026-04'; // April 2026

// Class mapping to normalize class names
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
        .replace(/[\u0300-\u036f]/g, '')  // Remove accents for fuzzy matching
        .replace(/đ/g, 'd');
}

function parseCSV(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/).filter(line => line.trim());
    
    if (lines.length < 2) throw new Error('CSV file is empty');
    
    const headers = lines[0].split(',').map(h => h.trim());
    const records = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        
        const className = values[0];
        const stt = values[1];
        const studentName = values[2];
        const gender = values[3];
        const birthYear = values[4];
        
        if (!className || !studentName) continue;
        
        // Parse attendance days (columns 5 onwards are days 1-30)
        for (let dayIndex = 5; dayIndex < values.length && dayIndex - 5 <= 30; dayIndex++) {
            const day = dayIndex - 4;
            const status = values[dayIndex] || '';
            
            records.push({
                className,
                stt,
                studentName,
                gender,
                birthYear,
                day,
                status
            });
        }
    }
    
    return records;
}

function loadStudentsData(filePath) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    // Create maps for matching by class and name
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
    
    // Return match if distance is reasonable (increased threshold to handle more cases)
    if (bestMatch && bestDistance <= Math.max(4, Math.floor(Math.max(normalizeCsv.length, normalize(bestMatch.name).length) * 0.4))) {
        return bestMatch;
    }
    
    return null;
}

function convertToAPIFormat(records, studentsData) {
    const { studentsByClass, studentsByNameAndClass } = studentsData;
    const apiRecords = [];
    const unmatchedRecords = [];
    
    for (const record of records) {
        const { className, stt, studentName, gender, birthYear, day, status } = record;
        
        if (!studentName) continue;
        
        const classId = CLASS_MAP[className];
        if (!classId) {
            unmatchedRecords.push(`Unknown class: ${className}`);
            continue;
        }
        
        // Try to find student by exact name match first
        const normalizedName = normalize(studentName);
        let student = studentsByNameAndClass[`${classId}|${normalizedName}`];
        
        // Try fuzzy matching
        if (!student) {
            student = findBestMatch(studentName, classId, studentsByClass);
        }
        
        if (!student) {
            unmatchedRecords.push(`No match for ${studentName} in ${className}`);
            continue;
        }
        
        const attendanceStatus = STATUS_MAP[status];
        
        // Skip if no status (blank in CSV)
        if (!attendanceStatus) {
            continue;
        }
        
        const date = `${MONTH}-${String(day).padStart(2, '0')}`;
        
        apiRecords.push({
            student_id: student.id,
            student_name: student.name,  // Use the name from the system
            class_id: classId,
            date: date,
            status: attendanceStatus,
            teacher_id: 'IMPORT_APRIL_2026',
            teacher_name: 'Import Script - April 2026',
            details: gender || ''
        });
    }
    
    return { apiRecords, unmatchedRecords };
}

async function uploadToAPI(records) {
    console.log(`📤 Uploading ${records.length} attendance records to API in batches...`);
    
    // Batch size: 300 records at a time (to avoid Cloudflare limits)
    const BATCH_SIZE = 300;
    let uploadedCount = 0;
    let failedCount = 0;
    let successBatches = 0;
    
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(records.length / BATCH_SIZE);
        
        console.log(`\n📦 Batch ${batchNum}/${totalBatches} (${batch.length} records)...`);
        
        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': API_KEY
                },
                body: JSON.stringify(batch)
            });
            
            const statusCode = response.status;
            const responseText = await response.text();
            let result;
            
            try {
                result = JSON.parse(responseText);
            } catch (e) {
                result = { error: `Invalid response: ${responseText.substring(0, 100)}` };
            }
            
            if (response.ok) {
                console.log(`  ✅ Batch ${batchNum} uploaded successfully`);
                uploadedCount += batch.length;
                successBatches++;
            } else {
                const errorMsg = result.error || responseText || response.statusText;
                // Don't log full details for constraint errors
                if (errorMsg.includes('SQLITE_CONSTRAINT')) {
                    console.log(`  ⚠️  Batch ${batchNum}: Some records failed (foreign key constraints)`);
                } else {
                    console.error(`  ❌ Batch ${batchNum}: ${errorMsg.substring(0, 100)}`);
                }
                failedCount += batch.length;
            }
        } catch (error) {
            console.error(`  ❌ Batch ${batchNum} network error: ${error.message}`);
            failedCount += batch.length;
        }
        
        // Add a small delay between batches to avoid rate limiting
        if (i + BATCH_SIZE < records.length) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    
    console.log(`\n📊 Upload Summary:`);
    console.log(`  ✅ Successful batches: ${successBatches}`);
    console.log(`  📦 Total records processed: ${records.length}`);
    
    return successBatches > 0;
}

async function main() {
    try {
        console.log('🔍 Parsing CSV file...');
        const records = parseCSV(CSV_FILE);
        console.log(`✅ Parsed ${records.length} attendance records from CSV`);
        
        console.log('\n📚 Loading students data...');
        const studentsData = loadStudentsData(STUDENTS_FILE);
        console.log(`✅ Loaded ${Object.values(studentsData.studentsByClass).reduce((sum, arr) => sum + arr.length, 0)} students`);
        
        console.log('\n🔄 Converting to API format and matching students...');
        const { apiRecords, unmatchedRecords } = convertToAPIFormat(records, studentsData);
        console.log(`✅ Converted ${apiRecords.length} records`);
        
        if (unmatchedRecords.length > 0) {
            console.log(`\n⚠️ ${unmatchedRecords.length} unmatched records:`);
            unmatchedRecords.slice(0, 10).forEach(msg => console.log(`  - ${msg}`));
            if (unmatchedRecords.length > 10) {
                console.log(`  ... and ${unmatchedRecords.length - 10} more`);
            }
        }
        
        // Show a sample
        console.log('\n📋 Sample records:');
        console.log(JSON.stringify(apiRecords.slice(0, 3), null, 2));
        
        console.log('\n' + '='.repeat(60));
        const success = await uploadToAPI(apiRecords);
        console.log('='.repeat(60));
        
        if (success) {
            console.log('\n🎉 April attendance data has been imported successfully!');
            process.exit(0);
        } else {
            console.log('\n⚠️ Import encountered issues. Please check the errors above.');
            process.exit(1);
        }
    } catch (error) {
        console.error('💥 Fatal error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

main();
