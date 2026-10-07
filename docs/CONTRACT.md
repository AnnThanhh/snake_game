# Hợp đồng HTTP/WebSocket V2

Ngày cập nhật: 04/10/2026. BE/FE phát hành độc lập. Protocol wire hiện tại là **3**, catalog có ID version riêng; không dùng import để chia sẻ hợp đồng. Client nhận catalog công khai qua API, room giữ nguyên phiên bản lúc tạo.

### Bổ sung vận hành — 07/10/2026

HTTP response có `X-Request-ID` UUID; FE production tạo mới, gateway/API giữ cùng ID. Đây là mã chẩn đoán, không cấp quyền và không thay requestId idempotency trong body. Lỗi domain thêm `requestId` trong JSON; lỗi parser có header tương ứng. Proxy có thể trả 504 trước headers khi vượt deadline, không tự retry mutation. Response gửi dở mà upstream đứt sẽ bị đóng để client nhận lỗi đọc.

`GET/HEAD /api/live` và `/api/ready` trả `{version:1,ok:boolean}`, HTTP 200/503, no-store. Live kiểm tra gateway; ready kiểm tra API/authority và PostgreSQL/Redis, không bảo đảm worker đang trả thưởng hoặc capacity. `/api/health` và wire snapshot 3 giữ nguyên; metrics không proxy công khai. Xem [OPERATIONS](OPERATIONS.md).

### Bảo mật ngày 06/10/2026

- `GET /api/configuration` → `{version:1,copy,adminTabs,moderation,limits,defaults}`. Không trả secret, trusted proxy config hoặc quyền cấp cho client. Danh mục là dữ liệu hiển thị.
- `POST /api/account/reports` nhận `{requestId,username,category,reason,evidenceUrl?}`; `GET /api/account/security` trả `{version:1,restrictions,notifications,reports,appeals}` của chính người dùng; `POST /api/account/notifications/:id/read` kiểm tra sở hữu.
- Login tài khoản bị ban, sau khi xác minh mật khẩu, trả 403 `{error,code:'ACCOUNT_BANNED',restriction}` và cookie phiên hạn chế. `restriction` có ID/scopeName/mode/reason/expiry/appealNotice, không có ghi chú nội bộ. `GET /api/account/me` trả `{profile:null,restricted:true,restriction}` cho phiên này. Chỉ security/appeals/logout/me được dùng; hết ban vẫn cần login lại.
- `POST /api/account/appeals` nhận `{requestId,actionId,reason}`. Chỉ quyết định đang hiệu lực của tài khoản; một yêu cầu mở trên một quyết định, quota từ DB.
- `GET /admin/reports`, `/admin/appeals`, `/admin/security-events` cần quyền đọc tương ứng và MFA. `POST /admin/reports/:id`, `/admin/appeals/:id` nhận `{status,resolution,reason,requestId}`; `reason` là ghi chú audit, `resolution` công khai. Không tự gỡ ban khi xử lý appeal. Lệnh ban hỗ trợ `publicReason` riêng.
- Realtime message `report`: `{type:'report',requestId,targetSessionId,category,reason,evidenceUrl?}`; authority bổ sung room/match/account, phản hồi `report_saved`. Message `security` chứa `code` và `restriction?` trước khi ngắt phiên. Không thay đổi wire snapshot protocol 3.
- Request input không được thêm trường quyền, vị trí, HP hay currency; sai schema lặp theo ngưỡng DB bị ngắt và ghi event. Sequence cũ bị bỏ qua. Lỗi 429 cho quota, 409 cho requestId xung đột.

## Ranh giới

FE phục vụ `dist/` tại 5173 và proxy `/api/`, `/admin/`, `/rt/` sang BE gateway 3000. `/internal/`, `/metrics`, `.env`, dữ liệu và mã backend không được phục vụ bởi FE. API tài khoản 3001 và authority 3002 chỉ bind loopback mặc định. Colyseus HTTP matchmaking và WebSocket đi dưới `/rt/`.

HTTP dùng JSON. Lỗi: 400 validation, 401 thiếu phiên/MFA, 403 thiếu quyền hoặc whitelist, 409 xung đột/idempotency, 429 rate limit, 502/503 upstream không sẵn sàng. Cookie tài khoản/MFA là HttpOnly; public mutations kiểm tra origin. Giá trị bigint tiền/mastery có thể là chuỗi JSON.

## API công khai

| Route | Hợp đồng |
|---|---|
| GET /api/site | `{version:1,site,updatedAt}`; chỉ nội dung website công khai từ `system_settings.site`, cache public 60 giây; FE kiểm tra version trước khi render |
| GET /api/v2 | `{enabled:true}` khi gateway được cấu hình V2 |
| GET /api/health | Transport, presence, room/người, target/measured tick, snapshot rate, capacity; tickRate=null khi không có room hoạt động |
| GET /api/rooms | Directory room ID/code/mode/state/capacity/population/bots/health |
| POST /api/presence | `{clientId,state:menu\|lobby\|game}`; presence không cấp quyền |
| GET /api/account/catalog?version=ID | `{catalog}`; bỏ version để đọc bản đang phát hành |
| POST /api/account/register | `{username,password,displayName}` → `{profile}` và cookie |
| POST /api/account/login | `{username,password}` → `{profile}` và cookie |
| POST /api/account/logout | Xóa phiên cookie/DB |
| GET /api/account/me | `{profile}` hoặc null cho khách |
| GET /api/account/access | Thông tin giao diện quyền truy cập; server vẫn xác minh độc lập |
| POST /api/account/ticket | `{species,mode}` → ticket một lần có hạn, gắn tài khoản/loài/chế độ |
| POST /api/account/unlock | `{species}`; trừ tiền atomic theo định nghĩa DB |
| POST /api/account/meta | `{upgrade,expectedLevel}`; stale level trả 409 |
| GET /api/account/history | `{rows}` của 30 life gần nhất, gồm mode/content_version, thưởng, build, organs/keystones/curses/mutations/evolutions/hybrids |
| GET /api/account/leaderboard | `{rows,seasonName}` theo mùa; không xếp bot/khách/tài khoản MAX loại khỏi ranked |
| POST /api/account/reports | `{username,reason,requestId}`; phiên tài khoản, permission từ DB, UUID chống gửi lặp |

Profile bao gồm ví, catalog loài, snakes, mastery, meta, achievements, inventory, progression_level và seasonProgress. Solo cục bộ không gửi thưởng lên server. API `/api/account/content` vẫn tồn tại cho tương thích; FE V2 dùng catalog.

## Colyseus room

Dùng SDK create, joinOrCreate, joinById hoặc reconnect. Loại room `v2`, filter theo mode. Options: `{mode,playerName,species,ticket?}`. Ticket quyết định danh tính; không nhận accountId do client khai. Khách chỉ thử chơi. Một tài khoản có tối đa một life online đang giữ chỗ. Origin được kiểm tra ở authority.

Các message đều có tên Colyseus `message`, payload có `type`:

| Chiều | Payload chính |
|---|---|
| C → S | `input`: angle/throttle hữu hạn, dash/pulse/interact boolean, seq tăng dần, viewRadius |
| C → S | `ready`: ready boolean; Co-op/Raid bắt đầu khi mọi thành viên kết nối đều Ready |
| C → S | `upgrade`: id thuộc lựa chọn hiện tại |
| C → S | `evolution`: kind=`organs\|keystones\|curses\|mutations`, choice, index cho cơ quan |
| C → S | `respawn`, `resync`, `ping` với at, `leave` |
| S → C | `welcome`: playerId, room, frame đầy đủ, ack, telemetry; adapter FE thêm token reconnect của SDK |
| S → C | `lobby`: room và danh sách thành viên ready/connected |
| S → C | `started`, `respawned`: frame đầy đủ trong cùng hàng đợi với welcome; client áp dụng frame trước khi bắt đầu chơi |
| S → C | `snapshot`: frame, ack input đã xử lý, telemetry |
| S → C | `pong`, `error` với message |

Input chỉ chứa ý định; server tính vị trí, sát thương, thời gian, lựa chọn và kết quả. Extraction dùng interact giữ liên tục. Reconnect giữ room/session trong thời hạn catalog; rắn tiếp tục trong mô phỏng và có thể bị thương. Hết hạn, leave chủ động hoặc thu hồi quyền sẽ giải phóng danh tính. Phòng đang chạy không được chuyển giữa process.

## Frame đường đi — v3

```text
{v:3, seq, k:'f'|'d', base?, m, c, t, a, z, director?, contentVersion?}
```

`c` chứa tuples/delta của players, segments, enemies, food, projectiles, effects. `t[playerId]` là `{f:[[x16,y16],...]}` hoặc `{a:[[x16,y16],...],n:retainedLength}`; đường đi mới nhất trước. Tọa độ path lượng tử 1/16 đơn vị, khoảng cách đốt theo protocol là 18. Segment tuple giữ ID/type/HP/thứ tự; vị trí thân dựng từ path. `a` chứa metadata life/build cùng nhánh `{id,parent,offset}`; `z` xóa player khỏi decoder. Director chứa thời tiết, biome/biến thể, mục tiêu và trạng thái boss/crown/portal.

Baseline đầy đủ khi join/reconnect/started/respawn/resync và định kỳ theo catalog. Mỗi viewer giữ state riêng. Delta sai base/seq bị từ chối; client giữ world hợp lệ cuối cùng và xin resync. ACK chỉ tăng sau tick xử lý input. Epoch/timestamp ngăn kết quả worker cũ ghi đè baseline mới. Snapshot được Colyseus đóng gói binary; JSON stringify ở adapter FE chỉ là giao diện nội bộ UI.

Snapshot mặc định gần/trung bình/xa 15/5/1 Hz, simulation 20 Hz. AOI giữ thân chính mình, danh tính/đầu người khác và các thực thể liên quan. Độ nhìn thay đổi theo catalog/weather/build. Backpressure vượt giới hạn DB sẽ ngắt transport để reconnect/resync. FE dự đoán đầu, phát lại input chưa ACK, làm mượt correction và nội suy snapshot; server luôn là authority.

Protocol 1/2 và transport `/ws` còn trong regression fixtures/engine cũ. Endpoint sản phẩm V2 là `/rt/`; không cam kết client cũ dùng `/ws` kết nối được với launcher V2.

## Persistence và quản trị

Các route nội bộ `/internal/catalog`, `/internal/admission`, `/internal/revalidate`, `/internal/tickets/consume`, `/internal/results` yêu cầu credential server. Ticket bị consume atomic trong Redis. Authority ghi outbox rồi gửi life result, API xếp BullMQ, worker ghi PostgreSQL trong transaction. LifeId + payload hash chống cộng thưởng hai lần; cùng ID khác payload trả 409. Kết quả lưu đúng catalog/season của trận. Extraction chỉ đổi di vật/DNA khi server xác nhận rút lui; Raid thắng dùng thưởng DB. Worker không có quyền cấp role, thay trạng thái tài khoản hoặc xóa audit.

GET `/admin/access` kiểm tra permission + whitelist đúng môi trường. POST `/admin/mfa/enroll` và `/admin/mfa/verify` thiết lập phiên MFA riêng. Các GET quản trị gồm players, definitions, reports, roles, whitelist, policy, catalog, settings, audit và yêu cầu permission tương ứng từ DB.

Mutation quản trị gồm `/admin/players/:id/{currency,max,reset,unlock,unlock-all,inventory,progression,ban,unban,mute,unmute,roles,overrides}`, `/admin/reports/:id`, `/admin/roles`, `/admin/permissions`, `/admin/role-permissions`, `/admin/whitelist`, `/admin/settings`, `/admin/policy`, `/admin/catalog`. Payload có reason và UUID requestId; retry cùng payload không ghi/cộng lặp. Xóa whitelist dùng DELETE. Catalog publish cần ID mới và schema hợp lệ; không ghi đè version cũ. Quyền thay đổi vô hiệu cache/phiên đặc quyền; DB là nguồn cuối cùng, không tin role hoặc flag từ client.
