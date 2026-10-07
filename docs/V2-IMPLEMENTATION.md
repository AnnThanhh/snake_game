# Trạng thái V2 — 04/10/2026

Đối chiếu `updatev2.md` (mục 223–399) và yêu cầu mới nhất về DB/cấu trúc độc lập. Bản chạy được sử dụng Colyseus, Phaser, Nest/Fastify, Prisma, BullMQ, PostgreSQL và Redis. Số đo chi tiết nằm trong [VALIDATION.md](VALIDATION.md).

Bổ sung 05/10: [SEO](SEO.md) đã có HTML từ nội dung DB, guides, metadata, sitemap/robots và nén HTTP; domain/indexing production còn chờ cấu hình thực tế. [Đo tải nhiều phòng](CAPACITY.md) đã thực hiện, chưa xác nhận mục tiêu mới 1.500/5.000 CCU.

## Cấu trúc đã hoàn tất

Bổ sung 07/10: log HTTP có request ID xuyên FE/gateway/API, log outbox/room, readiness, metrics HTTP và alert. Chi tiết kiểm thử và giới hạn vận hành tại [OPERATIONS](OPERATIONS.md); không có chứng nhận tải mới.

`be/` và `fe/` có package.json, package-lock.json, node_modules, scripts, tests, cấu hình và dist riêng. Không còn workspace, shared, scripts, tests, node_modules hoặc launcher ở root. Backend không đọc mã frontend; frontend không đọc mã backend. Hai bên trao đổi HTTP/WebSocket qua [hợp đồng V2](CONTRACT.md). Bản engine/codec ở mỗi bên được sở hữu độc lập.

Docker Compose, Prisma, migration, worker, monitoring, backup và outbox thuộc `be/`. Frontend sở hữu static/proxy server tại 5173; gateway backend tại 3000. AGENTS.md và phần quy tắc đầu instruction.md đã cập nhật cấu trúc này.

## Hệ thống đã triển khai

| Nhóm | Hành vi hiện có | Bằng chứng |
|---|---|---|
| Authority và netcode | Tick cố định 20 Hz, input có sequence/ACK, prediction/reconciliation, interpolation, AOI, path delta protocol 3, snapshot workers, reconnect giữ danh tính | Unit, SDK integration, browser, load |
| Khởi đầu trận | Ready và hồi sinh gửi snapshot đầy đủ qua cùng hàng đợi với welcome; client chỉ bắt đầu khi có world hợp lệ | Browser Co-op/Raid, lifecycle integration |
| Open Arena / Crown | Thế giới liên tục, bot utility, respawn, crown theo chiều dài, Apex bounty, chống lặp thưởng PvP | Engine + browser |
| Boss Raid | Hydra có giáp theo bộ phận, đầu nguyên tố, lõi, vòng sống sót và phản công bằng vòng vây | Engine kiểm tra đủ năm pha; browser vào phòng/Ready |
| Extraction | Di vật tạm, rủi ro mất loot khi chết, giữ E hoặc nút chạm trong cổng; trúng đòn mạnh ngắt tiến độ | Engine, browser mobile, SDK → queue → PostgreSQL |
| Build 2.0 | Cơ quan theo vị trí, keystone, curse có đánh đổi, mutation, nhánh thân, evolution/hybrid; bot tiêu điểm qua cùng validation | Engine/codec, UI lựa chọn |
| World | Director/timeline, meteor, đền và vùng chiếm, tổ quái, hộ tống, relic, thời tiết; biome nhận biến thể ngẫu nhiên theo seed lúc tạo phòng | Engine và snapshot/browser |
| Co-op | Hồi sinh đồng đội bằng vòng vây, cơ quan hồi phục, mutation hỗ trợ; không trả thưởng lặp do hồi sinh | Engine + lifecycle |
| Hiển thị | Phaser sprite pool/LOD, 4 mức chất lượng, Auto giảm/tăng có thời gian ổn định, độ phân giải theo preset DB | FE unit, browser desktop/mobile |
| Tài khoản | Hồ sơ, ví, loài, mastery, progression, mùa, leaderboard, lịch sử build/version, báo cáo người chơi | PostgreSQL integration + UI contract tests |
| Quản trị | Permission/role/override/whitelist, MFA, caps, MAX/reset/unlock/inventory/moderation, báo cáo, policy/catalog, audit và idempotency | DB/MFA integration + UI contract tests |
| Vận hành | Durable outbox, BullMQ worker, tài khoản PG riêng, metrics Prometheus/Grafana, OTel tùy chọn | Queue/restart tests, target Prometheus UP |

## PostgreSQL là nguồn vận hành

- Roles, permissions, ánh xạ, whitelist, policy, caps, danh mục và balance nằm trong DB. Runtime kiểm tra permission/deny/expiry, không cấp quyền dựa tên vai trò. Endpoint thiếu ánh xạ DB bị từ chối.
- Seed chỉ chạy theo migration marker. Kiểm thử restart xác nhận cap, tên loài, ánh xạ quyền đã sửa và các catalog version được giữ nguyên.
- Room chụp catalog lúc tạo; không truy vấn DB trong tick. Bản cũ vẫn được giữ để giải mã và tính thưởng đúng phiên bản. FE chỉ đọc danh mục công khai qua API.
- Mutation quản trị cần permission, whitelist, MFA, reason và UUID idempotency. Audit chứa trước/sau và không cho sửa/xóa qua tài khoản API/worker. Thay đổi quyền thu hồi cache và phiên đặc quyền; room kiểm tra lại admission định kỳ.
- Đã áp dụng migration cộng thêm đến `009_security`; catalog hiện tại trên máy: `overgrowth-v2-1-r1-r2-r3-r4`. Xem `SECURITY.md` cho UI DB, report/ban/appeal và kiểm thử bảo mật. 005 bổ sung tuning, 006 bổ sung tham số runtime và lưu build, 007 bổ sung biến thể biome/đồ họa Auto/lựa chọn tiến hóa của bot. Migration thêm khóa còn thiếu, giữ giá trị đã chỉnh; không reset DB hay volume.
- Backup trước thay đổi nằm tại `be/.data/backups/`, gồm `serpent-before-v2-config-20260926.dump` và `before-v2-world-20260926.dump`. Không có tài khoản admin mẫu được tự cấp.

## Phạm vi và giới hạn thực tế

Catalog vận hành vẫn giữ capacity Arena/Crown/Extraction 10, Co-op 4, Raid 8. Bài tải cho phép 30 thực thể người/bot để kiểm chứng kỹ thuật, không tự đổi giới hạn DB của người vận hành. Raid có thể khởi chạy ít hơn 4 người; 4–8 là khuyến nghị chơi.

Kết quả tải ngày 04/10: 12 người + 18 bot đạt mean 17,83 ms / p95 25,90 ms; 30 người đạt mean 12,84 ms / p95 20,57 ms, đều xấp xỉ 20 Hz. Đây là một phòng trên máy local trong thời gian ngắn. Chưa chứng minh 200–300 CCU, nhiều room/process đồng thời, WAN, soak nhiều giờ hoặc 60 FPS trên điện thoại thật. Các bài engine/codec cũ có chữ “prototype” kiểm tra tương thích lịch sử; không dùng chúng làm bằng chứng tải Colyseus V2.

Các mục tùy chọn hoặc mở rộng dài hạn trong GDD chưa được tuyên bố hoàn thành: disconnect AI tự bảo vệ, thư viện nội dung cho mọi mùa/ví dụ biome, ranked matchmaking riêng, cosmetic shop/season pass, chat trong trận và kho trace dài hạn. Mute hiện lưu trạng thái quản trị; chưa có kênh chat để áp dụng chặn tin nhắn. IP_ALLOWLIST đã có enforcement CIDR tùy policy DB (mặc định không bắt buộc); QA/debug production mặc định đóng, chưa có bộ lệnh debug toàn diện.

Snapshot phòng nằm trong RAM, không có khôi phục world sau crash hoặc chuyển phòng giữa trận. API account rate-limit theo user/IP được xác minh qua proxy HMAC; cần cấu hình trusted proxy đúng môi trường triển khai. Hai cờ feature lịch sử `organ_system_v2`/`branching_body_v2` không thay thế catalog: build mới điều khiển bằng `catalog.features` và danh mục mutation. OTel chỉ xuất log nếu bật exporter.

Các giới hạn trên được ghi rõ để không đồng nhất “bản V2 chơi được, đã kiểm thử” với “toàn bộ lộ trình live-service đã hoàn thành”.
