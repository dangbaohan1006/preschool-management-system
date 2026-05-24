const XLSX = require('xlsx');
const path = require('path');
const FILE = path.resolve('..', 'ĐIỂM DANH THÁNG 04.xlsx');
const workbook = XLSX.readFile(FILE);
workbook.SheetNames.forEach(name => {
    console.log('Sheet:', name);
    const sheet = workbook.Sheets[name];
    const data = XLSX.utils.sheet_to_json(sheet);
    if (data.length > 0) {
        console.log('  Columns:', Object.keys(data[0]));
        console.log('  First row:', data[0]);
    }
});
