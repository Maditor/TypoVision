# TẢI TRONG PHẦN RELEASE DO NHIỀU FILE QUÁ KHÔNG ĐĂNG LÊN SOURCE ĐƯỢC


# TypoVision

Extension CEP cho Adobe Photoshop giúp **chụp vùng chọn (selection) → OCR → dịch** ngay trong panel, sử dụng Google Gemini API.

---

## 1. Tính năng

- Chụp ảnh trực tiếp từ vùng chọn hiện tại trong Photoshop.
- Nhận diện văn bản (OCR) trong ảnh bằng Gemini.
- Dịch văn bản sang ngôn ngữ mong muốn, giọng văn tự nhiên.
- Cho phép sửa lại văn bản OCR và tự động dịch lại.
- Copy nhanh kết quả OCR / bản dịch vào clipboard.
- Bật/tắt server nền (Node.js) ngay trong panel.

---

## 2. Yêu cầu hệ thống

| Thành phần | Yêu cầu |
|---|---|
| Adobe Photoshop | Bản có hỗ trợ CEP (khuyến nghị CC 2020 trở lên) |
| Node.js | Bắt buộc cài để chạy Server |
| Gemini API Key | Lấy miễn phí tại [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| Hệ điều hành | Windows |

---

## 3. Cài đặt

1. Cài **Node.js** nếu máy chưa có (đây là thứ duy nhất cần cài thêm ngoài Photoshop).
2. Giải nén / clone toàn bộ project (thư mục gốc chứa `client`, `CSXS`, `host`, `icons`, `server`).
3. Chạy file **`install-win.bat`** (đặt cùng cấp thư mục gốc) để:
   - Copy extension vào `%APPDATA%\Adobe\CEP\extensions\TypoVision`
   - Bật `PlayerDebugMode` trong Registry (cho phép Photoshop load extension chưa ký số)
4. Khởi động lại Photoshop.
5. Mở panel qua menu **Window > Extensions > TypoVision**.

> Thư mục `server/node_modules` đã có sẵn trong project, **không cần chạy `npm install`**.

---

## 4. Cấu hình lần đầu

1. Trong panel, bấm biểu tượng **⚙ Settings**.
2. Nhập:
   - **API Key**: Gemini API key của bạn.
   - **Model**: mặc định `gemini-2.0-flash-lite` (có thể đổi sang model Gemini khác nếu muốn).
   - **Server URL**: mặc định `http://localhost:3000`, chỉ đổi nếu bạn chạy server ở cổng/địa chỉ khác.
3. Bấm **Save**.

> Cấu hình được lưu trong `localStorage` của panel, không cần nhập lại mỗi lần mở.

---

## 5. Khởi động Server

Panel gọi API qua server Node chạy nền (`server/server.js`). Có 2 cách chạy:

**Cách 1 – Trong panel:**
Bấm nút **Start** trong khung Settings để khởi động server, **Stop** để tắt.

**Cách 2 – Thủ công:**
```bash
cd server
node server.js
```
hoặc chạy `start_server.bat` / `stop_server.bat` có sẵn trong thư mục `server`.

Khi server chạy thành công, chấm trạng thái ở góc trên panel sẽ chuyển sang **xanh (Server online)**.

---

## 6. Cách sử dụng

1. Trong Photoshop, dùng công cụ chọn vùng (Marquee, Lasso...) để khoanh vùng chứa chữ cần dịch.
2. Trong panel, chọn:
   - **OCR**: ngôn ngữ gốc của chữ trong ảnh (hoặc để `Auto`).
   - **Translate**: ngôn ngữ muốn dịch sang.
3. Bấm **Capture Selection** → ảnh xem trước sẽ hiện ra.
4. Bấm **Run** → panel sẽ:
   - Hiển thị văn bản OCR được.
   - Hiển thị bản dịch tương ứng.
5. Có thể sửa trực tiếp ô **OCR** — panel sẽ tự động dịch lại sau ~1.2 giây.
6. Dùng nút **Copy** ở mỗi ô để sao chép kết quả.
7. Bấm **✕** trên ảnh xem trước để xoá và chụp lại vùng khác.

---

## 7. Xử lý sự cố

| Vấn đề | Nguyên nhân / cách khắc phục |
|---|---|
| Panel không mở được / không thấy trong menu Extensions | Kiểm tra đã chạy `install-win.bat` và khởi động lại Photoshop chưa. Kiểm tra registry `PlayerDebugMode` đã bật. |
| "Server offline" | Server Node chưa chạy — bấm **Start** trong Settings, hoặc chạy `node server.js` thủ công. |
| "CSInterface not available" | Đang mở panel ngoài môi trường Photoshop (ví dụ mở trực tiếp `index.html` bằng trình duyệt) — cần chạy trong Photoshop. |
| "API key not set" | Chưa nhập Gemini API Key trong phần Settings. |
| "Gemini did not return valid JSON" | Model trả kết quả không đúng định dạng — thử đổi model hoặc chụp lại vùng ảnh rõ hơn. |
| Lỗi khi export ảnh selection | Đảm bảo đã tạo vùng chọn (selection) hợp lệ trong Photoshop trước khi bấm Capture. |

---

## 8. Cấu trúc thư mục chính

```
├── client/          Giao diện panel (HTML/CSS/JS chạy trong CEP)
├── CSXS/manifest.xml Khai báo extension cho Adobe
├── host/index.jsx    ExtendScript: xuất ảnh selection, start/stop server
├── icons/             Icon extension
└── server/            Server Node.js (Express) gọi Gemini API
```

---

## 9. Bảo mật

- API Key được lưu cục bộ trên máy bạn (localStorage của panel / `config.json` của server), **không được gửi đi đâu khác** ngoài request gọi trực tiếp tới Gemini API của Google.
- Không chia sẻ file `config.json` hoặc API Key của bạn cho người khác.
