const fs = require('fs');
const path = require('path');

// Configuration
const API_URL = 'https://preschool-edge-api.diemdanh-tds.workers.dev/api/admin/attendance';
const API_KEY = 'SECRET_INTERNAL_KEY_2026';
const CSV_FILE = path.join(__dirname, '../ĐIỂM DANH THÁNG 04.csv');
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
    'x': 'PRESENT',
    'X': 'PRESENT',
    'p': 'PRESENT',
    'P': 'PRESENT',
    'c': 'PRESENT',
    'C': 'PRESENT',
    'v': 'ABSENT',
    'V': 'ABSENT',
    'l': 'ABSENT',
    'L': 'ABSENT',
    'cl': 'TRANSFER',
    'CL': 'TRANSFER',
    'ntt': 'ABSENT',
    'NTT': 'ABSENT',
    '': 'ABSENT'
};

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

function generateStudentId(className, stt) {
    // Generate a consistent student ID based on class and order
    const classCode = CLASS_MAP[className] || className.replace(/\s+/g, '_').toUpperCase();
    return `${classCode}_${stt}`;
}

function convertToAPIFormat(records) {
    const apiRecords = [];
    
    for (const record of records) {
        const { className, stt, studentName, gender, birthYear, day, status } = record;
        
        if (!studentName) continue;
        
        const classId = CLASS_MAP[className];
        if (!classId) {
            console.warn(`⚠️ Unknown class: ${className}`);
            continue;
        }
        
        const attendanceStatus = STATUS_MAP[status] || 'ABSENT';
        const date = `${MONTH}-${String(day).padStart(2, '0')}`;
        const studentId = generateStudentId(className, stt);
        
        apiRecords.push({
            student_id: studentId,
            student_name: studentName,
            class_id: classId,
            date: date,
            status: attendanceStatus,
            teacher_id: 'IMPORT_APRIL_2026',
            teacher_name: 'Import Script - April 2026',
            details: gender || ''
        });
    }
    
    return apiRecords;
}

async function uploadToAPI(records) {
    console.log(`📤 Uploading ${records.length} attendance records to API in batches...`);
    
    // Batch size: 300 records at a time (to avoid Cloudflare limits)
    const BATCH_SIZE = 300;
    let uploadedCount = 0;
    let failedCount = 0;
    
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
            
            const result = await response.json();
            
            if (response.ok) {
                console.log(`  ✅ Batch ${batchNum} uploaded successfully`);
                uploadedCount += batch.length;
            } else {
                console.error(`  ❌ Batch ${batchNum} failed: ${result.error || response.statusText}`);
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
    console.log(`  ✅ Uploaded: ${uploadedCount} records`);
    console.log(`  ❌ Failed: ${failedCount} records`);
    
    return failedCount === 0;
}

async function main() {
    try {
        console.log('🔍 Parsing CSV file...');
        const records = parseCSV(CSV_FILE);
        console.log(`✅ Parsed ${records.length} attendance records from CSV`);
        
        console.log('\n🔄 Converting to API format...');
        const apiRecords = convertToAPIFormat(records);
        console.log(`✅ Converted ${apiRecords.length} records`);
        
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
        process.exit(1);
    }
}

main();
