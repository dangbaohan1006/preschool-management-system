const XLSX = require('xlsx');
const path = require('path');

const MASTER_FILE = path.join(__dirname, '../DANH SÁCH TRẺ 2026 - T04.xlsx');
const SEARCH_NAMES = ["phùng hoàng thiên hy", "li xingze", "lê thanh thiên tuyết", "lê hoàng nhã thy", "nguyễn lý gia hân", "phạm nguyễn thiên thanh", "phạm mỹ lan", "gia khánh", "huỳnh lê tiểu vy", "bùi trần tuệ an"];

const wb = XLSX.readFile(MASTER_FILE);
wb.SheetNames.forEach(sheetName => {
    const sheet = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet);
    console.log(`Sheet: ${sheetName}, Rows: ${data.length}`);
    
    SEARCH_NAMES.forEach(namePart => {
        const found = data.filter(row => {
            const rowName = (row['Họ và tên học sinh'] || '').toString().toLowerCase();
            return rowName.includes(namePart);
        });
        if (found.length > 0) {
            found.forEach(f => {
                console.log(`FOUND "${namePart}" in Sheet ${sheetName}: Name="${f['Họ và tên học sinh']}", ID="${f['ID']}"`);
            });
        }
    });
});
