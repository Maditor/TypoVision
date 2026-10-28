# PS OCR Translate — CEP Extension cho Photoshop (CC2018 → mới nhất)

Bộ gồm 2 phần:

1. **`extension/`** — CEP panel chạy trong Photoshop. Cho phép chọn 1 vùng trên ảnh,
   xuất thành PNG tạm, gửi OCR, rồi dịch.
2. **`server/`** — Node.js server đứng giữa, gọi:
   - **OCR.space** để lấy chữ từ ảnh (bạn chọn ngôn ngữ OCR).
   - **Gemini API** để dịch (Gemini tự nhận diện ngôn ngữ nguồn, bạn chỉ chọn ngôn ngữ đích).

Panel **không** gọi trực tiếp OCR.space/Gemini (tránh lộ API key trong code phía client),
mà gọi qua `server.js` chạy local.

---

## 1. Cài server.js

```bash
cd server
npm install
cp .env.example .env
```

Mở `.env`, điền:
- `OCR_SPACE_API_KEY` — lấy free tại https://ocr.space/ocrapi
- `GEMINI_API_KEY` — lấy tại https://aistudio.google.com/apikey
- `GEMINI_MODEL` — để mặc định `gemini-flash-latest`, hoặc đổi sang model cụ thể (ví dụ `gemini-2.5-flash`) nếu muốn cố định version.

Chạy server:

```bash
npm start
```

Server chạy ở `http://localhost:3000`. Giữ cửa sổ terminal này mở khi dùng Photoshop.

> Có thể test nhanh server bằng `curl http://localhost:3000/api/health`.

---

## 2. Cài extension vào Photoshop

### a. Tải `CSInterface.js`

File này do Adobe phát hành/maintain (không kèm sẵn ở đây). Lấy bản mới nhất tại repo chính thức:

`https://github.com/Adobe-CEP/CEP-Resources` → vào thư mục `CEP_<version>/` → copy `CSInterface.js`

Đặt vào: `extension/client/libs/CSInterface.js`

### b. Bật chế độ debug cho CEP (để load extension chưa ký)

- **Windows**: mở Registry Editor, tại `HKEY_CURRENT_USER\Software\Adobe\CSXS.<version>`
  (ví dụ `CSXS.9`, `CSXS.11`...) tạo string value `PlayerDebugMode` = `1`.
- **macOS**: chạy trong Terminal:
  ```bash
  defaults write com.adobe.CSXS.<version> PlayerDebugMode 1
  ```
Cần làm cho **tất cả version CSXS** mà Photoshop bạn dùng hỗ trợ (mỗi bản Photoshop có thể map tới CSXS version khác nhau — không chắc thì set cho vài version liền kề: 9, 10, 11...).

### c. Copy thư mục extension vào đúng vị trí

- **Windows**: `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\`
  (hoặc `%APPDATA%\Adobe\CEP\extensions\` cho user-level)
- **macOS**: `/Library/Application Support/Adobe/CEP/extensions/`
  (hoặc `~/Library/Application Support/Adobe/CEP/extensions/`)

Copy cả thư mục `extension/` vào đó, đổi tên thành ví dụ `PSOcrTranslate` (thư mục này phải chứa trực tiếp `CSXS/`, `client/`, `host/`).

### d. Mở Photoshop

Vào menu **Window → Extensions (hoặc Plugins) → OCR Translate**.

---

## 3. Cách dùng

1. Mở `server.js` (terminal: `npm start` trong thư mục `server/`).
2. Trong Photoshop, dùng công cụ chọn vùng (Marquee, Lasso...) khoanh vùng chữ cần dịch.
   Nếu không chọn gì, extension sẽ xuất toàn bộ canvas.
3. Trong panel:
   - Chọn **Ngôn ngữ OCR** (ngôn ngữ chữ trong ảnh) — hoặc để **"Tự nhận diện"**.
   - Chọn **Dịch sang** (ngôn ngữ đích) — Gemini sẽ tự nhận diện ngôn ngữ nguồn.
   - Bấm **📷 Chụp vùng chọn & Dịch**.
4. Văn bản OCR và bản dịch hiện ra trong 2 ô textarea, có thể copy ra dùng.

---

## Cấu trúc project

```
extension/
  CSXS/manifest.xml      <- khai báo extension, hỗ trợ Photoshop 19.0 (2018) đến mới nhất
  client/
    index.html           <- UI panel
    style.css
    main.js               <- logic: gọi ExtendScript, gọi server OCR + dịch
    libs/CSInterface.js   <- (bạn tự thêm, xem mục 2a)
  host/
    index.jsx             <- ExtendScript: xuất vùng chọn ra PNG tạm
server/
  server.js               <- Express server: /api/ocr, /api/translate
  package.json
  .env.example
```

## Ghi chú / mở rộng thêm

- **Bảo mật**: hiện server cho `cors origin: "*"` để panel CEP (chạy từ `file://`) gọi được.
  Nếu deploy server ra ngoài máy local, nên giới hạn lại và thêm xác thực (API key riêng giữa
  panel ↔ server).
- **OCR Engine**: server tự chọn Engine 1 cho tiếng Trung/Nhật/Hàn, Engine 2 cho còn lại/auto.
  Có thể chỉnh logic này trong `server.js` nếu kết quả OCR không tốt.
- **CEP vs UXP**: Adobe đang dần chuyển các app sang UXP. CEP vẫn chạy được trên Photoshop hiện tại,
  nhưng nếu sau này Adobe ngừng hỗ trợ CEP cho Photoshop, sẽ cần viết lại phần `extension/` sang UXP
  (phần `server/` giữ nguyên không đổi).
- **Giới hạn ảnh**: OCR.space free tier giới hạn kích thước file & số request/phút — nếu vùng chọn
  quá lớn hoặc dùng nhiều, có thể cần nâng cấp gói hoặc giảm kích thước ảnh trước khi gửi.
