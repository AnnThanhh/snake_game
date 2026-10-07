# SEO và nội dung website — 05/10/2026

Trang chủ và ba trang hướng dẫn đã có HTML nội dung tiếng Việt ngay trong phản hồi HTTP. Các trang hướng dẫn không tải Phaser hoặc JavaScript gameplay. Nội dung, tiêu đề, mô tả, FAQ, domain canonical và trạng thái index nằm trong PostgreSQL, khóa `system_settings.site`; không lấy cấu hình SEO từ source FE.

## Đã triển khai

- `/`, `/huong-dan/`, `/che-do-choi/`, `/xay-dung-co-the/`: tiêu đề/mô tả riêng, liên kết HTML thật, nội dung hướng dẫn phù hợp các tính năng hiện có.
- Canonical, Open Graph, Twitter card, ảnh chia sẻ 1200 × 630, JSON-LD VideoGame/WebSite/WebPage/BreadcrumbList. Không thêm đánh giá hoặc điểm sao giả.
- `/robots.txt`, `/sitemap.xml` sinh từ cùng bản cấu hình DB. URL hướng dẫn thiếu dấu `/` cuối chuyển hướng 308; đường dẫn không tồn tại trả 404.
- `/admin.html` luôn `noindex, nofollow` và `no-store`. API/internal không xuất hiện trong sitemap. Robots không thay thế kiểm soát truy cập.
- Brotli/gzip, ETag, HEAD/304 và Vary cho nội dung tĩnh/HTML. Không nén lại các phản hồi proxy có trạng thái riêng của tài khoản.
- FE đọc `GET /api/site` hợp đồng version 1, gộp các yêu cầu đồng thời và cache 60 giây. Khi API lỗi, dùng bản thành công gần nhất tối đa 30 phút; sau đó trả 503 + Retry-After cho nội dung SEO, tránh trả trang rỗng thành công. Không có mã DB hoặc bí mật trong FE.

Migration `008_site` thêm cấu hình/schema một lần và giữ nguyên chỉnh sửa DB khi restart. Trước migration đã sao lưu tại `be/.data/backups/before-site-20261005.dump`. Chỉnh sửa qua `/admin/settings` dùng permission từ DB, whitelist, MFA, reason, UUID idempotency và audit như các settings khác.

## Bật index khi có domain

Hiện tại `site.origin=""` và `site.indexable=false`: bản localhost chưa được công khai để Google tìm kiếm. Chưa có tên miền hoặc quyền Search Console được cung cấp.

1. Triển khai FE với HTTPS trên domain chính và đặt `BACKEND_URL` tới gateway BE. Chỉ công khai các dịch vụ cần thiết; API nội bộ/DB/Redis vẫn thuộc BE.
2. Trong trang quản trị Settings, chọn `site`, giữ toàn bộ nội dung hiện có và đặt `origin` thành origin HTTPS thực tế, không có đường dẫn/query. Đặt `indexable=true`, nhập lý do và gửi lệnh. Không dùng domain ví dụ trong production. Metadata lấy domain DB, không tin header Host của yêu cầu.
3. Đợi tối đa 60 giây để cache FE cập nhật. Kiểm tra trang chủ, từng hướng dẫn, robots, sitemap, canonical và ảnh chia sẻ từ Internet. Vite dev server không cung cấp lớp SSR SEO; dùng `npm.cmd run build` + `npm.cmd start` của FE.
4. Xác minh domain trong Google Search Console. Có thể dùng DNS hoặc điền token HTML vào `site.googleVerification` qua cùng luồng quản trị. Gửi `/sitemap.xml`, dùng URL Inspection để kiểm tra khả năng crawl/index.
5. Theo dõi truy vấn, impressions, clicks và trải nghiệm thiết bị thật. Bổ sung nội dung hướng dẫn từ thay đổi gameplay thực tế, giữ hướng dẫn nhất quán với game; không nhồi từ khóa hoặc mua backlink.

Không có thao tác gửi Search Console tự động trong lượt này. Có SEO kỹ thuật không đồng nghĩa đã index hoặc đứng đầu Google; thứ hạng còn phụ thuộc nội dung, mức cạnh tranh, độ tin cậy và trải nghiệm thực tế. [Hướng dẫn SEO của Google](https://developers.google.com/search/docs/fundamentals/seo-starter-guide) giải thích các yếu tố này; [tài liệu JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics) hướng dẫn metadata, rendering và HTTP status; [hướng dẫn sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap) mô tả khai báo URL cho crawler.

## Xác minh

FE unit/integration kiểm tra HTML tĩnh, escape XSS/JSON-LD, domain, sitemap, noindex, gzip/Brotli, HEAD/ETag, 308 và 404. BE integration kiểm tra quyền sửa `site`, validation, audit, idempotency và đọc dữ liệu công khai từ DB.

`cd fe; npm.cmd run test:seo` chạy Chrome thật với JavaScript tắt, viewport mobile 390px, xác minh nội dung/links/ảnh và đo bytes HTTP. Kết quả `fe/artifacts/seo-validation.json`; ảnh `fe/artifacts/seo-guide-mobile.png`.

Bundle gameplay đo qua HTTP: **5.141.182 bytes → 814.297 bytes gzip / 740.325 bytes Brotli**, giảm khoảng **85,6%** với Brotli. Đây là số bytes truyền, không phải giảm tương ứng chi phí parse/execute JavaScript. Chưa có dữ liệu Core Web Vitals ngoài thực tế hoặc bằng chứng Google đã crawl/index. [Google cũng không xem điểm Core Web Vitals tốt là bảo đảm thứ hạng cao](https://developers.google.com/search/docs/appearance/page-experience).
