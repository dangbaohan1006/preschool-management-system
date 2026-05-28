const fs = require('fs');
const path = require('path');

const API_BASE = 'https://preschool-edge-api.tn-sys.workers.dev/api';
const API_KEY = 'SECRET_INTERNAL_KEY_2026';

async function fetchAllStudents() {
    try {
        console.log('📥 Fetching all students from API...');
        const response = await fetch(`${API_BASE}/admin/students`, {
            method: 'GET',
            headers: {
                'x-api-key': API_KEY
            }
        });
        
        if (!response.ok) {
            console.error(`❌ Failed to fetch students: ${response.status} ${response.statusText}`);
            return null;
        }
        
        const data = await response.json();
        console.log(`✅ Fetched ${data.results.length} students`);
        
        // Save to file
        const outputPath = path.join(__dirname, 'students_data.json');
        fs.writeFileSync(outputPath, JSON.stringify(data.results, null, 2));
        console.log(`💾 Saved to ${outputPath}`);
        
        // Group by class and print first 3 students of each class
        const byClass = {};
        data.results.forEach(student => {
            if (!byClass[student.class_id]) {
                byClass[student.class_id] = [];
            }
            byClass[student.class_id].push(student);
        });
        
        // Print summary with samples
        Object.entries(byClass).forEach(([className, students]) => {
            console.log(`\n📚 ${className}: ${students.length} students`);
            students.slice(0, 3).forEach(s => {
                console.log(`  - ID: ${s.id}, Name: ${s.name}`);
            });
            if (students.length > 3) {
                console.log(`  ... and ${students.length - 3} more`);
            }
        });
        
        return data.results;
    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        return null;
    }
}

fetchAllStudents();
