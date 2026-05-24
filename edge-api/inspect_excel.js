const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '../ĐIỂM DANH THÁNG 03 - 13 LỚP.xlsx');
const workbook = XLSX.readFile(filePath);

console.log('Sheets:', workbook.SheetNames);

workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    console.log(`--- Sheet: ${sheetName} ---`);
    console.log('First 5 rows:', data.slice(0, 5));
});
