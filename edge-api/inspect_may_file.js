const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '..', 'DANH SÁCH TRẺ 2026 - T05.xls');
const workbook = XLSX.readFile(filePath);

console.log('Sheet names:', workbook.SheetNames);

workbook.SheetNames.forEach(sheetName => {
    console.log(`\n--- Sheet: ${sheetName} ---`);
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    // Print first 5 rows to see structure
    data.slice(0, 10).forEach((row, i) => {
        console.log(`Row ${i}:`, row);
    });
});
