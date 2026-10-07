# Rà soát bảo mật BE/FE — 06/10/2026

Phạm vi: mã ứng dụng, dependencies npm, HTTP/WebSocket, quyền quản trị và giao diện. Không quét Windows hoặc các chương trình chạy trên máy người chơi. Đây là đợt rà soát và kiểm thử nội bộ, không phải chứng nhận pentest độc lập hay cam kết không còn lỗ hổng.

## Thay đổi đã triển khai

Bổ sung 07/10: HTTP log dùng danh sách trường cho phép, bỏ body/header/query/secrets; request ID chỉ chẩn đoán. Proxy có deadline và hủy luồng upstream dở dang. Xem kiểm thử/giới hạn tại [OPERATIONS](OPERATIONS.md). Số audit 0 bên dưới là lịch sử, chưa được xác nhận lại trong đợt mới.

- PostgreSQL lưu chính sách bảo mật/kiểm duyệt, danh mục report, giới hạn tài khoản, báo cáo, thông báo, yêu cầu xem xét và sự kiện giao thức. `009_security` bổ sung bảng/cột, không reset dữ liệu. Backup trước migration: `be/.data/backups/before-security-20261005.dump`, 210.333 bytes; đã đọc được danh mục archive bằng pg_restore. Volume Docker được giữ nguyên.
- Report có category, lý do, URL bằng chứng HTTPS tùy chọn, quota/cooldown từ DB, UUID idempotency và kiểm tra sở hữu. Report trong trận lấy người gửi, người bị báo cáo, room/match ID từ authority, không tin account ID do client khai. Khách có thể bị report khi có context phòng đã xác thực; người gửi phải đăng nhập. Backend không tải nội dung URL bằng chứng.
- Ban có lý do công khai riêng với ghi chú kiểm duyệt nội bộ, phạm vi và hạn hết hiệu lực. Login đúng mật khẩu khi bị ban cấp phiên hạn chế chỉ để đọc trạng thái của mình, thông báo và gửi yêu cầu xem xét. Phiên này không lấy ticket, ví/lịch sử hoặc quyền quản trị. Gỡ ban thu hồi phiên hạn chế; đăng nhập lại để tiếp tục.
- Quản trị có danh sách report, appeals và security events. Xử lý report/appeal cần permission trong DB, whitelist, MFA, reason, audit và UUID chống lặp. Kết quả được gửi vào thông báo của người liên quan. Xử lý appeal không tự gỡ ban; lệnh gỡ ban là thao tác có quyền riêng. Báo cáo không tự động dẫn đến ban.
- Gói tin realtime được kiểm tra loại/trường/giá trị; thêm x/y/HP/gold vào input bị từ chối. Vi phạm lặp hoặc flood bị ngắt phòng và ghi sự kiện. Sequence cũ chỉ bị bỏ qua, không bị coi là bằng chứng gian lận. Không tự ban vĩnh viễn từ telemetry. Khi V2 hoạt động, gateway đóng đường WebSocket prototype `/ws`.
- Sửa SSRF qua request URL dạng absolute hoặc `//host`: proxy chỉ nhận origin-form, kiểm tra origin upstream cho `/rt`, HTTP và WS. Xóa các header danh tính/secret/forwarded do client gửi. FE ghi IP socket thực; gateway chỉ nhận IP từ proxy nằm trong cấu hình tin cậy và ký danh tính gửi API bằng HMAC gắn method/path/thời gian. API rate limit theo user hoặc IP đã xác thực.
- `IP_ALLOWLIST` thực thi IPv4/IPv6/CIDR nếu `policy.security.ipAllowlistRequired=true`. Mặc định giữ false để không tự khóa quản trị đang dùng. Trước khi bật phải thêm whitelist IP hiện tại. Runtime không cấp quyền bằng tên role.
- Escape tên loài, nội dung UI, thông báo, lý do và dữ liệu hiển thị; giới hạn màu SVG/CSS. Thêm CSP, chống nhúng iframe, nosniff và Permissions-Policy. CSP cho inline style để giữ renderer/UI hiện tại, không cho inline script hoặc eval. Kiểm tra schema từ chối prototype keys, ID/màu catalog sai và giới hạn cấu hình nguy hiểm.

## Dữ liệu hardcode đã chuyển

| Dữ liệu | Nguồn runtime |
|---|---|
| 436 chuỗi UI tĩnh, nội dung menu/form/help | `system_settings.ui` → `GET /api/configuration` |
| Tab quản trị | `system_settings.admin_tabs`; chỉ điều khiển hiển thị, không cấp quyền |
| Categories/statuses/scopes và nội dung hướng dẫn kiểm duyệt | `authorization_policy.moderation` |
| Username/password/display limits, quota report/appeal, history/notification limits | `authorization_policy.security` |
| Presence capacity/TTL/rate, server ID, tên mặc định, mode leaderboard | `system_settings.operations` |
| Chế độ mặc định, thời lượng Solo, nhịp refresh UI, ngưỡng vi phạm | Catalog version `overgrowth-v2-1-r1-r2-r3-r4` |
| Species/segments/upgrades/rarities/traits | Catalog API; đã bỏ bảng mặc định trong module content/builds runtime |

Snapshot room giữ catalog riêng; đọc cấu hình quyền/operations ngoài simulation tick. Operations/proxy settings được refresh định kỳ khoảng 30 giây; FE lấy cấu hình khi tải trang, HTTP cache ngắn. Seed chỉ chạy theo marker. Fixture game cũ nằm riêng trong tests của từng dự án. Đã sửa các fallback làm giá trị DB bằng 0 bị bỏ qua và dùng balance DB cho prediction haste/turn của client.

Không đồng nhất đợt này với việc đã xóa mọi literal: các đoạn câu có số động trong renderer, một số thông báo validation BE và hằng fallback của engine prototype vẫn còn trong mã. Hợp đồng giao thức, thuật toán, mã thao tác, giới hạn an toàn kỹ thuật, route và secrets môi trường tiếp tục thuộc code/environment. Nội dung vận hành mới phải theo DB; phần copy/fallback lịch sử cần được rà soát tiếp nếu yêu cầu toàn bộ text đều có thể biên tập qua quản trị.

## Bằng chứng kiểm thử

| Kiểm tra | Kết quả |
|---|---:|
| BE unit/codec/HTTP/gameplay/security | 68/68 |
| BE admin integration | 11/11 |
| BE account integration | 7/7 |
| BE queue/worker integration | 6/6 |
| BE authority integration | 1 suite đạt; SDK thật, report context, spoofed input, kick/event, flood, rewards và thu hồi quyền |
| FE unit/static/proxy/SEO | 34/34 |
| Chrome V2 gameplay | 13 kiểm tra |
| Chrome admin/account UI fixtures | 10 kiểm tra |
| Chrome SEO | 6 kiểm tra |
| Chrome security UI fixtures | 4 kiểm tra, không có uncaught page error |
| npm audit BE / FE | 0 advisory đã biết ở lần quét 05/10, không đổi lockfile sau lần quét |

Node test tính cả suite cha trong số đếm integration. Test DB dùng schema và Redis namespace riêng. Browser security dùng HTTP fixtures để chèn payload vào catalog/copy/reason, xác nhận không sinh thẻ img/script và không chạy handler; quyền thực tế được kiểm tra bằng BE integration, không dựa vào UI fixtures.

Artifacts: `be/artifacts/dependency-audit.json`, `fe/artifacts/dependency-audit.json`, hai file `artifacts/security-source-scan.json`, `fe/artifacts/security-browser-results.json`, `fe/artifacts/security-center.png`. Rà mẫu mã nguồn: 62 file BE và 30 file FE. Các hit `eval` BE là Redis Lua với script cố định; process calls nằm trong build/start/load harness đã xem xét. Không phát hiện private-key/credential pattern trong phạm vi tìm kiếm. Pattern scan không chứng minh nguồn/dependency không có mã độc hoặc backdoor.

## Giới hạn còn lại

- Browser không thể kiểm kê phần mềm trên máy người chơi. Chưa có detector aim-bot/bot farm hoặc phân tích hành vi thống kê dài hạn. Không suy ra gian lận chỉ từ lag, mất gói hay report.
- Chưa có antivirus cho upload vì ứng dụng chỉ nhận URL bằng chứng, không nhận file thực thi/upload file. URL không được backend mở tự động.
- Security event gửi từ authority là best effort; lỗi API ghi log tại authority, chưa có durable security-event outbox/alert SOC. Kết quả trận vẫn dùng durable outbox hiện có.
- Chưa kiểm chứng DDoS ngoài Internet, giới hạn tạo phòng trên cụm lớn, WAF/TLS production hay tất cả tình huống supply-chain. CSP hiện cho inline CSS; chưa dùng Trusted Types.
- Chat trong trận chưa triển khai; mute vẫn là dữ liệu kiểm duyệt, không được mô tả như một kênh chat đã hoạt động.
- Presence cap trong DB là 10.000 mục để bỏ trần 1.000 cũ, không chứng nhận 10.000 CCU. Mục tiêu 1.500/5.000 CCU chưa được chứng minh; xem [CAPACITY](CAPACITY.md).

Nguyên tắc escape theo ngữ cảnh và CSP nhiều lớp tham khảo [OWASP XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html), [OWASP CSP](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html). Origin, xác thực phiên, giới hạn thông điệp và logging WebSocket tham khảo [OWASP WebSocket Security](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/WebSocket_Security_Cheat_Sheet.md).
