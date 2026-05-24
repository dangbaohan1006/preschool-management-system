const fs = require('fs');

function parseCSV(content, nameCol, classCol, birthCol) {
    const lines = content.trim().split('\n');
    const header = lines[0].split(',');
    const results = [];
    
    for (let i = 1; i < lines.length; i++) {
        // Simple CSV parser (doesn't handle commas in quotes perfectly but good enough for this file structure)
        const row = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
        if (row.length < 3) continue;
        
        // Find indices
        const nameIdx = header.findIndex(h => h.includes(nameCol));
        const classIdx = header.findIndex(h => h.includes(classCol));
        
        let name = row[nameIdx]?.replace(/"/g, '').trim();
        let className = row[classIdx]?.replace(/"/g, '').trim();
        
        if (name && className) {
            results.push({ name, className, original: lines[i] });
        }
    }
    return results;
}

const dbData = parseCSV(fs.readFileSync('DSHS.csv', 'utf8').replace(/^\ufeff/, ''), 'Họ tên', 'Lớp');
const attendanceData = parseCSV(fs.readFileSync('ĐIỂM DANH THÁNG - 13 LỚP - Tháng 4.csv', 'utf8').replace(/^\ufeff/, ''), 'Họ và tên', 'Lớp');

const normalize = (s) => s.toLowerCase().normalize("NFC").replace(/\s+/g, ' ').trim();

const inDBNotAttend = dbData.filter(d => !attendanceData.find(a => normalize(a.name) === normalize(d.name)));
const inAttendNotDB = attendanceData.filter(a => !dbData.find(d => normalize(d.name) === normalize(a.name)));
const mismatchedClass = dbData.filter(d => {
    const match = attendanceData.find(a => normalize(a.name) === normalize(d.name));
    return match && normalize(match.className) !== normalize(d.className);
}).map(d => {
    const match = attendanceData.find(a => normalize(a.name) === normalize(d.name));
    return { name: d.name, dbClass: d.className, attendClass: match.className };
});

let report = '# So sánh danh sách học sinh (DB vs File điểm danh)\n\n';

report += '## 1. Học sinh có trong Database nhưng KHÔNG có trong file Điểm danh (' + inDBNotAttend.length + ')\n';
inDBNotAttend.forEach(x => report += `- ${x.name} (${x.className})\n`);

report += '\n## 2. Học sinh có trong file Điểm danh nhưng KHÔNG có trong Database (' + inAttendNotDB.length + ')\n';
inAttendNotDB.forEach(x => report += `- ${x.name} (${x.className})\n`);

report += '\n## 3. Học sinh có mặt cả hai nhưng sai lệch Lớp (' + mismatchedClass.length + ')\n';
mismatchedClass.forEach(x => report += `- ${x.name}: DB [${x.dbClass}] vs Điểm danh [${x.attendClass}]\n`);

fs.writeFileSync('so_sanh.md', report, 'utf8');
console.log('Đã tạo file so_sanh.md');
