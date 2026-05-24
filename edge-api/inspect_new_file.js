const XLSX = require('xlsx');
const path = require('path');

const targetFile = process.argv[2] || 'DANH SÁCH TRẺ 2026 - T04.xlsx';
const filePath = path.resolve(targetFile);

console.log(`Checking file: ${filePath}`);
const workbook = XLSX.readFile(filePath);

workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    console.log(`--- Sheet: ${sheetName} ---`);
    console.log('Headers (Row 1-2):');
    console.log(data.slice(0, 3));
});
