const fs = require('fs');
const path = require('path');

// Configuration  
const STUDENTS_FILE = path.join(__dirname, './students_data.json');

function main() {
    console.log('📊 Validating data...\n');
    
    const students = JSON.parse(fs.readFileSync(STUDENTS_FILE, 'utf8'));
    
    // Group by class
    const byClass = {};
    students.forEach(s => {
        if (!byClass[s.class_id]) {
            byClass[s.class_id] = [];
        }
        byClass[s.class_id].push(s);
    });
    
    console.log('✅ Classes in system:');
    Object.keys(byClass).sort().forEach(classId => {
        console.log(`  - ${classId}: ${byClass[classId].length} students`);
    });
    
    console.log('\n🆔 Sample Student IDs:');
    students.slice(0, 10).forEach(s => {
        console.log(`  - ${s.id} (${s.name}) in ${s.class_id}`);
    });
    
    console.log('\n⚠️ Students with special IDs:');
    students.filter(s => s.id.includes('hanging') || s.id.includes('trial')).forEach(s => {
        console.log(`  - ${s.id} (${s.name}) in ${s.class_id}`);
    });
    
    // Check for any NULL or empty IDs
    const badIds = students.filter(s => !s.id || s.id.trim() === '');
    if (badIds.length > 0) {
        console.log(`\n❌ ${badIds.length} students with empty ID`);
    } else {
        console.log('\n✅ All students have valid IDs');
    }
    
    // Check for any NULL or empty class_ids
    const badClasses = students.filter(s => !s.class_id || s.class_id.trim() === '');
    if (badClasses.length > 0) {
        console.log(`❌ ${badClasses.length} students with empty class_id`);
    } else {
        console.log('✅ All students have valid class_ids');
    }
}

main();
