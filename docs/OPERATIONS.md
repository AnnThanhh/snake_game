# Công nghệ và vận hành — 07/10/2026

Đã đọc 12 tài liệu ban đầu trong `docs/`, đối chiếu BE/FE, scripts, dependencies, monitoring và kiểm thử. Giữ stack hiện tại và bổ sung khả năng chẩn đoán lỗi, giới hạn tài nguyên. Chưa chứng nhận vận hành nhiều ngày hoặc mục tiêu 1.500/5.000 CCU.

## Công nghệ

| Thành phần | Bản đang dùng / vai trò | Nhận xét |
|---|---|---|
| Node.js | Máy thử 24.9.0 | Patch cũ; cần nâng bản vá mới của 24 LTS qua staging. Chưa đổi Node toàn máy |
| API | NestJS 11.2.5, Fastify 5.12.5 | Thêm log cả lỗi parser và phản hồi bridge HTTP |
| DB | Prisma 7.10.0, `pg`, PostgreSQL 18 Docker | Prisma dùng cho catalog; nhiều nghiệp vụ dùng transaction SQL qua `pg` |
| Realtime | Colyseus 0.17.51, snapshot worker threads | Giữ authority, catalog từng phòng; không thêm DB/log mỗi tick |
| Queue | BullMQ 6.3.8, Redis 8 Docker | Giữ SQL idempotency và durable outbox; bổ sung log xử lý kết quả |
| FE | Phaser 3.90, Vite 7.3.6, TypeScript 5.9 | Build riêng, production proxy có deadline và cleanup socket |
| Monitoring | Prometheus, Grafana, OTel tùy chọn | Thêm HTTP/outbox metrics và alert; chưa có kho trace dài hạn |

Hai dự án có `.nvmrc` chọn dòng 24 và engine `^22.12.0 || ^24.0.0`, đồng bộ metadata lockfile. Không nâng dependency hoặc đổi dependency graph. `>=22` trước đây cho phép Node 22.0 dù Prisma/Vite yêu cầu ít nhất 22.12 ở dòng 22. Dòng 24 đã vào LTS, hỗ trợ đến tháng 4/2028 theo [Node.js](https://nodejs.org/en/blog/migrations/v22-to-v24). Mỗi lần nâng patch vẫn cần chạy regression.

## Log phản hồi server

- `npm.cmd start` BE ghi `.data/logs/api.jsonl`, `gateway.jsonl`, `authority.jsonl`, `worker.jsonl` theo service có sự kiện. FE production ghi `fe/.data/logs/frontend.jsonl`; Vite dev chưa có file log này.
- Mỗi service tối đa 5 file × 10 MiB, file hiện tại và `.1`–`.4`; ghi batch bất đồng bộ, hàng đợi tối đa 1 MiB. `LOG_DIR` là đường dẫn triển khai. Nhiều instance cùng service phải dùng `LOG_INSTANCE` hoặc thư mục khác nhau để tránh cùng quay vòng file.
- Trường log: UTC, service/PID, event, requestId, route chuẩn hóa, method, status, durationMs, outcome. responseBytes chỉ có khi có Content-Length, không phải tổng traffic/TLS.
- FE tạo UUID mới, gateway/API giữ cùng `X-Request-ID`. Đã xác nhận cùng ID ở cả ba lớp HTTP thật. ID này chỉ để tra cứu, không cấp quyền và không thay UUID idempotency trong body mutation.
- Ghi 2xx/4xx/5xx. `status:499, outcome:aborted` là phân loại log cho luồng bị ngắt, không phải HTTP status gửi tới browser. Không nối JSON lỗi vào response đã gửi dở.
- Room có sự kiện join/disconnect/reconnect theo room/mode. Không ghi từng input hoặc snapshot.
- Outbox/worker có `result.retry_pending`, `result.saved`, `outbox.backlog`, `outbox.write_failed`, `worker.job_failed`, `worker.result_rejected`, `worker.result_saved` với life ID khi có. File chưa được API xác nhận tiếp tục được giữ lại.

Danh sách trường cho phép loại bỏ body, query string, header, cookie, mật khẩu, MFA, ticket, reconnect token, SQL và Error.message/stack tùy ý. Cách loại dữ liệu nhạy cảm tham khảo [OWASP Logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html). Log vận hành không thay audit quản trị PostgreSQL. Không có API công khai đọc log; `.data/` không thuộc tài nguyên FE và được gitignore.

Chạy trong từng dự án:

```powershell
npm.cmd run ops:logs
npm.cmd run ops:logs -- --request-id UUID_LAY_TU_X_REQUEST_ID
```

Lệnh đầu tổng hợp status/sự kiện/thời gian phản hồi trong file còn lưu; lệnh sau in tối đa 1.000 bản ghi khớp ID. Retention theo dung lượng, chưa theo ngày, chưa thu gom tập trung. Log có thể mất khi kill đột ngột, ổ đĩa lỗi hoặc queue đầy. Lỗi file báo qua stderr; API/authority có `serpent_log_dropped_records` và `serpent_log_storage_failures`. Quyền POSIX `0600` không thay ACL Windows; cần hạn chế quyền đọc thư mục thực tế. Process manager phải giới hạn dung lượng nếu thu gom stdout/stderr riêng.

## Health và monitoring

- `GET/HEAD /api/live`: `{version:1,ok:boolean}`, 200/503, chỉ kiểm tra gateway.
- `GET/HEAD /api/ready`: cùng schema, no-store; gateway kiểm tra API/authority, API kiểm tra PostgreSQL/Redis, authority kiểm tra Redis/API. Probe gộp đồng thời, cache ngắn và timeout; một dependency treo không tạo thêm probe vô hạn.
- Readiness không chứng nhận worker đang trả thưởng, ổ đĩa còn chỗ, mọi room đạt tick hoặc capacity production. `/api/health` giữ hợp đồng telemetry cũ.
- Proxy FE có deadline toàn phản hồi 15 giây, gateway 10 giây; trước headers trả 504 khi timeout. Client hủy thì hủy upstream. Body bị cắt giữa chừng gây lỗi đọc ở client. Không tự retry mutation.
- FE shutdown đóng WebSocket nâng cấp và giới hạn chờ HTTP; gateway đóng socket proxy. Đây chưa phải drain chờ toàn bộ trận kết thúc hoặc khôi phục world sau crash.
- `/metrics` API/authority nằm trên cổng nội bộ, không proxy qua FE/gateway. Labels HTTP giới hạn route/method/status; không lấy query, user ID hoặc request ID làm label.
- Gauge outbox ghi số file chờ và tuổi file lâu nhất ở lần quét gần nhất (mtime file, không phải thời gian bắt đầu trận); có thể trễ khi flush kéo dài.
- Prometheus scrape API 3001 và authority 3002. Grafana thêm HTTP rate/latency và backlog. Ba alert: mất metrics, API 5xx >5% trong 5 phút, outbox tồn đọng. Ngưỡng cần hiệu chỉnh theo production.
- Promtool xác nhận YAML và 3 rules. Đã cập nhật riêng Prometheus, giữ volume PostgreSQL/Redis. Chưa nối Alertmanager/email/chat/pager.

## Kiểm thử

| Kiểm tra | Kết quả |
|---|---|
| Build BE/FE độc lập | Đạt |
| BE unit/regression | 75 kiểm tra |
| FE unit/static/proxy | 37 kiểm tra |
| BE account/admin/queue | 7/11/6 đạt, schema/namespace thử nghiệm |
| BE authority | SDK lifecycle, reward idempotency, thu hồi quyền, report/vi phạm đạt |
| `test:operations` | Nest/Fastify + authority: parser 400, request ID, metrics riêng tư, API tắt thì readiness 503 |
| Chrome gameplay V2 / security UI | 13 / 4 kiểm tra đạt |
| HTTP 60 giây | 30 vòng, 120 GET, 0 lỗi; không phải tải gameplay |
| Log thật | JSONL đọc được, ID khớp FE/gateway/API |

Artifacts: BE `artifacts/operations-*.txt`, `operations-smoke.json`, `operations-correlation.json`, `operations-monitoring.json`, `http-soak.json`; FE `operations-unit.txt`, `operations-build.txt`, `operations-browser.txt`, `operations-browser-security.txt` và artifacts browser hiện có. Prometheus ghi nhận cả hai target UP và ba rules healthy trong lúc kiểm thử. Lần đầu authority bị timeout tải cấu hình, lần đầu smoke timeout khởi động API; chạy lại riêng đạt. Không dùng lượt timeout làm bằng chứng ổn định. Không đổi schema, seed, quyền hoặc capacity DB thật trong đợt này. Các tiến trình ứng dụng chạy thử đã được dừng sau kiểm thử; chạy ứng dụng bình thường bằng `npm.cmd start` riêng từng dự án, monitoring vẫn giữ cấu hình mới.

npm audit mới **chưa hoàn tất**: sandbox không truy cập được registry; bộ duyệt tự động từ chối escalation do gửi dependency inventory ra npm registry chưa được cho phép cụ thể. Đã hỏi quyền riêng, không dùng kết quả cũ “0 advisory” để khẳng định hiện tại.

Dưới `be/`, sau build và Docker sẵn sàng:

```powershell
npm.cmd run test:operations
# Gateway/FE phải đang chạy; thăm dò HTTP một giờ:
$env:SOAK_URL='http://127.0.0.1:3000'
$env:SOAK_SECONDS='3600'
npm.cmd run test:soak:http
```

Probe GET tuần tự live/ready/catalog/rooms, ghi checkpoint; có lỗi hoặc dừng giữa chừng trả exit code khác 0. Không đăng ký tài khoản, mua hàng, nhận thưởng, đổi DB hoặc tự tạo trận. Tối đa 24 giờ, interval 1–60 giây. Chưa thực hiện lượt nhiều giờ.

## Công việc tiếp theo

1. Nâng patch Node 24 LTS qua staging; audit khi được phép; kiểm tra patch/image digest PostgreSQL/Redis/monitoring theo lịch.
2. Soak gameplay nhiều giờ, profile RAM/GC và snapshot workers qua nhiều lượt tạo/hủy room; tải DB/queue bằng tài khoản thử và máy sinh tải riêng.
3. Process supervisor, deploy/drain, worker heartbeat, kiểm thử crash/outage và phục hồi backup trên bản sao. Launcher hiện dừng các service khi một child chết, chưa tự phục hồi cụm.
4. Log/trace tập trung, cảnh báo ngoài Prometheus, quota outbox và quy trình xử lý kết quả bị từ chối lâu dài. Không xóa hoặc tự tính lại thưởng để làm sạch backlog.
5. Routing nhiều authority/TLS/WAN, giảm snapshot bandwidth và tách bundle FE. Gameplay bundle vẫn khoảng 5,14 MB chưa nén, gzip 814 KB; đợt này không tối ưu renderer.

Giới hạn tải giữ theo [CAPACITY](CAPACITY.md); bảo mật theo [SECURITY](SECURITY.md). Nội dung/gameplay mới vẫn có version trong DB; thay đổi quản trị cần permission/whitelist/MFA/reason/audit/idempotency.
