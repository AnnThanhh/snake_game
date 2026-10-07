# Hướng dẫn thực hiện

Đọc instruction.md, update.md và updatev2.md; yêu cầu mới nhất của người dùng được ưu tiên.

PostgreSQL là nguồn cấu hình vận hành: permissions/roles/policies, whitelist, economy caps, nội dung và balance gameplay. Runtime không dùng tên role hoặc bảng quyền cố định để cấp quyền. Seed chỉ khởi tạo một lần; không ghi đè DB khi restart. Trận đấu chụp version nội dung lúc tạo phòng; không gọi DB trong tick. Redis là cache/queue/presence, không phải nguồn quyền chính. Client đọc danh mục công khai từ API. Giữ thuật toán/validation/protocol trong code, secrets trong môi trường.

Thay đổi dữ liệu quản trị cần permission, whitelist, MFA, audit, reason và idempotency. Quyền thay đổi phải vô hiệu cache và phiên đặc quyền. Migration không phá hủy dữ liệu; backup trước khi đổi DB thật. PostgreSQL và Redis chạy trên Docker với volume hiện có.

Làm việc bằng PowerShell; dùng npm.cmd. Kiểm tra và báo cáo trung thực tính năng, kiểm thử và giới hạn tải. Không tạo sub-agent trừ khi người dùng yêu cầu.

Bảo mật BE/FE: nội dung DB là dữ liệu không tin cậy khi render, cần escape; không đưa HTML/script vào copy UI. Report không tự tạo ban, context trận phải do authority xác minh. Tách lý do ban công khai và ghi chú nội bộ; phiên hạn chế chỉ xem thông báo/appeal của chính người dùng. Không tin IP/forwarded header từ client. Tài liệu kiểm thử và giới hạn hiện tại: `docs/SECURITY.md`.

Cấu trúc mới nhất: `be/` và `fe/` là hai dự án độc lập, mỗi bên có package.json, package-lock.json, node_modules, scripts, tests, build và cấu hình riêng. Không dùng npm workspace, symlink, import hoặc script truy cập mã nguồn dự án còn lại. Backend sở hữu API, game authority, worker, Prisma, migration, Docker, dữ liệu và monitoring; frontend sở hữu UI, Phaser, Vite, HTTP static/proxy và mã mô phỏng/codec của client. Hai bên chỉ giao tiếp HTTP/WebSocket qua hợp đồng có version. Không có shared/scripts/tests/node_modules hay orchestration ở root; root chỉ giữ tài liệu. Không đặt DB hoặc bí mật trong frontend. Khi thay protocol phải cập nhật và kiểm thử tương thích trên cả hai bản mã độc lập.
