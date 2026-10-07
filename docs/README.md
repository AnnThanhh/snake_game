# Serpent Survivor

Đợt 07/10: [công nghệ, log phản hồi và độ ổn định vận hành](OPERATIONS.md). Có JSONL, request ID, live/readiness, metrics/alert và HTTP probe; chưa chứng nhận vận hành nhiều giờ hoặc capacity mới.

Triển khai theo instruction.md, update.md và updatev2.md. Hai dự án chạy độc lập, không dùng workspace hoặc mã nguồn chung:

- `be/`: API, Colyseus authority, BullMQ worker, engine, Prisma, migrations, Docker, monitoring, scripts, tests và node_modules riêng.
- `fe/`: UI, Phaser, mã client/codec, static server, Vite, scripts, tests và node_modules riêng.
- Root chỉ giữ tài liệu. Không chạy npm tại root.

## Chạy ứng dụng

Terminal backend:

```powershell
cd be
npm.cmd ci
npm.cmd run setup
npm.cmd run infra:up
npm.cmd run build
npm.cmd start
```

Terminal frontend:

```powershell
cd fe
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Mở **http://127.0.0.1:5173**. Backend công khai API tại `http://127.0.0.1:3000`; API nội bộ ở 3001 và Colyseus ở 3002. Khi phát triển frontend dùng `npm.cmd run dev` thay cho build/start. Hai chế độ frontend cùng dùng cổng 5173 nên chạy một chế độ tại một thời điểm.

Frontend có thể đặt trên máy khác: cấu hình `BACKEND_URL` trong `fe/.env` trỏ đến HTTP gateway của backend. Không sao chép `be/.env` sang frontend. Mọi dữ liệu vận hành, role, permission, whitelist, cap và phiên bản gameplay lấy từ PostgreSQL; frontend chỉ nhận danh mục công khai.

PostgreSQL/Redis và các volume hiện có được giữ nguyên. Compose nằm tại `be/compose.yaml`, dữ liệu outbox/backup tại `be/.data/`. Xem [hướng dẫn backend](be/README.md), [frontend](fe/README.md), [kiến trúc](docs/ARCHITECTURE.md) và [trạng thái V2](docs/V2-IMPLEMENTATION.md).

Đợt 05/10: xem [đo tải và mục tiêu 1.500/5.000 người](docs/CAPACITY.md) và [SEO, nội dung DB, cách bật index cho domain](docs/SEO.md). Các số đo local không phải chứng nhận tải production.

## Điều khiển

Chuột/chạm để dẫn hướng; A/D để rẽ, W/S chỉnh tốc độ; Space lướt, Q xung lực; 1/2/3 chọn nâng cấp; B chọn cơ quan/keystone/curse/mutation; giữ E hoặc nút Rút lui trên màn hình trong cổng Extraction; Esc mở menu; F3 xem telemetry. Co-op/Raid cần Ready. Open Arena và Crown cho phép vào thế giới đang chạy.

Khách và Solo cục bộ không nhận phần thưởng tài khoản. Phần thưởng online chỉ được ghi từ kết quả authority qua queue. Trang `/admin.html` cần tài khoản có permission, whitelist đúng môi trường và MFA; không tự cấp admin cho tài khoản hiện có.
