const XLSX = require('xlsx');
const path = require('path');
const FILE = path.resolve('..', 'ĐIỂM DANH THÁNG 04.xlsx');
const workbook = XLSX.readFile(FILE);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(sheet);
console.log('Columns:', Object.keys(data[0]));
console.log('First row:', data[0]);
