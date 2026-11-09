# Sổ Điểm

Website ghi điểm học sinh từ lớp 7 đến lớp 9 và lớp IELTS.
Chạy hoàn toàn trên trình duyệt (HTML/CSS/JS), không cần máy chủ, không cần cài đặt.

## Cách dùng
- Mở file `index.html` bằng trình duyệt, hoặc bật **GitHub Pages** cho repo (Settings → Pages → nhánh `main`, thư mục `/root`).
- Các lớp: **Lớp 7, Lớp 8, Lớp 9 (9.1, 9.2, 9.S), Lớp IELTS**.
- Mỗi lớp có 3 sheet: **Điểm trên lớp**, **Điểm khảo sát**, **Kế hoạch IELTS**.

### Sheet "Điểm trên lớp" / "Điểm khảo sát"
Các cột: **Họ và tên**, **Buổi 1 → Buổi 10**, **Tổng số buổi đi học** (kèm Điểm TB).
Mỗi buổi gồm các cột nhỏ:

| Cột nhỏ | Kiểu |
|---|---|
| Điểm danh, BTVN, Chép nghe, Chép phạt | ô tích |
| Điểm nghe, Điểm từ mới, Điểm kiến thức trọng tâm, Điểm KT đầu giờ | điểm |

**Quy đổi điểm ra thang /10:** ở hàng vàng **"Tổng số câu"**, nhập tổng số câu của từng bài.
Ở ô của mỗi học sinh, nhập **số câu đúng**. Trang tự tính `điểm = số câu đúng / tổng số câu × 10`
và tô màu (≥8 xanh lá, 6,5–8 xanh dương, 5–6,5 cam, <5 đỏ).

**Điểm danh:** bấm 1 lần = ✓ có mặt, 2 lần = ✗ vắng, 3 lần = xoá. Học sinh vắng buổi nào thì các ô của buổi đó
và các ô tên, tổng kết trên dòng của em được bôi đỏ.

**Thêm / xoá cột và buổi:** nút **+ Thêm cột** (chọn loại: điểm, ô tích, điểm danh, ghi chú) và **+ Thêm buổi**.
Nút **×** trên tiêu đề dùng để xoá cột hoặc xoá buổi. Bấm đúp tên cột để đổi tên.
Mỗi lớp và mỗi sheet có bộ cột riêng.

**Giao diện:** mỗi buổi một màu. Cột STT, họ tên và các hàng tiêu đề được cố định khi cuộn.
Font chữ và cỡ chữ chọn ở góc trên bên phải.

### Sheet "Kế hoạch IELTS"
Bảng kế hoạch học gồm: tuần, ngày, kỹ năng, nội dung bài học, tài liệu, mục tiêu band, hoàn thành, ghi chú.

## Dữ liệu
- Dữ liệu tự lưu trong `localStorage` của trình duyệt, tức là chỉ nằm trên máy và trình duyệt đang dùng.
- **Sao lưu** tải về file `.json`. **Khôi phục** nạp lại file đó, ví dụ khi chuyển sang máy khác.
- **Xuất Excel (CSV)** xuất sheet đang xem.
