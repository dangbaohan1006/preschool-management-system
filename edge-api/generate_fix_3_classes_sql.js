const fs = require('fs');
const path = require('path');

const CSV_FILE = path.join(__dirname, '../ĐIỂM DANH THÁNG 04.csv');
const STUDENTS_FILE = path.join(__dirname, './students_data.json');
const SQL_OUTPUT_FILE = path.join(__dirname, './fix_3_classes_april.sql');
const MONTH = '2026-04';

const TARGET_CLASSES = new Set(['Dolphin 2A', 'Dolphin 3', 'Dolphin 4B']);
const CLASS_MAP = {
  'Dolphin 2A': 'DOLPHIN_2A',
  'Dolphin 3': 'DOLPHIN_3',
  'Dolphin 4B': 'DOLPHIN_4B'
};

// Business mapping per user confirmation
const STATUS_MAP = {
  'x': 'PRESENT',
  'X': 'PRESENT',
  'p': 'ABSENT',
  'P': 'ABSENT',
  'cl': 'TRANSFER',
  'CL': 'TRANSFER',
  'nl': 'ABSENT',
  'NL': 'ABSENT',
  '': null
};

function normalize(str) {
  if (!str) return '';
  return str
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
}

function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter(Boolean);
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const className = values[0];
    const studentName = values[2];

    if (!TARGET_CLASSES.has(className) || !studentName) continue;

    for (let dayIndex = 5; dayIndex < values.length && dayIndex - 5 <= 30; dayIndex++) {
      const day = dayIndex - 4;
      const rawStatus = values[dayIndex] || '';
      const mapped = STATUS_MAP[rawStatus] ?? null;
      if (!mapped) continue; // blank = no data

      records.push({
        className,
        classId: CLASS_MAP[className],
        studentName,
        day,
        status: mapped
      });
    }
  }

  return records;
}

function loadStudents(filePath) {
  const students = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const byClassAndName = new Map();

  for (const s of students) {
    byClassAndName.set(`${s.class_id}|${normalize(s.name)}`, s);
  }

  return { students, byClassAndName };
}

function distance(a, b) {
  const dp = [];
  for (let i = 0; i <= a.length; i++) dp[i] = [i];
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

function bestMatch(students, classId, name) {
  const n = normalize(name);
  const pool = students.filter(s => s.class_id === classId);
  let best = null;
  let bestD = Infinity;

  for (const s of pool) {
    const d = distance(n, normalize(s.name));
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }

  if (!best) return null;
  const threshold = Math.max(2, Math.floor(Math.max(n.length, normalize(best.name).length) * 0.25));
  return bestD <= threshold ? best : null;
}

function sqlStr(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}

function main() {
  const records = parseCSV(CSV_FILE);
  const { students, byClassAndName } = loadStudents(STUDENTS_FILE);

  // Explicit fixes requested by user
  const MANUAL_ID_MAP = new Map([
    ['DOLPHIN_3|ly tinh trach', { id: '72710305243', name: 'LI XINGZE (Lý Tinh Trạch)' }],
    ['DOLPHIN_3|le thanh tuyet', { id: '72710305246', name: 'Lê Thanh Thiên Tuyết' }],
    ['DOLPHIN_4B|lin min hy', { id: 'hanging_02', name: 'Lin Min Hy' }],
    ['DOLPHIN_2A|le gia khanh', { id: '72710305231', name: 'Lê Gia Khánh' }],
    ['DOLPHIN_2A|mai thy', { id: 'D2A_MAI_THY_01', name: 'Mai Thy' }],
    ['DOLPHIN_2A|my lan', { id: '72710305208', name: 'Phạm Mỹ Lan' }]
  ]);

  const neededStudents = [
    "INSERT OR IGNORE INTO students (id, name, class_id, status) VALUES ('D2A_MAI_THY_01', 'Mai Thy', 'DOLPHIN_2A', 'ACTIVE');"
  ];

  const inserts = [];
  const unresolved = new Map();
  const classCounters = { DOLPHIN_2A: 0, DOLPHIN_3: 0, DOLPHIN_4B: 0 };

  for (const r of records) {
    const key = `${r.classId}|${normalize(r.studentName)}`;

    let student = MANUAL_ID_MAP.get(key) || byClassAndName.get(key);

    if (!student) {
      student = bestMatch(students, r.classId, r.studentName);
    }

    if (!student) {
      unresolved.set(`${r.classId}|${r.studentName}`, true);
      continue;
    }

    const date = `${MONTH}-${String(r.day).padStart(2, '0')}`;
    inserts.push(
      `INSERT INTO Raw_Attendance (student_id, student_name, class_id, date, status, details, edge_sync_status, created_by_teacher_id) VALUES (${sqlStr(student.id)}, ${sqlStr(student.name)}, ${sqlStr(r.classId)}, ${sqlStr(date)}, ${sqlStr(r.status)}, '', 0, 'IMPORT_APRIL_2026_FIX3');`
    );
    classCounters[r.classId] += 1;
  }

  const sql = [
    '-- Fix for 3 classes: DOLPHIN_2A, DOLPHIN_3, DOLPHIN_4B',
    `-- Generated at ${new Date().toISOString()}`,
    "DELETE FROM Raw_Attendance WHERE date >= '2026-04-01' AND date <= '2026-04-30' AND class_id IN ('DOLPHIN_2A','DOLPHIN_3','DOLPHIN_4B');",
    ...neededStudents,
    ...inserts
  ].join('\n');

  fs.writeFileSync(SQL_OUTPUT_FILE, sql, 'utf8');

  console.log('Generated:', SQL_OUTPUT_FILE);
  console.log('Insert rows:', inserts.length);
  console.log('By class:', classCounters);
  console.log('Unresolved students:', unresolved.size);
  if (unresolved.size > 0) {
    for (const key of unresolved.keys()) {
      console.log('  -', key);
    }
  }
}

main();
