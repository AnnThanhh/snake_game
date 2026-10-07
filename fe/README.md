# Frontend độc lập

Yêu cầu Node.js 22.12+ trong dòng 22 hoặc dòng 24; khuyến nghị bản vá mới của 24 LTS (`.nvmrc`). Chạy dưới `fe/`; không cần thư mục backend để cài đặt, build hoặc phục vụ giao diện.

Production ghi `.data/logs/frontend.jsonl`, giới hạn dung lượng và trả `X-Request-ID` để đối chiếu BE. Dùng `npm.cmd run ops:logs` hoặc thêm `-- --request-id UUID`. Proxy có deadline 15 giây và hủy upstream khi client ngắt. Vite dev chưa ghi file log này. Xem [OPERATIONS](../docs/OPERATIONS.md).

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Mở http://127.0.0.1:5173. Để chơi online cần backend HTTP đang hoạt động. Cấu hình tùy chọn trong `fe/.env` (tham khảo `.env.example`):

```dotenv
HOST=127.0.0.1
PORT=5173
BACKEND_URL=http://127.0.0.1:3000
```

`npm.cmd run dev` dùng Vite và proxy tới `BACKEND_URL`; `npm.cmd start` dùng static/proxy server riêng phục vụ `dist/`. Giao diện và backend giao tiếp qua HTTP/WebSocket, không import mã backend. Cookie tài khoản dùng cùng origin của frontend qua proxy. Không đặt DB, Redis hoặc secrets nội bộ trong dự án này.

- `public/`: HTML/CSS, UI tài khoản/quản trị, tài nguyên.
- `public/game/`: bản engine phục vụ Solo và codec client, sở hữu riêng bởi frontend.
- `src/client/`: TypeScript, Phaser, prediction/interpolation và Colyseus adapter.
- `scripts/`: build, serve và browser tests.
- `tests/`: kiểm thử client engine/codec/static proxy.
- `artifacts/`: ảnh và kết quả kiểm thử giao diện.

```powershell
npm.cmd test
npm.cmd run test:browser:v2
npm.cmd run test:browser
npm.cmd run test:browser:admin
npm.cmd run test:seo
npm.cmd run test:security
```

Browser gameplay tests cần Chrome và backend đang chạy. Dùng `V2_TEST_URL` hoặc `TEST_URL` để kiểm tra frontend được triển khai ở địa chỉ khác. `test:browser:admin` tự chạy static server của frontend và API fixtures để kiểm tra UI, không cần backend; quyền/MFA thật được kiểm tra trong bộ integration của BE. Các test không đọc hoặc khởi tạo mã nguồn dự án còn lại. Cập nhật protocol cần kiểm tra tương thích với backend qua browser tests.

Production `scripts/serve.js` render nội dung SEO từ API `/api/site` và phục vụ robots/sitemap/guides; không truy cập DB. Metadata và domain quản lý qua backend Admin Settings. Vite dev không chạy lớp SSR này. Hướng dẫn bật index và số đo nén tại [SEO](../docs/SEO.md). Ảnh chia sẻ có vector gốc `public/social-cover.svg`; dựng lại PNG bằng `node scripts/render-social-cover.js` rồi build FE.

UI đọc `/api/configuration` version 1 để nhận copy, giới hạn tài khoản và danh mục kiểm duyệt. Thiếu cấu hình thì không tự nạp bảng dữ liệu dự phòng. `test:security` chạy Chrome trên bản FE/BE đang mở, thay response tài khoản bằng fixtures để thử report/ban/appeal và XSS mà không tạo dữ liệu thật. Xem [báo cáo bảo mật](../docs/SECURITY.md).
