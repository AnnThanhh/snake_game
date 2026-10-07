# Xác minh V2

## Vận hành — 07/10/2026

Build BE/FE đạt; BE 75 unit, FE 37 unit; account/admin/queue 7/11/6 đạt. Authority và smoke Nest/Fastify/Colyseus đạt; Chrome V2 13, security UI 4 kiểm tra đạt. HTTP 60 giây: 120 GET, 0 lỗi; không đo capacity mới. Log có X-Request-ID khớp FE/gateway/API. Promtool xác nhận 3 rules; audit npm mới chưa hoàn tất do thiếu quyền gửi dependency inventory. Phương pháp, timeout ban đầu và giới hạn tại [OPERATIONS](OPERATIONS.md).

## Bảo mật — 06/10/2026

Đã áp dụng `009_security`, catalog `overgrowth-v2-1-r1-r2-r3-r4`, sau backup 210.333 bytes. Hai build độc lập đạt. BE 68 unit; admin/account/queue/authority lần lượt 11/7/6/1 đạt. FE 34 unit; Chrome gameplay/admin/SEO/security lần lượt 13/10/6/4 kiểm tra. npm audit đã được người dùng cho phép: cả hai không có advisory ở lần quét 05/10; không đổi dependencies sau đó. Chi tiết phương pháp, artifact và giới hạn tại [SECURITY](SECURITY.md). Số liệu tải dưới đây giữ nguyên, không suy ra khả năng tải mới từ thay đổi presence cap.

## Bổ sung ngày 05/10/2026

DB đã áp dụng migration `008_site` sau backup `be/.data/backups/before-site-20261005.dump` (207.131 bytes). BE/FE build độc lập đạt; BE 64 unit và 10 admin integration đạt, gồm quyền/validation/audit/idempotency cho SEO. FE 33/33 unit/static/SEO tests đạt ở lần chạy cuối, sau khi sửa lỗi status khi API site thiếu. Chrome SEO 6 kiểm tra đạt khi tắt JavaScript/mobile/ảnh/nén; 13 kiểm tra browser gameplay V2 đạt sau triển khai SEO.

Bài tải nhiều phòng: normal xác nhận 30 người/3 phòng/120 giây, late xác nhận 10 người/1 phòng/120 giây. Các mức lớn hơn bị RAM guard dừng; không phải capacity proof 1.500/5.000 CCU. HTTP read burst đạt 80/80 trên hai endpoint công khai; quota mutation trả 429 sau 60 yêu cầu trong cùng bucket. Xem [CAPACITY](CAPACITY.md), [SEO](SEO.md) và JSON artifacts để biết đầy đủ phương pháp/giới hạn. Chưa đo WAN, soak nhiều giờ hoặc indexing thật của Google.

## Đợt xác minh 04/10/2026

Môi trường: Windows x64, Node.js 24.9.0, Chrome qua Playwright, Docker Desktop Engine 29.6.1. PostgreSQL 18 và Redis 8 dùng các volume hiện có. Test dữ liệu tạo schema/namespace riêng và dọn lại; không tạo tài khoản admin mẫu hoặc reset schema public.

## Build và cấu trúc

Hai lệnh `npm.cmd run build` chạy riêng tại `be/` và `fe/` đều đạt. Lockfile có root package riêng, không workspace hoặc file/link dependency. Hai thư mục node_modules là thư mục vật lý riêng. Rà soát mã/scripts/tests không phát hiện import xuyên `be/`–`fe/` hoặc shared root. Root chỉ còn tài liệu và hai dự án.

Frontend dist được phục vụ tại 5173; API qua gateway 3000, account API 3001, Colyseus 3002. Bootstrap không chạy game bằng catalog hardcode khi API không sẵn sàng. Phiên bản DB đã migrate đến 007_world; seed không ghi đè dữ liệu khi khởi động lại.

## Kiểm thử đạt

| Dự án / lệnh | Kết quả | Phạm vi |
|---|---:|---|
| BE `npm.cmd test` | 64/64 | Engine/codec/HTTP legacy regression và gameplay V2; lần chạy 26/09 |
| FE `npm.cmd test` | 30/30 | Client engine/codec/static server, Auto graphics; lần chạy 26/09 |
| BE admin/backend/queue/authority integration | 23/23 | PostgreSQL + Redis + BullMQ + SDK thật, chạy 04/10 |
| BE `test:admin` sau bổ sung assertion fail-closed | 9/9 | Thiếu endpoint mapping trong DB vẫn bị từ chối khi có wildcard; 04/10 |
| FE `test:browser` | 6/6 | Menu, Solo ăn XP/nâng cấp, hai Co-op, reload, mobile; 04/10 |
| FE `test:browser:v2` | 13/13 | Catalog, Phaser/protocol 3, build UI, reload/drop/reconnect, Crown/Raid/Extraction, resolution/mobile, bảo vệ trang admin; 04/10 |
| FE `test:browser:admin` | 10/10 | UI MFA, definitions từ API, reason, retry idempotency, tạo role, đổi settings, xử lý report, hồ sơ/mùa/lịch sử; 04/10 |
| BE `test:load`, 45 giây/kịch bản | 2/2 | Tải Colyseus/Redis, chi tiết bên dưới; 04/10 |

23 integration tests tính cả suite cha theo báo cáo node:test; không cộng 9 test admin chạy lại thành 32 test khác nhau. UI quản trị/tài khoản dùng HTTP fixtures riêng của FE và không xác nhận bảo mật backend; MFA/RBAC/DB thật được xác nhận bởi BE integration.

Các assertion quan trọng: Hydra đủ năm pha; curse có lợi/hại; cơ quan mất khi đốt bị phá; branch metadata dựng được qua codec; capture/revive/extraction dùng thời gian authority; đòn mạnh ngắt rút lui; biome cùng seed cho cùng biến thể; bot dùng trọng số/điểm tiến hóa hợp lệ; Auto hạ rồi phục hồi chất lượng có hysteresis.

Lifecycle SDK dùng hai tài khoản Co-op, thu hồi quyền trong DB và xác nhận rời phòng; sau đó Extraction ghi 18 DNA và 9 di vật đúng một lần. Queue kiểm tra restart/idempotency/conflicting payload, cap mastery/thưởng và quyền hạn chế của worker. Restart backend giữ cap, tên loài và ánh xạ quyền đã chỉnh, không phát hành lại catalog.

Browser test phát hiện lỗi Ready có thể đến trước snapshot; đã sửa `started`/`respawned` qua hàng đợi snapshot đầy đủ và xác nhận lại. Không còn uncaught browser error ở các bài đạt. Phản hồi 401 khi khách mở admin là lỗi dự kiến.

## Tải local

Mỗi kịch bản có 4 giây warmup và khoảng 45 giây lấy mẫu mạng. Authority ở process riêng, snapshot encode trong worker threads; client dùng Colyseus SDK/WebSocket thật. Fixture duy trì 500 quái, 800 thức ăn, 500 đạn và 100–120 đốt/rắn, giữ rắn sống để không làm tải giảm. Tổng người + bot là 30, không phải 30 người cộng thêm 18 bot.

| Kịch bản | Tick trung bình | p95 từng tick | p99 | Tần số thực | Snapshot/client | Wire/client |
|---|---:|---:|---:|---:|---:|---:|
| 12 người + 18 bot | 17,83 ms | 25,90 ms | 30,24 ms | 20,00 Hz | 14,93–15,00 Hz | 149,68–202,73 KiB/s |
| 30 người | 12,84 ms | 20,57 ms | 23,76 ms | 20,01 Hz | 14,66–14,75 Hz | 148,47–176,23 KiB/s |

Tick đo AI + simulation + gửi snapshot job; **không bao gồm thời gian encode trong worker**. Tất cả kết nối nhận/giải mã envelope SDK; codec delta đầy đủ được kiểm tra ở mỗi client thứ mười. Không có drop/error trong mẫu, mọi client có ACK và >10 snapshot/s. Heap main process dao động khoảng 35–123 MiB; đây chưa phải bằng chứng không rò rỉ dài hạn và không bao gồm heap của tất cả worker/client.

Gate local đạt mean <20 ms, p95 <35 ms và simulation >=19,5 Hz. Dữ liệu thô: [be/artifacts/v2-load.json](../be/artifacts/v2-load.json). Chênh lệch quỹ đạo/AOI và bot làm hai kịch bản không thể dùng để suy ra chi phí mỗi người chơi một cách tuyến tính.

Không đo WAN/TLS/TCP header, FPS thiết bị thật, nhiều room/process đồng thời hoặc soak nhiều giờ. Capacity vận hành vẫn lấy DB (10 Arena/Crown/Extraction, 4 Co-op, 8 Raid), không tự nâng từ benchmark. Không công bố 200–300 CCU.

## Artifacts và monitoring

- [V2 browser result](../fe/artifacts/v2-browser-results.json), [UI admin result](../fe/artifacts/admin-ui-results.json), [smoke result](../fe/artifacts/browser-results.json).
- [Trang chủ V2](../fe/artifacts/v2-home.png), [Arena](../fe/artifacts/v2-arena.png), [Extraction mobile](../fe/artifacts/v2-extraction-mobile.png), [UI báo cáo](../fe/artifacts/admin-reports.png).
- Prometheus 9090 đã scrape authority 3002 với target UP; Grafana 3030 trả health/database OK. Docker monitoring bind đường dẫn trong `be/ops/`.
- OTel collector 4318 có cấu hình; chưa kiểm thử đường xuất trace end-to-end hoặc kho trace dài hạn.

Artifacts bị gitignore và cần chạy lại test để sinh trên máy clone. Các báo cáo bản 0.2 trước đây không được cộng vào số test V2 ở trên. Phần còn giới hạn/chưa triển khai nằm trong [V2-IMPLEMENTATION.md](V2-IMPLEMENTATION.md).
