# 📝 Thành Danh: Hệ thống Điểm danh Mầm non (Edge-to-Local)
Hệ thống quản lý chuyên cần và tài chính cho **Trường mầm non Thành Danh**, được thiết kế theo mô hình **Edge-to-Local Data Pipeline**. Dữ liệu được ghi nhận tức thì trên Đám mây (Cloudflare) và tự động đồng bộ về Google Sheets để báo cáo.

---

## 🚀 1. Hướng dẫn Setup từ A - Z (End-to-End)

### A. Hạ tầng Đám mây (Cloudflare)
Hệ thống sử dụng **Cloudflare Workers** (API) và **D1 Database** (Lưu trữ) để đảm bảo hoạt động 24/7.

1.  **Cài đặt:** Di chuyển vào `edge-api/` và chạy `npm install`.
2.  **Khởi tạo Database:** 
    *   `npx wrangler d1 create preschool-buffer`
    *   Tạo bảng: `npx wrangler d1 execute preschool-buffer --remote --file=./schema_admin.sql`
3.  **Deploy API:** `npm run deploy`.
    *   *Kết quả:* Bạn sẽ nhận được 1 URL (VD: `https://preschool-edge-api.xxxx.workers.dev`).

### B. Giao diện Người dùng (Cloudflare Pages)
Hệ thống có 2 giao diện: **Điểm danh (Giáo viên)** và **Quản trị (Ban quản lý)**.

1.  **Cấu hình:** Cập nhật `API_URL_BASE` trong `frontend-app/app.js` và `frontend-app/admin.html` trỏ về URL Worker ở Bước A.
2.  **Deploy Frontend:** 
    *   Chạy: `npx wrangler pages deploy ./frontend-app --project-name diemdanh-mamnon`
3.  **Truy cập:**
    *   **Giáo viên:** `https://diemdanh-mamnon.pages.dev`
    *   **Ban quản lý:** `https://diemdanh-mamnon.pages.dev/admin.html` (User: `admin`, Pass: `123456`).

### C. Đồng bộ Google Sheets (Google Cloud)
Để Python có thể ghi dữ liệu vào Google Sheets, cần cấu hình Service Account.

1.  Mở [Google Cloud Console](https://console.cloud.google.com/), bật **Google Sheets API** và **Google Drive API**.
2.  Tạo **Service Account**, lấy file **JSON key**, đổi tên thành `gcp_service_account.json` và bỏ vào `local-etl-engine/credentials/`.
3.  **Chia sẻ (Share)** file Google Sheets của bạn cho email của Service Account với quyền **Editor**.
4.  Copy **Sheet ID** từ trình duyệt và điền vào `local-etl-engine/main.py`.

---

## ⚙️ 2. Cách vận hành hàng ngày

### Đối với Giáo viên:
1. Mở link Pages trên điện thoại.
2. Nhập PIN, chọn lớp và thực hiện tích chọn Có/Vắng cho từng bé.
3. Nhấn **Xác nhận gửi**.

### Đối với Ban quản lý:
1. Truy cập trang `/admin.html` để thêm lớp mới hoặc cập nhật danh sách học sinh.
2. **Tại máy tính ở trường:** Nhấp đúp file `DongBoDiemDanh.bat` để dữ liệu từ Cloud tự động đổ về Google Sheets.
3. Xem báo cáo trực quan trên **Looker Studio** (kết nối với file Google Sheets).

---

## 🛡️ Bảo mật hệ thống
*   **Edge Data:** Dữ liệu trên Cloud chỉ là dữ liệu tạm (Buffer). Sau khi máy Local đồng bộ thành công, dữ liệu trên Cloud sẽ được xóa sạch để đảm bảo quyền riêng tư.
*   **Security Key:** Mọi giao tiếp giữa App và Server đều yêu cầu `x-api-key` nội bộ.
*   **PIN Code:** Chặn truy cập trái phép vào giao diện app trên điện thoại của giáo viên; yêu cầu đổi mật khẩu lần đầu để tăng tính bảo mật.

---

## 📚 Phụ lục: Hướng dẫn Google Cloud (Click-by-click)

Để máy tính local có quyền ghi vào Google Sheets, thực hiện chính xác các bước sau:

1.  **Tạo Project:** Truy cập [Google Cloud Console](https://console.cloud.google.com/) -> **New Project** -> Đặt tên `ThanhDanh-Sync` -> **Create**.
2.  **Bật API:** Tìm kiếm **"Google Sheets API"** và **"Google Drive API"** -> Nhấn **Enable** cho cả hai.
3.  **Tạo Service Account:** 
    *   Vào **IAM & Admin** -> **Service Accounts** -> **Create Service Account**.
    *   Đặt tên: `sync-bot` -> **Create and Continue**.
    *   Chọn Role: **Basic** -> **Editor** -> **Done**.
4.  **Lấy JSON Key:**
    *   Nhấn vào Email của Service Account vừa tạo -> Tab **Keys** -> **Add Key** -> **Create new key**.
    *   Chọn **JSON** -> **Create**.
    *   Đổi tên file tải về thành `gcp_service_account.json` và bỏ vào thư mục `local-etl-engine/credentials/`.
5.  **Ủy quyền trên Sheets:**
    *   Copy Email của Service Account (dạng `xxx@xxx.iam.gserviceaccount.com`).
    *   Mở file Google Sheets -> Nhấn **Share** -> Dán Email vào -> Chỉnh quyền **Editor** -> **Send**.
6.  **Khai báo Sheet ID:** Copy mã ID từ URL của Sheets (nằm giữa `/d/` và `/edit`) và dán vào biến `SHEET_ID` trong `local-etl-engine/main.py`.

deploy be: npx wrangler deploy (edge-api)
deploy fe: npx wrangler pages deploy frontend-app --project-name diemdanh-mamnon (root)
