# Serpent Survivor

Game sinh tồn hành động trên trình duyệt, kết hợp cơ chế rắn ăn và lớn lên với tiến trình roguelite. Mỗi đốt thân có thể trở thành một phần của bộ kỹ năng: di chuyển, thu thập, nâng cấp, tạo combo và sống sót trong đấu trường.

Repo gồm **backend (`be/`) và frontend (`fe/`) độc lập**, giao tiếp qua HTTP/WebSocket có version. Mỗi bên có dependencies, cấu hình, build và kiểm thử riêng; không chạy npm tại thư mục gốc.

## Tổng quan

- Solo cục bộ và các chế độ online: Co-op, Open Arena, Crown, Boss Raid, Extraction.
- Hệ thống build với đốt thân, cơ quan, keystone, curse, mutation và tiến hóa.
- Backend quyết định trạng thái trận online; client có prediction, interpolation và reconnect.
- Tài khoản, tiến trình, ví, bảng xếp hạng và lịch sử trận lưu trong PostgreSQL. Phần thưởng online được xử lý từ kết quả authority qua queue; khách và Solo cục bộ không nhận thưởng tài khoản.
- Giao diện quản trị có phân quyền, whitelist, MFA, audit, quản lý nội dung và xử lý report/appeal.

Đây là bản đang phát triển. Phạm vi đã triển khai và phần còn thiếu được ghi trong [trạng thái V2](docs/V2-IMPLEMENTATION.md); tài liệu thiết kế không đồng nghĩa mọi tính năng đã hoàn tất.

## Công nghệ và cấu trúc

| Thành phần | Công nghệ / trách nhiệm |
|---|---|
| Frontend | TypeScript, Phaser, Vite; UI, render, input, mô phỏng/codec client và HTTP static/proxy server |
| API backend | NestJS, Fastify, Prisma; tài khoản, phân quyền, nội dung và dữ liệu lâu dài |
| Realtime | Colyseus; phòng chơi, simulation authority và đồng bộ trạng thái |
| Tác vụ nền | BullMQ, durable outbox và worker xử lý kết quả trận |
| Dữ liệu | PostgreSQL 18; Redis 8 cho cache, queue và presence |
| Vận hành | Docker Compose, Prometheus, Grafana và OpenTelemetry tùy chọn |

```text
.
├── README.md              # Hướng dẫn bắt đầu
├── AGENTS.md              # Quy tắc làm việc với repo
├── docs/                  # Thiết kế, kiến trúc, hợp đồng và báo cáo kiểm thử
├── be/
│   ├── backend/           # Domain, phân quyền, migration SQL và seed
│   ├── src/               # API, realtime server và worker
│   ├── game/              # Engine authority và codec backend
│   ├── server/            # Gateway HTTP/WebSocket và outbox
│   ├── prisma/            # Schema Prisma
│   ├── scripts/, tests/   # Công cụ và kiểm thử backend
│   ├── ops/               # Monitoring
│   └── compose.yaml       # PostgreSQL, Redis và monitoring
└── fe/
    ├── public/            # UI, tài nguyên và engine/codec client
    ├── src/client/        # Phaser, prediction và kết nối realtime
    └── scripts/, tests/   # Build, static/proxy server và kiểm thử frontend
```

Không dùng npm workspace, symlink hoặc import mã nguồn xuyên hai dự án. Xem [kiến trúc](docs/ARCHITECTURE.md) và [hợp đồng giao tiếp](docs/CONTRACT.md).

## Yêu cầu môi trường

- Node.js **22.12+ trong dòng 22 hoặc dòng 24**, theo `engines` của hai dự án.
- npm; các lệnh bên dưới dùng **PowerShell** và `npm.cmd`.
- Docker Desktop hoặc Docker Engine với Compose, đang chạy Linux containers để phục vụ PostgreSQL/Redis.
- Trình duyệt hỗ trợ WebGL; các bài browser test cần Chrome.

## Chạy trên máy local

Mở hai terminal PowerShell tại thư mục gốc repo.

### 1. Backend

```powershell
Set-Location be
npm.cmd ci
npm.cmd run setup
npm.cmd run infra:up
npm.cmd run build
npm.cmd start
```

`setup` tạo `be/.env` với thông tin xác thực ngẫu nhiên nếu chưa có và giữ nguyên file đã tồn tại. `infra:up` khởi động PostgreSQL/Redis bằng Compose. `start` áp dụng migration, chuẩn bị tài khoản DB hạn chế quyền rồi chạy worker, API, realtime và gateway.

**Nếu dùng DB có dữ liệu thật, sao lưu trước khi chạy phiên bản có migration mới.** Giữ nguyên `.env` và volume hiện có; hướng dẫn sao lưu nằm trong [README backend](be/README.md).

### 2. Frontend

Trong terminal thứ hai, bắt đầu từ thư mục gốc repo:

```powershell
Set-Location fe
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Mở **http://127.0.0.1:5173**. Backend cần hoạt động để cung cấp API cấu hình, tài khoản và chơi online.

Khi phát triển frontend, dùng `npm.cmd run dev` thay cho bước build/start. Vite dev và static server cùng dùng cổng 5173 mặc định, chỉ chạy một chế độ tại một thời điểm. Lớp render SEO từ API chạy trong static server, không chạy trong Vite dev.

### Địa chỉ mặc định

| Dịch vụ | Địa chỉ / cổng local |
|---|---|
| Giao diện | http://127.0.0.1:5173 |
| Trang quản trị | http://127.0.0.1:5173/admin.html |
| Gateway backend | http://127.0.0.1:3000 |
| Health gateway | http://127.0.0.1:3000/api/health |
| API nội bộ | `127.0.0.1:3001` |
| Colyseus nội bộ | `127.0.0.1:3002` |
| PostgreSQL / Redis | `127.0.0.1:54329` / `127.0.0.1:16379` |

Frontend gọi gateway qua proxy cùng origin. Có thể cấu hình `fe/.env` theo [file mẫu](fe/.env.example):

```dotenv
HOST=127.0.0.1
PORT=5173
BACKEND_URL=http://127.0.0.1:3000
```

Nếu frontend chạy trên máy khác, `BACKEND_URL` phải trỏ tới gateway mà máy frontend truy cập được. Trong `be/.env`, biến cùng tên `BACKEND_URL` lại chỉ API nội bộ (mặc định cổng 3001). **Không sao chép `be/.env` sang frontend hoặc commit secrets.**

Dừng ứng dụng bằng `Ctrl+C` ở mỗi terminal. Để dừng PostgreSQL/Redis và giữ dữ liệu, chạy `npm.cmd run infra:stop` trong `be/`. Không dùng `docker compose down -v` khi cần bảo toàn dữ liệu.

## Điều khiển

| Thao tác | Phím / điều khiển |
|---|---|
| Dẫn hướng | Chuột hoặc chạm; A/D để rẽ |
| Chỉnh tốc độ | W/S |
| Lướt / xung lực | Space / Q |
| Chọn nâng cấp | 1 / 2 / 3 |
| Lựa chọn build | B |
| Rút lui ở cổng Extraction | Giữ E hoặc nút Rút lui |
| Menu / telemetry | Esc / F3 |

Co-op và Raid cần Ready để bắt đầu. Open Arena và Crown cho phép vào thế giới đang chạy.

## Cấu hình vận hành và quản trị

PostgreSQL là nguồn chính cho permissions, roles, policies, whitelist, giới hạn kinh tế, nội dung và balance gameplay. Redis chỉ phục vụ cache/queue/presence. Seed khởi tạo theo version/marker, không ghi đè dữ liệu đã chỉnh khi restart. Mỗi phòng chụp version nội dung lúc tạo; simulation tick không truy vấn DB. Frontend đọc danh mục công khai qua API.

Để khởi tạo người quản trị local, đăng ký tài khoản qua giao diện, rồi chạy trong `be/`:

```powershell
npm.cmd run admin:bootstrap -- --username ten_tai_khoan --reason "Khởi tạo người vận hành cục bộ"
```

Sau đó mở `/admin.html` để thiết lập MFA. Quyền runtime được kiểm tra từ DB, không cấp theo tên role cố định. Thay đổi dữ liệu quản trị cần permission, whitelist, MFA, reason, audit và idempotency; thay đổi quyền phải vô hiệu cache và phiên đặc quyền.

Nội dung DB là dữ liệu không tin cậy khi render và cần escape. Report không tự tạo ban; context trận phải được authority xác minh. Chi tiết xem [bảo mật](docs/SECURITY.md).

## Kiểm thử

Chạy lệnh trong đúng dự án sau khi cài dependencies; các bài integration backend cần cấu hình `.env`, build và PostgreSQL/Redis sẵn sàng.

| Thư mục | Lệnh | Phạm vi |
|---|---|---|
| `be/` | `npm.cmd test` | Unit, engine, codec, HTTP và bảo mật |
| `be/` | `npm.cmd run test:backend` | Integration tài khoản và dữ liệu |
| `be/` | `npm.cmd run test:admin` | Phân quyền, MFA và thao tác quản trị |
| `be/` | `npm.cmd run test:queue` | Queue và worker |
| `be/` | `npm.cmd run test:authority` | Realtime authority và luồng kết quả trận |
| `fe/` | `npm.cmd test` | Client engine, codec và static/proxy server |
| `fe/` | `npm.cmd run test:browser:v2` | Gameplay trên Chrome, cần FE/BE đang chạy |
| `fe/` | `npm.cmd run test:browser:admin` | UI quản trị với API fixtures, không cần BE thật |
| `fe/` | `npm.cmd run test:security` | UI report/ban/appeal và XSS, cần FE/BE đang chạy |

Các test DB dùng schema riêng, không reset dữ liệu thật. `test:docker` chủ động restart container nên chỉ chạy khi không phục vụ người chơi. Khi đổi protocol, cập nhật và kiểm tra tương thích trên cả hai bản mã độc lập. Xem thêm [README backend](be/README.md), [README frontend](fe/README.md) và [báo cáo kiểm thử](docs/VALIDATION.md).

## Vận hành và giới hạn

Trong từng dự án, `npm.cmd run ops:logs` đọc log vận hành. Backend có `npm.cmd run infra:status` để xem container và `npm.cmd run monitoring:up` để khởi động monitoring; Prometheus tại cổng 9090, Grafana tại cổng 3030. Hướng dẫn request ID, readiness, metrics và HTTP probe nằm trong [OPERATIONS.md](docs/OPERATIONS.md).

Theo [báo cáo tải ngày 05/10/2026](docs/CAPACITY.md), mức hoàn thành lượt xác nhận 120 giây trên máy thử là **30 người trong 3 phòng** ở kịch bản normal và **10 người trong 1 phòng** ở cảnh nặng. Đây là kết quả local, không phải chứng nhận production; mục tiêu 1.500/5.000 CCU chưa được chứng minh. Có thể chạy lại bằng `npm.cmd run test:capacity` trong `be/` khi build, API và Redis đã sẵn sàng.

Chưa có khôi phục world sau crash, chuyển phòng giữa trận, chat trong trận hoặc kho trace dài hạn. Kiểm thử WAN, thiết bị thật và soak nhiều giờ vẫn còn giới hạn; xem các báo cáo thay vì suy luận năng lực từ số kết nối WebSocket.

## Tài liệu

| Tài liệu | Nội dung |
|---|---|
| [Hướng dẫn backend](be/README.md) / [frontend](fe/README.md) | Thiết lập, scripts và cấu hình từng dự án |
| [ARCHITECTURE](docs/ARCHITECTURE.md) / [CONTRACT](docs/CONTRACT.md) | Kiến trúc và hợp đồng HTTP/WebSocket |
| [V2-IMPLEMENTATION](docs/V2-IMPLEMENTATION.md) | Tính năng hiện có và phần chưa hoàn tất |
| [VALIDATION](docs/VALIDATION.md) / [CAPACITY](docs/CAPACITY.md) | Bằng chứng kiểm thử và giới hạn tải |
| [SECURITY](docs/SECURITY.md) / [OPERATIONS](docs/OPERATIONS.md) | Bảo mật, log, monitoring và giới hạn vận hành |
| [SEO](docs/SEO.md) | Nội dung công khai, metadata, sitemap và cấu hình domain/index |
| [instruction](docs/instruction.md), [update](docs/update.md), [updatev2](docs/updatev2.md) | Thiết kế gốc và các bản mở rộng |
| [AGENTS](AGENTS.md) | Quy tắc thay đổi repo; ưu tiên yêu cầu mới nhất của người dùng |
