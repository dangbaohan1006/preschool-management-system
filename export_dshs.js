const fs = require('fs');
const { execSync } = require('child_process');

try {
    console.log('Đang trích xuất dữ liệu từ D1...');
    const command = 'npx wrangler d1 execute preschool-buffer --remote --command="SELECT s.name, s.birth_year, c.name as class_name FROM students s JOIN classes c ON s.class_id = c.id WHERE s.status != \'DROPOUT\' ORDER BY c.name, s.name;" --json';
    const output = execSync(command).toString();
    const json = JSON.parse(output);
    const data = json[0].results;

    const csvContent = '\ufeffHọ tên,Sinh năm,Lớp\n' + data.map(r => `"${r.name}",${r.birth_year || ''},"${r.class_name}"`).join('\n');
    fs.writeFileSync('DSHS.csv', csvContent, 'utf8');
    console.log(`Đã xuất ${data.length} học sinh ra file DSHS.csv thành công!`);
} catch (err) {
    console.error('Lỗi:', err.message);
    process.exit(1);
}
