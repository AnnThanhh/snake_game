# Đo tải và mục tiêu 1.500 / 5.000 người — 05/10/2026

**Chưa xác nhận ứng dụng chịu được 1.500 hoặc 5.000 người chơi đồng thời.** Trên máy hiện tại, mức cao nhất hoàn thành cả lượt đo và lượt xác nhận 120 giây là **30 người trong 3 phòng** ở kịch bản normal. Cảnh nặng hoàn thành **10 người trong 1 phòng**. Những mức cao hơn bị dừng do ngưỡng RAM dự phòng; đây là giới hạn của bài đo trên máy đang sử dụng, chưa phải giới hạn tuyệt đối của phần mềm hoặc CPU.

Tạm hiểu mục tiêu là CCU (người cùng online/chơi), chưa có xác nhận DAU hay thông tin máy chủ/domain production. DAU không bằng CCU: cần thêm thời lượng phiên và phân bố theo giờ để quy đổi. Không dùng số request/giây hoặc số WebSocket mở được để tuyên bố số người chơi phục vụ được.

## Máy và phương pháp

Intel Core i7-14700F, 28 luồng logic, RAM 15,79 GiB, Windows, Node 24.9.0. PostgreSQL 18, Redis 8 chạy Docker và giữ volume hiện có. Máy còn khoảng 1,58–2,36 GiB RAM trống khi bắt đầu các đợt đo; RAM khả dụng dao động trong quá trình chạy. Máy cũng chạy API/worker/monitoring/FE và bộ sinh tải. Không tắt ứng dụng khác của người dùng để lấy RAM.

`be/scripts/capacity-test.js` tăng số phòng và số authority process; mỗi client dùng Colyseus SDK/WebSocket thật, gửi input 20 lần/giây. Tick đo riêng trong khoảng measurement, không trộn sample nội bộ của ArenaRoom. Matchmaking dùng namespace Redis riêng, vẫn dùng cùng Redis Docker và đọc catalog/admission/revalidation từ API PostgreSQL thật. Mỗi phòng có một client áp dụng đầy đủ path frame; tất cả client decode envelope SDK, nhận snapshot và đo ACK. Đây không phải test renderer trên 30 thiết bị thật.

Catalog được clone trong RAM cho fixture, tắt bot và đặt capacity theo kịch bản; **không đổi capacity production trong DB**. Người chơi là khách và được giữ invulnerable để duy trì tải; không có thưởng ví hoặc tài khoản thật được tạo. Các authority test được dừng sau mỗi stage.

Normal bổ sung ít nhất 30 đốt/người, 200 quái, 400 food, 150 projectile mỗi phòng. Late bổ sung ít nhất 100 đốt/người, 500 quái, 800 food, 500 projectile. Các con số là mục tiêu bổ sung, không đóng băng engine: thực thể vẫn bị tiêu diệt/sinh ra, rắn tiếp tục tăng trưởng; số thực tế cuối lượt có trong JSON. Normal cuối lượt khoảng 110 đốt/người; late đạt 120 đốt/người.

Mỗi stage warm-up 5 giây, đo 45 giây; mức cao nhất đạt được xác nhận thêm 120 giây. Điều kiện đạt: tick ≥19 Hz, tick p95 <35 ms, snapshot ≥10 Hz cho mọi client, ACK p95 <300 ms, không mất kết nối/lỗi decode, event-loop p95 của generator ≤80 ms, RAM trống ≥768 MiB. Theo dõi RSS authority bao gồm worker threads, tách RSS generator; CPU theo process, không lấy riêng heap main thread làm tổng RAM.

## Kết quả giữ tải

| Kịch bản | Người / phòng / authority | Thời gian đo thực | Tick thấp nhất | Tick p95 xấu nhất | ACK p95 | Snapshot thấp nhất | RSS authority / generator | Dữ liệu WebSocket nhận |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Normal, cấu hình 10 người/phòng | 30 / 3 / 1 | 121,09 s | 19,99 Hz | 6,90 ms | 72,84 ms | 15,00 Hz | 1.201,63 / 189,42 MiB | 2,011 MiB/s tổng |
| Late, cấu hình 10 người/phòng | 10 / 1 / 1 | 121,00 s | 20,00 Hz | 10,68 ms | 78,27 ms | 14,99 Hz | 607,52 / 187,57 MiB | 1,295 MiB/s tổng |

Hai lượt trên không có disconnect hoặc lỗi SDK/decoder. Normal: CPU authority trung bình ~0,88 core; late: ~0,49 core. Không quy đổi trực tiếp CPU trung bình này thành capacity nhiều phòng vì event loop, snapshot workers, RAM và mạng có giới hạn khác nhau.

Các lần **không đạt/không hoàn tất**:

- Normal 40 người / 4 phòng / 1 authority: chạm RAM dự phòng; tick vẫn khoảng 19,99 Hz trước khi dừng.
- Normal 60 người / 6 phòng / 2 authority: chạm RAM dự phòng; không đạt toàn bộ thời gian yêu cầu.
- Late 20 người / 2 phòng: dừng sau khoảng 22,25 giây do RAM.
- Late 30 người / 1 phòng, tăng capacity chỉ trong fixture: dừng sớm do RAM; không xác nhận capacity 30 người/phòng từ lượt này. Capacity Arena đang chạy vẫn là 10.

Nguồn số liệu: `be/artifacts/capacity-normal-10.json`, `capacity-late-10.json`, `capacity-late-30.json`. File `capacity-invalid-draft.json` được đánh dấu invalid và **không dùng**: bản bộ đo đầu tiên trùng tên trường tick với lớp cha và chưa cách ly Redis matchmaking. Các kết quả hợp lệ bên trên được chạy lại sau sửa lỗi.

## HTTP qua frontend → gateway → API

`be/artifacts/capacity-http.json`: mỗi endpoint có 80 requests, concurrency 10, chạy qua `http://127.0.0.1:5173`.

| Endpoint | Kết quả | p95 |
|---|---|---:|
| GET /api/site | 80/80 HTTP 200 | 26,92 ms |
| GET /api/account/catalog | 80/80 HTTP 200 | 23,27 ms |
| POST /api/account/login với JSON không hợp lệ | 60 HTTP 400, 20 HTTP 429 | 10,63 ms |

Probe POST không đăng nhập thành công hoặc tạo account/session; nó kiểm tra validation/rate limit và tiêu thụ quota Redis của phút đó. Kết quả cho thấy policy hiện tại chặn sau 60 mutation/phút trên cùng bucket. API lấy IP từ socket; khi qua proxy nhiều người có thể chung bucket. Đây là điểm cần sửa trước rollout lớn, không phải lỗi PostgreSQL hoặc kết luận hệ thống chỉ chịu 60 người. GET công khai không dùng bucket mutation này.

## Khoảng cách tới mục tiêu

Với 10 người/phòng, 1.500 CCU tương đương 150 phòng đầy và 5.000 CCU tương đương 500 phòng đầy. Hiện chưa chạy đủ số phòng đó. Các việc cần làm/đo tiếp trước khi cam kết tải:

1. **RAM và snapshot workers:** mỗi phòng hiện tạo 2 worker riêng. RSS tăng đáng kể theo số phòng; cần profile, xem xét pool worker ở mức process với hàng đợi/baseline riêng theo phòng, rồi đo lại. Không dựa RAM trống của laptop để chốt cấu hình mua server.
2. **Routing nhiều authority:** launcher/gateway production hiện trỏ tới một REALTIME_URL. Các process trong bài đo được kết nối trực tiếp; chưa có chứng nhận định tuyến/discovery WebSocket xuyên nhiều máy, drain hoặc failover.
3. **Quota và presence:** thiết kế rate limit theo danh tính/IP với chuỗi proxy tin cậy; không tin X-Forwarded-For từ client. Giới hạn phải tiếp tục lấy từ DB. Presence V2 còn ngưỡng 1.000 entry cố định; cần đưa vào cấu hình DB và đo ở quy mô mục tiêu. Presence là số menu/lobby/game ước tính, không phải quyền tham gia hoặc capacity game.
4. **DB và queue thật:** bài tải dùng guest; chưa tạo tải đăng nhập thành công, ticket tài khoản, kiểm tra quyền hàng nghìn tài khoản, kết thúc trận đồng loạt hoặc ghi thưởng BullMQ đồng thời. Những luồng này đã có integration test chức năng nhưng chưa có capacity proof.
5. **Mạng và client:** cần load generator tách máy, TLS/proxy production, latency/loss/WAN, thiết bị desktop/mobile và soak test nhiều giờ, cùng thử restart/reconnect. Lượt 2 phút không chứng minh ổn định cả daily hours.

Ước lượng **chỉ bằng phép nhân băng thông của fixture**, chưa phải sizing/certification:

| Mục tiêu CCU | Phòng đầy ở capacity 10 | Egress theo normal | Egress theo late |
|---|---:|---:|---:|
| 1.500 | 150 | ~0,84 Gbit/s | ~1,63 Gbit/s |
| 5.000 | 500 | ~2,81 Gbit/s | ~5,43 Gbit/s |

Chưa gồm overhead WebSocket/TCP/TLS, retry, tải trang hoặc dự phòng; phân bố người chơi/AOI thực tế có thể làm số này thay đổi. CDN giúp tải tài nguyên FE, không thay thế băng thông snapshot động. Cần giảm payload/culling phù hợp và đo trên mạng triển khai thực tế.

## Chạy lại

Trong `be/`, sau khi build, Docker và API đã sẵn sàng:

```powershell
npm.cmd run test:capacity
```

```powershell
$env:CAPACITY_DENSITY='late'
$env:CAPACITY_ROOM_SIZE='10'
$env:CAPACITY_MAX_ROOMS='4'
$env:CAPACITY_MAX_NODES='1'
$env:CAPACITY_SECONDS='45'
npm.cmd run test:capacity
```

Giới hạn script: room size 10/30, tối đa 64 phòng/process, 8 process, stage 15–600 giây. Mức thử thực tế bị chặn bởi RAM và các quality gate; không tắt guard để ép mở hàng nghìn kết nối trên máy thiếu RAM. Dùng máy staging riêng đủ tài nguyên, cấu hình tăng dần, giữ API/DB đúng môi trường test. DB capacity production không bị đổi bởi các biến test.

```powershell
$env:CAPACITY_HTTP_URL='http://127.0.0.1:5173'
node scripts/http-capacity-test.js
# Tùy chọn kiểm tra quota mutation, chỉ chạy trong khoảng kiểm thử:
$env:CAPACITY_PROBE_MUTATIONS='1'
node scripts/http-capacity-test.js
```

Chưa biết máy chủ production và domain nên không thể chứng nhận mục tiêu hay chốt số máy/cấu hình triển khai từ đợt đo local này.
