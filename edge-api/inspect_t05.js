const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '..', 'DANH SÁCH TRẺ 2026 - T05.xls');
const workbook = XLSX.readFile(filePath);

console.log('Sheets:', workbook.SheetNames);

workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    console.log(`\nSheet: ${sheetName}`);
    console.log('Top 5 rows:');
    data.slice(0, 5).forEach((row, i) => {
        console.log(`Row ${i}:`, row);
    });
});
