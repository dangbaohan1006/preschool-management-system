const XLSX = require('xlsx');
const path = require('path');
const MASTER_FILE = path.resolve('..', 'DANH SÁCH TRẺ 2026 - T04.csv');
const workbook = XLSX.readFile(MASTER_FILE);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(sheet);
console.log('Columns:', Object.keys(data[0]));
console.log('First row:', data[0]);
