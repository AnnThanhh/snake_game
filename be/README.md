# Backend độc lập

Yêu cầu Node.js 22.12+ trong dòng 22 hoặc dòng 24 và Docker Desktop; khuyến nghị bản vá mới của 24 LTS (`.nvmrc`). Chạy mọi lệnh dưới `be/`.

Log mới tại `.data/logs/`; đọc bằng `npm.cmd run ops:logs` hoặc thêm `-- --request-id UUID`. Có `/api/live`, `/api/ready`, metrics HTTP/outbox, `test:operations` và `test:soak:http`. Xem [OPERATIONS](../docs/OPERATIONS.md).

```powershell
npm.cmd ci
npm.cmd run setup
npm.cmd run infra:up
npm.cmd run build
npm.cmd start
```

`setup` giữ nguyên `.env` hiện có. `start` áp dụng migration cộng thêm, chuẩn bị tài khoản PostgreSQL hạn chế quyền rồi chạy worker, Nest/Fastify, Colyseus và gateway. Build không cần frontend. Docker project vẫn là `serpent-survivor`; không xóa volume khi cập nhật.

Migration `009_security` thêm report có danh mục/context, thông báo, appeals, security events và cấu hình UI/operations. Backup trước khi áp dụng DB thật. Quản trị dùng tab Báo cáo/Xem xét ban/Sự kiện bảo mật; thông tin vận hành và hạn chế đã kiểm thử nằm trong [SECURITY](../docs/SECURITY.md). Nội dung game runtime phải lấy catalog DB, fixture cũ chỉ dành cho kiểm thử.

| Đường dẫn | Nội dung |
|---|---|
| backend/ | Domain, RBAC, MFA, transaction, migration SQL, seed có version |
| src/api, src/server, src/worker | Nest/Prisma, Colyseus + snapshot workers, BullMQ |
| game/ | Engine authority và codec backend |
| server/ | Gateway HTTP/WebSocket, bot, durable outbox |
| scripts/, tests/ | Công cụ và kiểm thử riêng backend |
| prisma/, generated/, dist/ | Schema, client được sinh, bản build |
| compose.yaml, ops/ | Docker PostgreSQL/Redis và monitoring |
| .data/, artifacts/ | Backup/outbox và báo cáo kiểm thử; không phục vụ qua HTTP |

## Kiểm thử

```powershell
npm.cmd test
npm.cmd run test:backend
npm.cmd run test:admin
npm.cmd run test:queue
npm.cmd run test:authority
npm.cmd run test:load
```

Các test DB tạo schema riêng rồi dọn schema đó, không reset dữ liệu thật. `test:docker` chủ động restart các container của dự án để kiểm tra độ bền volume; không chạy khi đang phục vụ người chơi. `test:load` chạy fixture trên cổng ngẫu nhiên và ghi `artifacts/v2-load.json`. Room capacity vận hành nằm trong catalog DB, không lấy từ kết quả benchmark một cách tự động.

## Quản trị và dữ liệu

Đăng ký tài khoản qua frontend, rồi bootstrap có chủ đích bằng CLI:

```powershell
npm.cmd run admin:bootstrap -- --username ten_tai_khoan --reason "Khởi tạo người vận hành cục bộ"
```

CLI ghi audit. Sau đó vào frontend `/admin.html` để thiết lập MFA. Không in hoặc chia sẻ khóa MFA/.env. Phân quyền runtime dựa vào các bảng DB, không dựa tên role. Thay đổi quyền vô hiệu cache/phiên đặc quyền. Các lệnh quản trị cần reason và UUID idempotency.

Sao lưu trước migration dữ liệu thật: dùng `docker compose exec -T postgres pg_dump -U serpent -d serpent -Fc -f /tmp/backup.dump`, rồi `docker compose cp postgres:/tmp/backup.dump .data/backups/backup.dump`. Không dùng `db push`, reset schema, hoặc `down -v` để nâng cấp.

## Monitoring

Đo tải nhiều phòng bằng `npm.cmd run test:capacity` khi API/Redis đang chạy. Báo cáo JSON nằm trong `artifacts/`; giới hạn và kết quả thực tế tại [CAPACITY](../docs/CAPACITY.md). Bộ đo có ngưỡng RAM dự phòng, không ghi catalog production và không tạo tài khoản thật. Nội dung SEO công khai qua API version 1; cấu hình `site` quản trị trong DB, xem [SEO](../docs/SEO.md).

`npm.cmd run monitoring:up` chuẩn bị cấu hình và khởi động profile monitoring. Prometheus: http://127.0.0.1:9090; Grafana: http://127.0.0.1:3030. OTel nhận OTLP tại 4318 khi đặt `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318` trong `.env`; collector hiện xuất trace ra log, chưa có kho tra cứu trace dài hạn.

`HOST`/`PORT` cấu hình gateway. `BACKEND_PORT`/`BACKEND_URL` là API tài khoản nội bộ; `REALTIME_PORT`/`REALTIME_URL` là Colyseus. `APP_ENV` phải khớp whitelist. Secrets nằm trong `.env`; chỉ gateway cần được frontend truy cập. API/worker sử dụng tài khoản PG riêng; authority không được truyền credential DB.
