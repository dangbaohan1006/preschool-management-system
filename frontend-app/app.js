// --- Configuration ---
const API_URL_BASE = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
    ? 'http://127.0.0.1:8787/api'
    : 'https://preschool-edge-api.diemdanh-tds.workers.dev/api';
const SECRET_KEY = "SECRET_INTERNAL_KEY_2026";
// --- State ---
let teacherInfo = null;
let students = []; // Sẽ lấy từ API
let historyData = []; // Dữ liệu lịch sử hiện tại
let originalHistory = []; // Bản sao để so sánh diff

// --- System UI Helpers ---
function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) return console.log("Toast:", message);
    
    const titles = { success: 'Thành công', error: 'Lỗi', warning: 'Cảnh báo' };
    const icons = { success: '✅', error: '❌', warning: '⚠️' };
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <div class="toast-icon">${icons[type]}</div>
        <div class="toast-content">
            <div class="toast-title">${titles[type]}</div>
            <div class="toast-message">${message}</div>
        </div>
    `;
    
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 100);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 500);
    }, 4000);
}

function logout() {
    localStorage.removeItem('teacher_session');
    location.reload();
}

async function isDateLocked(dateStr) {
    if (!dateStr) return false;
    // dateStr is DD/MM/YYYY
    const parts = dateStr.split('/');
    if (parts.length !== 3) return false;
    const isoDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
    try {
        const res = await fetch(`${API_URL_BASE}/admin/locks?start_date=${isoDate}&end_date=${isoDate}`, {
            headers: { 'x-api-key': SECRET_KEY }
        });
        const data = await res.json();
        return (data.results || []).length > 0;
    } catch (e) {
        console.error("Lỗi kiểm tra khóa sổ:", e);
        return false;
    }
}

// Override native alert
window.alert = (msg) => {
    const isError = msg.toLowerCase().includes('lỗi') || 
                    msg.toLowerCase().includes('không') || 
                    msg.toLowerCase().includes('sai') ||
                    msg.toLowerCase().includes('fail') ||
                    msg.toLowerCase().includes('unauthorized');
    showToast(msg, isError ? 'error' : 'success');
};

// System Confirm Modal Helper
function sysConfirm(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('sys-confirm-modal');
        const msgEl = document.getElementById('sys-confirm-message');
        const okBtn = document.getElementById('sys-confirm-ok');
        const cancelBtn = document.getElementById('sys-confirm-cancel');
        
        msgEl.innerText = message;
        modal.classList.remove('hidden');
        
        const cleanup = (val) => {
            modal.classList.add('hidden');
            okBtn.onclick = null;
            cancelBtn.onclick = null;
            resolve(val);
        };
        
        okBtn.onclick = () => cleanup(true);
        cancelBtn.onclick = () => cleanup(false);
    });
}

// --- initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    // Tải dữ liệu lớp học trước
    await fetchClasses();

    // --- PHỤC HỒI SESSION ---
    const savedSession = localStorage.getItem('teacher_session');
    if (savedSession) {
        try {
            const data = JSON.parse(savedSession);
            await loginTeacher(data, true);
        } catch (e) {
            localStorage.removeItem('teacher_session');
        }
    }

    // Gắn sự kiện click cho nút (Xử lý thay thẻ Form để tránh popup)
    const btnSubmit = document.getElementById('pin-submit');
    if (btnSubmit) btnSubmit.addEventListener('click', () => checkPin());

    // Gắn sự kiện Enter cho các ô input
    const handleEnter = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            checkPin();
        }
    };
    const inputX = document.getElementById('f-entry-x');
    const inputY = document.getElementById('f-entry-y');
    if (inputX) inputX.addEventListener('keydown', handleEnter);
    if (inputY) inputY.addEventListener('keydown', handleEnter);

    // --- DATE PICKERS (Flatpickr) ---
    const fpConfig = {
        locale: 'vn',
        dateFormat: 'd/m/Y',
        defaultDate: 'today',
        disableMobile: "true", // Force custom picker on mobile
        onChange: () => fetchStudents() // Reload students when date changes
    };
    
    const dateInput = flatpickr("#date-input", fpConfig);
    const historyDateInput = flatpickr("#history-date-input", fpConfig);

    const localDate = new Date();
    const YYYY = localDate.getFullYear();
    const MM = String(localDate.getMonth() + 1).padStart(2, '0');
    const DD = String(localDate.getDate()).padStart(2, '0');

    // Event listeners khác
    document.getElementById('submit-btn').addEventListener('click', handleSubmit);
    document.getElementById('close-modal').addEventListener('click', closeModal);

    // Logout button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    // --- THUẬT TOÁN CHUẨN HÓA ID REAL-TIME ---
    const forceEnglishRealtime = (e) => {
        const el = e.target;
        const cursorPosition = el.selectionStart;
        const oldVal = el.value;
        const newVal = oldVal.normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd').replace(/Đ/g, 'D')
            .replace(/[^a-zA-Z0-9_.-]/g, '');
        if (oldVal !== newVal) {
            el.value = newVal;
            el.setSelectionRange(cursorPosition, cursorPosition);
        }
    };

    if (inputX) inputX.addEventListener('input', forceEnglishRealtime);

    // Khi đổi lớp -> Tải lại học sinh
    document.getElementById('class-select').addEventListener('change', fetchStudents);

    // History button
    const historyBtn = document.getElementById('history-btn');
    if (historyBtn) historyBtn.addEventListener('click', openHistoryModal);

    // Set default history date
    // No manual value set needed for flatpickr inputs
    // document.getElementById('history-date-input').value = `${YYYY}-${MM}-${DD}`;

    // Set current date display
    document.getElementById('current-date').innerText = `${DD}/${MM}/${YYYY}`;
});

async function fetchClasses() {
    try {
        const res = await fetch(`${API_URL_BASE}/admin/classes`, { headers: { 'x-api-key': SECRET_KEY } });
        const data = await res.json();
        const select = document.getElementById('class-select');
        if (select) {
            select.innerHTML = data.results.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
            // Sau khi có lớp, tải học sinh của lớp đầu tiên mặC ĐỊNH nẾU chưa login
            if (data.results.length > 0 && !teacherInfo) await fetchStudents();
        }
    } catch (e) { console.error("Lỗi tải lớp:", e); }
}

async function fetchStudents() {
    const select = document.getElementById('class-select');
    if (!select) return;
    const classId = select.value;
    
    try {
        // Get current attendance date and convert to YYYY-MM-DD format
        const dateInput = document.getElementById('date-input');
        let dateVal = dateInput.value;
        
        // Nếu input trống, lấy ngày hiện tại (phòng trường hợp Flatpickr chưa init xong)
        if (!dateVal) {
            const now = new Date();
            dateVal = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
        }

        const [dd, mm, yyyy] = dateVal.split('/');
        asOfDate = `${yyyy}-${mm}-${dd}`;

        // Check if date is locked
        const isLocked = await isDateLocked(dateVal);
        window.currentDateLocked = isLocked;

        const submitBtn = document.getElementById('submit-btn');
        if (isLocked) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span>🔒 SỔ ĐÃ KHÓA - LIÊN HỆ ADMIN</span>';
            submitBtn.className = "pointer-events-auto w-full max-w-sm bg-slate-400 text-white font-black py-4 md:py-5 rounded-lg shadow-xl transition-all flex items-center justify-center gap-2 md:gap-4 text-xs md:text-sm uppercase tracking-widest cursor-not-allowed";
        } else {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span>Xác nhận thông tin</span><div class="w-6 h-6 rounded-md bg-white/20 flex items-center justify-center text-xs shrink-0">✓</div>';
            submitBtn.className = "pointer-events-auto w-full max-w-sm bg-[#FF8000] hover:bg-orange-600 text-white font-black py-4 md:py-5 rounded-lg shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2 md:gap-4 text-xs md:text-sm uppercase tracking-widest";
        }

        const url = new URL(`${API_URL_BASE}/admin/students`, 'http://localhost');
        url.searchParams.append('class_id', classId);
        if (asOfDate) url.searchParams.append('as_of_date', asOfDate);
        
        const res = await fetch(url.toString(), { headers: { 'x-api-key': SECRET_KEY } });
        const data = await res.json();
        students = data.results.filter(s => s.tag !== 'TEMPORARY_LEAVE').map(s => ({ 
            ...s, 
            status: s.tag === 'HANGING' ? 'ABSENT' : 'PRESENT',
            note: s.tag === 'HANGING' ? '[Tự động] Treo sĩ số' : ''
        }));
        renderStudents();
    } catch (e) { console.error("Lỗi tải học sinh:", e); }
}

// --- Security ---
async function checkPin(e) {
    if (e) e.preventDefault();
    const idInput = document.getElementById('f-entry-x');
    const pinInput = document.getElementById('f-entry-y');

    let teacherId = idInput.value.trim().toLowerCase();
    teacherId = teacherId.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');

    const pin = pinInput.value.trim();
    const btn = document.getElementById('pin-submit');

    if (!teacherId || !pin) return alert("Vui lòng nhập đầy đủ ID và PIN!");

    // --- GHOST SUBMIT: Bypass Browser Leak Detection ---
    pinInput.value = '';

    btn.disabled = true;
    btn.innerText = "ĐANG KIỂM TRA...";

    try {
        const res = await fetch(`${API_URL_BASE}/auth/teacher`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': SECRET_KEY },
            body: JSON.stringify({ pin, id: teacherId })
        });
        const data = await res.json();

        if (data.success) {
            await loginTeacher(data);
        } else {
            alert(data.error || "Tài khoản hoặc PIN giáo viên không đúng!");
            pinInput.value = pin; // Khôi phục mã PIN trên UI nếu sai
        }
    } catch (err) {
        alert("Lỗi kết nối máy chủ! Vui lòng thử lại sau.");
        pinInput.value = pin; // Khôi phục mã PIN nếu lỗi mạng
    } finally {
        btn.disabled = false;
        btn.innerText = "XÁC NHẬN VÀO LỚP";
    }
}

async function loginTeacher(data, isRestore = false) {
    teacherInfo = data;
    if (!isRestore) {
        localStorage.setItem('teacher_session', JSON.stringify(data));
    }

    document.getElementById('pin-screen').classList.add('hidden');
    document.getElementById('main-content').style.display = 'block';
    document.getElementById('submit-btn-container').style.display = 'flex';
    if (document.getElementById('history-btn')) document.getElementById('history-btn').classList.remove('hidden');
    
    // Show logout button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.classList.remove('hidden');

    // Tự động chọn lớp giáo viên này quản lý và khóa lại
    if (teacherInfo.class_id) {
        const select = document.getElementById('class-select');
        if (select) {
            select.value = teacherInfo.class_id;
            select.disabled = true; // Khóa lớp để tránh điểm danh nhầm
            await fetchStudents();
        }
    }

    // KIỂM TRA ĐỔI MẬT KHẨU LẦN ĐẦU
    if (teacherInfo.is_first_login) {
        document.getElementById('modal-change-pass').classList.remove('hidden');
    } else {
        renderStudents(); 
    }
}

// --- Renders ---
function renderStudents() {
    const tbody = document.getElementById('student-table-body');
    const countEl = document.getElementById('student-count');
    if (!tbody || !countEl) return;
    countEl.innerText = `${students.length}`;

    tbody.innerHTML = students.map((s, index) => {
        const isPresent = s.status === 'PRESENT';
        return `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="p-4 text-center font-bold text-[#D3C9BD] text-[10px] border-r border-slate-50">${index + 1}</td>
                <td class="p-4">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-md bg-slate-100 flex items-center justify-center text-sm shadow-sm ring-1 ring-slate-200">
                            👶
                        </div>
                        <div class="flex flex-col">
                            <div class="text-sm font-bold text-[#006C18] headline flex items-center gap-2">
                                <span class="truncate max-w-[160px]">${s.name}</span>
                                ${s.tag === 'TRIAL' ? '<span class="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[8px] rounded font-black ring-1 ring-amber-200">HỌC THỬ</span>' : ''}
                                ${s.tag === 'HANGING' ? '<span class="px-1.5 py-0.5 bg-rose-100 text-rose-700 text-[8px] rounded font-black ring-1 ring-rose-200">TREO SĨ SỐ</span>' : ''}
                            </div>
                            <div class="text-[9px] font-black text-[#D3C9BD] uppercase tracking-widest flex items-center gap-2">
                                <span>ID: ${s.id}</span>
                                <span class="md:hidden">• ${s.birth_year || '----'}</span>
                            </div>
                        </div>
                    </div>
                </td>
                <td class="p-4 text-center text-xs font-bold text-slate-500 hidden md:table-cell">${s.birth_year || '----'}</td>
                <td class="p-4 text-center">
                    <div class="inline-flex rounded-md border border-slate-200 overflow-hidden shadow-sm ${(s.tag === 'HANGING' || window.currentDateLocked) ? 'opacity-50 grayscale' : ''}">
                        <button onclick="${(s.tag === 'HANGING' || window.currentDateLocked) ? 'void(0)' : `updateStatus('${s.id}', 'ABSENT')`}" 
                                ${(s.tag === 'HANGING' || window.currentDateLocked) ? 'disabled' : ''}
                                class="px-5 py-1.5 text-[9px] font-black uppercase tracking-widest transition-all ${!isPresent ? 'bg-[#E2725B] text-white' : 'bg-white text-slate-400 hover:bg-slate-50'}">
                            VẮNG
                        </button>
                        <button onclick="${(s.tag === 'HANGING' || window.currentDateLocked) ? 'void(0)' : `updateStatus('${s.id}', 'PRESENT')`}" 
                                ${(s.tag === 'HANGING' || window.currentDateLocked) ? 'disabled' : ''}
                                class="px-5 py-1.5 text-[9px] font-black uppercase tracking-widest transition-all ${isPresent ? 'bg-[#006C18] text-white' : 'bg-white text-slate-400 hover:bg-slate-50'}">
                            CÓ MẶT
                        </button>
                    </div>
                </td>
                <td class="p-4">
                    <input type="text" 
                           id="note-${s.id}" 
                           placeholder="${window.currentDateLocked ? 'Không thể chỉnh sửa' : 'Lý do vắng / Ghi chú...'}" 
                           value="${s.note || ''}"
                           ${window.currentDateLocked ? 'disabled' : ''}
                           class="w-full border border-slate-200 rounded-md px-3 py-2 text-xs font-bold text-[#006C18] outline-none focus:border-[#006C18] placeholder:text-[#D3C9BD] ${window.currentDateLocked ? 'bg-slate-50 cursor-not-allowed' : ''}"
                           oninput="updateNote('${s.id}', this.value)">
                </td>
            </tr>
        `;
    }).join('');
}

function updateStatus(id, status) {
    const student = students.find(s => s.id === id);
    if (student) {
        student.status = status;
        renderStudents();
    }
}

function updateNote(id, note) {
    const student = students.find(s => s.id === id);
    if (student) {
        student.note = note;
    }
}

async function handleSubmit() {
    const date = document.getElementById('date-input').value;
    if (!teacherInfo) return alert("Vui lòng đăng nhập trước!");
    
    // Kiểm tra khóa sổ một lần nữa trước khi hiện modal
    if (await isDateLocked(date)) {
        return alert(`Sổ điểm danh ngày ${date} đã bị khóa. Vui lòng liên hệ Admin.`);
    }

    if (!await sysConfirm(`Xác nhận gửi điểm danh cho ${students.length} bé ngày ${date}?`)) return;

    const pinInput = document.getElementById('f-entry-y');
    if (pinInput) pinInput.value = '';

    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    btn.classList.add('opacity-50', 'scale-95');
    btn.innerText = "ĐANG GỬI...";

    try {
        const payload = students.map(s => ({
            student_id: s.id,
            student_name: s.name,
            class_id: teacherInfo.class_id,
            date: date,
            status: s.status,
            teacher_id: teacherInfo.id,
            teacher_name: teacherInfo.name,
            details: s.note || ''
        }));

        const res = await fetch(`${API_URL_BASE}/admin/attendance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': SECRET_KEY },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.success) {
            showModal();
        } else {
            alert('Lỗi: ' + (data.error || 'Không thể lưu dữ liệu.'));
        }
    } catch (err) {
        alert('Lỗi kết nối máy chủ khi gửi điểm danh!');
    } finally {
        btn.disabled = false;
        btn.innerText = "XÁC NHẬN GỬI ĐIỂM DANH";
    }
}

function showModal() {
    document.getElementById('success-modal').classList.remove('hidden');
    setTimeout(() => {
        const content = document.getElementById('modal-content');
        if (content) {
            content.classList.remove('scale-95', 'opacity-0');
            content.classList.add('scale-100', 'opacity-100');
        }
    }, 10);
}

function closeModal() {
    document.getElementById('success-modal').classList.add('hidden');
    students.forEach(s => {
        s.status = 'PRESENT';
        s.note = '';
    });
    renderStudents();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function submitNewPassword() {
    const passInput = document.getElementById('new-p-input');
    const pass = passInput ? passInput.value : '';
    if (pass.length < 4) return alert('Mật khẩu tối thiểu 4 ký tự');

    try {
        const res = await fetch(`${API_URL_BASE}/auth/teacher/password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': SECRET_KEY },
            body: JSON.stringify({ id: teacherInfo.id, new_password: pass })
        });
        const data = await res.json();
        if (data.success) {
            alert('Đổi mật khẩu thành công! Giờ bạn có thể bắt đầu điểm danh.');
            document.getElementById('modal-change-pass').classList.add('hidden');
            renderStudents();
        } else {
            alert('Có lỗi khi đổi mật khẩu.');
        }
    } catch (e) {
        alert('Lỗi kết nối khi đổi mật khẩu.');
    }
}

function skipChangePass() {
    const modal = document.getElementById('modal-change-pass');
    if (modal) modal.classList.add('hidden');
    renderStudents();
}

function openHistoryModal() {
    document.getElementById('history-modal').classList.remove('hidden');
}

function closeHistoryModal() {
    document.getElementById('history-modal').classList.add('hidden');
}

async function loadHistory() {
    const date = document.getElementById('history-date-input').value;
    const classId = teacherInfo?.class_id || document.getElementById('class-select').value;
    
    if (!date) return alert("Vui lòng chọn ngày!");

    const toISODate = (value) => {
        const parts = value.split('/');
        if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
        return value;
    };
    
    const tbody = document.getElementById('history-table-body');
    tbody.innerHTML = `<tr><td colspan="4" class="p-12 text-center text-slate-400 font-bold">ĐANG TẢI...</td></tr>`;

    try {
        const isLocked = await isDateLocked(date);
        window.historyDateLocked = isLocked;

        const studentsRes = await fetch(`${API_URL_BASE}/admin/students?class_id=${classId}&as_of_date=${toISODate(date)}`, { headers: { 'x-api-key': SECRET_KEY } });
        const studentsData = await studentsRes.json();
        const classStudents = studentsData.results;

        const res = await fetch(`${API_URL_BASE}/admin/report/class-grid?start_date=${date}&end_date=${date}&class_id=${classId}&t=${Date.now()}`, { 
            headers: { 'x-api-key': SECRET_KEY } 
        });
        const data = await res.json();
        
        historyData = classStudents.filter(s => s.tag !== 'TEMPORARY_LEAVE').map(s => {
            // Robust matching: trim and case-insensitive (just in case)
            const record = (data.results || []).find(r => 
                String(r.student_id).trim() === String(s.id).trim()
            );
            return {
                id: s.id,
                name: s.name,
                tag: s.tag, 
                status: record ? record.status : (s.tag === 'HANGING' ? 'ABSENT' : 'PRESENT'),
                note: record ? record.details || '' : (s.tag === 'HANGING' ? '[Tự động] Treo sĩ số' : ''),
                exists: !!record
            };
        });

        originalHistory = JSON.parse(JSON.stringify(historyData));
        renderHistory();
        
        const updateBtn = document.getElementById('history-update-btn');
        if (isLocked) {
            updateBtn.disabled = true;
            updateBtn.innerText = "SỔ ĐÃ KHÓA";
            updateBtn.className = "px-8 py-3 rounded-xl bg-slate-300 text-white font-black text-[10px] uppercase tracking-widest cursor-not-allowed";
        } else {
            updateBtn.disabled = true;
            updateBtn.innerText = "Cập nhật thay đổi";
            updateBtn.className = "px-8 py-3 rounded-xl bg-[#FF8000] text-white font-black text-[10px] uppercase tracking-widest shadow-xl shadow-orange-100 active:scale-95 transition-all opacity-50 cursor-not-allowed";
        }

    } catch (e) {
        console.error(e);
        alert("Lỗi tải lịch sử điểm danh!");
    }
}

function renderHistory() {
    const tbody = document.getElementById('history-table-body');
    if (historyData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-12 text-center text-slate-400 font-bold uppercase tracking-widest text-[10px]">Không tìm thấy dữ liệu học sinh</td></tr>`;
        return;
    }

    tbody.innerHTML = historyData.map((s, index) => {
        const isPresent = s.status === 'PRESENT';
        return `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="p-4 text-center font-bold text-[#D3C9BD] text-[10px]">${index + 1}</td>
                <td class="p-4">
                    <div class="text-sm font-bold text-[#006C18] headline flex items-center gap-2">
                        ${s.name}
                        ${s.tag === 'TRIAL' ? '<span class="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[7px] rounded font-black ring-1 ring-amber-200">HỌC THỬ</span>' : ''}
                        ${s.tag === 'HANGING' ? '<span class="px-1.5 py-0.5 bg-rose-100 text-rose-700 text-[7px] rounded font-black ring-1 ring-rose-200">TREO SĨ SỐ</span>' : ''}
                    </div>
                    <div class="text-[9px] font-black text-[#D3C9BD] uppercase tracking-widest">ID: ${s.id}</div>
                </td>
                <td class="p-4 text-center">
                    <div class="inline-flex rounded-md border border-slate-200 overflow-hidden shadow-sm ${(s.tag === 'HANGING' || window.historyDateLocked) ? 'opacity-50 grayscale' : ''}">
                        <button onclick="${(s.tag === 'HANGING' || window.historyDateLocked) ? 'void(0)' : `updateHistoryStatus('${s.id}', 'ABSENT')`}" 
                                ${(s.tag === 'HANGING' || window.historyDateLocked) ? 'disabled' : ''}
                                class="px-4 py-1.5 text-[8px] font-black uppercase tracking-widest transition-all ${!isPresent ? 'bg-[#E2725B] text-white' : 'bg-white text-slate-400 hover:bg-slate-50'}">
                            VẮNG
                        </button>
                        <button onclick="${(s.tag === 'HANGING' || window.historyDateLocked) ? 'void(0)' : `updateHistoryStatus('${s.id}', 'PRESENT')`}" 
                                ${(s.tag === 'HANGING' || window.historyDateLocked) ? 'disabled' : ''}
                                class="px-4 py-1.5 text-[8px] font-black uppercase tracking-widest transition-all ${isPresent ? 'bg-[#006C18] text-white' : 'bg-white text-slate-400 hover:bg-slate-50'}">
                            CÓ MẶT
                        </button>
                    </div>
                </td>
                <td class="p-4">
                    <input type="text" 
                           placeholder="${window.historyDateLocked ? 'Đã khóa' : 'Ghi chú...'}" 
                           value="${s.note || ''}"
                           ${window.historyDateLocked ? 'disabled' : ''}
                           class="w-full border border-slate-200 rounded-md px-3 py-2 text-xs font-bold text-[#006C18] outline-none focus:border-[#006C18] placeholder:text-[#D3C9BD] ${window.historyDateLocked ? 'bg-slate-50' : ''}"
                           oninput="updateHistoryNote('${s.id}', this.value)">
                </td>
            </tr>
        `;
    }).join('');
}

function updateHistoryStatus(id, status) {
    const student = historyData.find(s => s.id === id);
    if (student) {
        student.status = status;
        checkHistoryChanges();
        renderHistory();
    }
}

function updateHistoryNote(id, note) {
    const student = historyData.find(s => s.id === id);
    if (student) {
        student.note = note;
        checkHistoryChanges();
    }
}

function checkHistoryChanges() {
    const changed = historyData.some((s, i) => {
        const orig = originalHistory[i];
        return s.status !== orig.status || s.note !== orig.note;
    });

    const updateBtn = document.getElementById('history-update-btn');
    if (changed) {
        updateBtn.disabled = false;
        updateBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    } else {
        updateBtn.disabled = true;
        updateBtn.classList.add('opacity-50', 'cursor-not-allowed');
    }
}

async function updateHistory() {
    const date = document.getElementById('history-date-input').value;
    const changedRecords = historyData.filter((s, i) => {
        const orig = originalHistory[i];
        return s.status !== orig.status || s.note !== orig.note;
    });

    if (changedRecords.length === 0) return alert("Không có thay đổi nào để cập nhật!");
    if (!await sysConfirm(`Cập nhật thay đổi cho ${changedRecords.length} bé ngày ${date}?`)) return;

    const btn = document.getElementById('history-update-btn');
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "ĐANG CẬP NHẬT...";

    try {
        const payload = changedRecords.map(s => ({
            student_id: s.id,
            student_name: s.name,
            class_id: teacherInfo.class_id,
            date: date,
            status: s.status,
            teacher_id: teacherInfo.id,
            teacher_name: teacherInfo.name,
            details: s.note || ''
        }));

        const res = await fetch(`${API_URL_BASE}/admin/attendance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': SECRET_KEY },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.success) {
            alert(`Đã cập nhật thành công ${changedRecords.length} bản ghi!`);
            originalHistory = JSON.parse(JSON.stringify(historyData));
            checkHistoryChanges();
        } else {
            alert('Lỗi: ' + (data.error || 'Không thể lưu dữ liệu.'));
        }
    } catch (err) {
        alert('Lỗi kết nối máy chủ khi cập nhật lịch sử!');
    } finally {
        btn.disabled = false;
        btn.innerText = originalText;
    }
}
