const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '..', 'DANH SÁCH TRẺ 2026 - T05.xls');
const workbook = XLSX.readFile(filePath);

workbook.SheetNames.forEach(sheetName => {
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    data.forEach((row, i) => {
        const rowStr = JSON.stringify(row);
        if (rowStr.includes('Linh Lan')) {
            console.log(`Found in ${sheetName} Row ${i}:`, row);
        }
    });
});
