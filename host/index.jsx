// host/index.jsx
// Chạy bên trong Photoshop (ExtendScript). Được gọi từ panel qua csInterface.evalScript().

/**
 * Xuất vùng chọn (selection) hiện tại của document đang active ra 1 file PNG tạm.
 * Nếu không có selection nào, sẽ xuất toàn bộ canvas (đã flatten).
 * @param {string} targetPath - đường dẫn file PNG muốn lưu (do panel JS sinh ra)
 * @returns {string} "OK:<path>" nếu thành công, "ERROR:<message>" nếu lỗi
 */
function exportSelectionAsImage(targetPath) {
    var tempDoc = null;
    var originalDoc = null;
    try {
        if (app.documents.length === 0) {
            return "ERROR:Khong co document nao dang mo trong Photoshop.";
        }
        originalDoc = app.activeDocument;

        var hasSelection = false;
        var bounds = null;
        try {
            bounds = originalDoc.selection.bounds; // [left, top, right, bottom]
            hasSelection = true;
        } catch (e) {
            hasSelection = false;
        }

        if (hasSelection) {
            // Copy merged (gộp tất cả layer trong vùng chọn) rồi dán vào doc mới
            originalDoc.selection.copy(true);

            var w = bounds[2].as("px") - bounds[0].as("px");
            var h = bounds[3].as("px") - bounds[1].as("px");

            tempDoc = app.documents.add(
                w, h, originalDoc.resolution, "ocr_temp_export",
                NewDocumentMode.RGB, DocumentFill.TRANSPARENT
            );
            tempDoc.paste();
            tempDoc.flatten();
        } else {
            // Không có vùng chọn -> xuất toàn bộ canvas
            tempDoc = originalDoc.duplicate("ocr_temp_export", true);
            app.activeDocument = tempDoc;
            tempDoc.flatten();
        }

        var file = new File(targetPath);
        var pngOpts = new PNGSaveOptions();
        pngOpts.compression = 0;
        pngOpts.interlaced = false;

        tempDoc.saveAs(file, pngOpts, true, Extension.LOWERCASE);
        tempDoc.close(SaveOptions.DONOTSAVECHANGES);

        // Trả lại document gốc làm document active
        app.activeDocument = originalDoc;

        return "OK:" + targetPath;
    } catch (err) {
        try {
            if (tempDoc !== null) {
                tempDoc.close(SaveOptions.DONOTSAVECHANGES);
            }
            if (originalDoc !== null) {
                app.activeDocument = originalDoc;
            }
        } catch (e2) {}
        return "ERROR:" + err.toString();
    }
}

/**
 * Tạo 1 layer chữ kiểu Paragraph (area text) trong document đang active, chứa nội dung
 * được truyền vào, với kích thước chữ chỉ định (đơn vị: point).
 * @param {string} text - nội dung chữ muốn đưa vào layer
 * @param {number} fontSize - kích thước chữ (point), ví dụ 35
 * @returns {string} "OK:<tên layer>" nếu thành công, "ERROR:<message>" nếu lỗi
 */
function createTextLayer(text, fontSize) {
    var originalRulerUnits = app.preferences.rulerUnits;
    try {
        if (app.documents.length === 0) {
            return "ERROR:No document is open in Photoshop.";
        }
        if (!text || text.length === 0) {
            return "ERROR:Text content is empty.";
        }

        // Ép đơn vị thước đo về pixel để tính toán vị trí/kích thước khung chữ ổn định,
        // bất kể document đang để đơn vị gì (inch, cm, mm...).
        app.preferences.rulerUnits = Units.PIXELS;

        var doc = app.activeDocument;
        var docWidth = doc.width.as("px");
        var docHeight = doc.height.as("px");

        // Mặc định: tâm canvas, giới hạn chiều rộng tối đa = toàn bộ canvas
        var centerX = docWidth / 2;
        var centerY = docHeight / 2;
        var refWidth = docWidth;

        // Nếu vẫn còn vùng chọn (chính là vùng người dùng đang zoom vào làm việc),
        // dùng tâm của vùng chọn đó làm vị trí đặt layer mới.
        try {
            var bounds = doc.selection.bounds; // [left, top, right, bottom]
            var left = bounds[0].as("px");
            var top = bounds[1].as("px");
            var right = bounds[2].as("px");
            var bottom = bounds[3].as("px");
            centerX = (left + right) / 2;
            centerY = (top + bottom) / 2;
            refWidth = Math.max(right - left, 150);
        } catch (e) {
            // không có selection -> giữ mặc định tâm canvas
        }

        // Ước lượng kích thước khung chữ vừa đủ hiển thị text (không cố định to như trước).
        var maxBoxWidth = Math.min(refWidth, docWidth * 0.9);
        if (maxBoxWidth < 150) maxBoxWidth = 150;

        var avgCharWidth = fontSize * 0.55; // độ rộng trung bình ước lượng cho 1 ký tự
        var lineHeight = fontSize * 1.35;
        var singleLineWidth = text.length * avgCharWidth;

        var boxWidth, numLines;
        if (singleLineWidth <= maxBoxWidth) {
            // Text ngắn -> khung chỉ rộng vừa đủ 1 dòng (+ chút lề)
            boxWidth = Math.max(singleLineWidth + fontSize, fontSize * 3);
            numLines = 1;
        } else {
            // Text dài -> khung rộng tối đa cho phép, tính số dòng cần để chứa hết
            boxWidth = maxBoxWidth;
            numLines = Math.ceil(singleLineWidth / maxBoxWidth) + 1; // dư phòng sai số ước lượng
        }

        var boxHeight = Math.max(numLines * lineHeight + fontSize, lineHeight * 1.5);

        var posX = centerX - boxWidth / 2;
        var posY = centerY - boxHeight / 2;

        var newLayer = doc.artLayers.add();
        newLayer.kind = LayerKind.TEXT;

        var ti = newLayer.textItem;
        ti.kind = TextType.PARAGRAPHTEXT; // dạng Paragraph (area text), không phải Point text
        ti.position = [posX, posY];
        ti.width = boxWidth;
        ti.height = boxHeight;
        ti.contents = text;
        ti.size = fontSize; // point
        ti.useAutoLeading = true;

        newLayer.name = "Translated Text";

        app.preferences.rulerUnits = originalRulerUnits;
        return "OK:" + newLayer.name;
    } catch (err) {
        try {
            app.preferences.rulerUnits = originalRulerUnits;
        } catch (e2) {}
        return "ERROR:" + err.toString();
    }
}

/**
 * Khởi động server Node.js (server.js) trong nền.
 * @param {string} extensionPath - đường dẫn tuyệt đối tới thư mục cài đặt extension
 *        (do panel JS lấy từ csInterface.getSystemPath(SystemPath.EXTENSION) và truyền vào).
 *        Không được hard-code path vì mỗi máy/mỗi user sẽ có path khác nhau
 *        (VD: C:/Users/<user>/AppData/Roaming/Adobe/CEP/extensions/TypoVision).
 * @returns {string} "OK:..." hoặc "ERROR:..."
 */
function startNodeServer(extensionPath) {
    try {
        if (!extensionPath) {
            return "ERROR:Missing extensionPath argument.";
        }
        var basePath = extensionPath.replace(/\\/g, "/");
        var batPath = basePath + "/server/start_server.bat";
        var batFile = new File(batPath);
        if (!batFile.exists) {
            return "ERROR:Batch file not found at " + batPath;
        }
        batFile.execute();
        return "OK:Server start command executed.";
    } catch (e) {
        return "ERROR:" + e.toString();
    }
}

/**
 * Dừng server Node.js (server.js) đang chạy nền.
 * @param {string} extensionPath - đường dẫn tuyệt đối tới thư mục cài đặt extension
 *        (do panel JS lấy từ csInterface.getSystemPath(SystemPath.EXTENSION) và truyền vào).
 * @returns {string} "OK:..." hoặc "ERROR:..."
 */
function stopNodeServer(extensionPath) {
    try {
        if (!extensionPath) {
            return "ERROR:Missing extensionPath argument.";
        }
        var basePath = extensionPath.replace(/\\/g, "/");
        var batPath = basePath + "/server/stop_server.bat";
        var batFile = new File(batPath);
        if (!batFile.exists) {
            return "ERROR:Batch file not found at " + batPath;
        }
        batFile.execute();
        return "OK:Server stop command executed.";
    } catch (e) {
        return "ERROR:" + e.toString();
    }
}