# UI nền tảng và quy tắc phát triển

## Lựa chọn: Bootstrap 5.3.8 + ES modules

Dùng Bootstrap cho button, form, nav/tab và card; giữ JavaScript native đang chạy với
Web Serial. Bootstrap có tài liệu rõ cho trạng thái component và hỗ trợ lấy riêng
các phần Sass cần thiết. Không cần chuyển toàn bộ ứng dụng sang React hoặc dùng CDN.

Đã đối chiếu Pico CSS và Bootstrap: Pico phù hợp form HTML gọn, nhưng Bootstrap có
quy ước nav/tab/card cụ thể hơn cho dashboard này. Khung log là component của dự án
vì Bootstrap không cung cấp terminal viewer. Component đó dùng cùng token và card.

Nguồn chính thức:
- [Bootstrap: Sass và import từng component](https://getbootstrap.com/docs/5.3/customize/sass/)
- [Bootstrap: Buttons và trạng thái](https://getbootstrap.com/docs/5.3/components/buttons/)
- [Bootstrap: Navs và tabs](https://getbootstrap.com/docs/5.3/components/navs-tabs/)
- [Pico: Forms](https://picocss.com/docs/forms)

## Các file cần dùng

| File | Vai trò |
| --- | --- |
| `ui/bootstrap.scss` | Chọn component framework và biến theme; không import toàn bộ Bootstrap |
| `scripts/build-ui.mjs` | Build CSS và sao chép license từ dependency đã pin |
| `dist/vendor/bootstrap.css` | CSS sinh ra, đã commit; trang tĩnh không cần npm ở runtime |
| `dist/style.css` | Token, bố cục, trạng thái và responsive của ứng dụng |
| `dist/ui.js` | Tab theo nhóm, icon SVG, log có giới hạn |
| `dist/flash-layout.js` | Danh mục vùng flash và capability theo API hiện có |
| `dist/flash-ui.js` | Explorer vùng flash và chuyển thao tác vào updater |
| `dist/maintenance.js` | State/API updater và backup; không chứa layout CSS |

Tổng `dist/` có budget **160 KiB** chưa nén. Budget cũ 96 KiB tăng để chứa bản Bootstrap
subset khoảng 33 KiB, component dùng chung và cây flash. Không có dependency runtime
qua mạng; không dùng icon font, ảnh trang trí hoặc Bootstrap JS bundle.

## Khung và trạng thái

- Container tối đa 1600px; padding 32px desktop, 20px tablet, 16px mobile.
- Khoảng cách chuẩn: 4, 8, 12, 16, 24px. Dùng token `--ui-space-*` trong component mới.
- Nội dung feature nằm trong `.page-panel`; heading trong `.page-heading`.
- Card dùng `.card > .card-header + .card-body`. Thanh thao tác dùng `.actions`.
- Form dùng `.form-label`, `.form-control`, `.form-select`, `.form-check-input`.
- Nút dùng `.btn.btn-primary` hoặc `.btn.btn-secondary`. Không thêm style `button:hover`
  toàn cục vì đã gây lỗi chữ trắng trên nền trắng khi tab được chọn.
- Tab chọn có nền xanh/chữ trắng ở cả normal, hover và focus. Tương phản chữ tối thiểu
  4.5:1. Không transition màu tab vì trạng thái chuyển tiếp cũng phải đọc được.
- Focus có outline; trạng thái không chỉ dựa vào màu. Nút disabled thực sự không thao tác.
- Vùng grid/flex phải có `min-width: 0`; vùng cuộn có `min-height: 0`. Không đặt chiều rộng
  cứng cho cả trang hoặc dùng `overflow-x: hidden` để che lỗi.
- Ở dưới 992px, monitor chuyển một cột. Dưới 768px, cây flash nằm trên nội dung.
  Đến 320px vẫn phải nhìn đủ tên tab, offset và control mà không tràn trang.

Ví dụ module mới:

```html
<section class="card">
  <div class="card-header"><h3>Device settings</h3></div>
  <div class="card-body">
    <div class="actions">
      <button class="btn btn-secondary icon-action" data-icon="download"
              title="Export settings" aria-label="Export settings"></button>
    </div>
  </div>
</section>
```

```js
import {hydrateIcons, bindTabs} from './ui.js';
hydrateIcons(featureRoot); // sau khi thêm markup động
const select = bindTabs(featureTablist); // một instance cho một tablist
```

`bindTabs` hỗ trợ click, Left/Right hoặc Up/Down theo orientation, Home/End, roving
focus và ARIA. Không query tất cả `[role="tab"]` của document để điều khiển một nhóm:
flash explorer là nhóm lồng trong tab Firmware và phải giữ selection độc lập.

## Log chuẩn

Dùng `new LogView(root)`; root có một `<pre class="log-output">`, tùy chọn
`[data-log-follow]`, `[data-log-wrap]`, `[data-log-count]`.

```js
import {LogView} from './ui.js';
const log = new LogView(document.querySelector('#deviceLog'));
log.append(deviceLine); // textContent, không parse HTML
log.text();             // export nội dung đang giữ
log.clear();
```

- Giới hạn 500 dòng và 2048 ký tự/dòng. Dòng bị cắt có nhãn `[truncated]`.
- Trên desktop, Serial log lấp phần chiều cao viewport còn lại; chỉ nội dung log cuộn.
  Trên mobile, khung khoảng 62dvh, tối thiểu 330px để toolbar và footer vẫn nhìn được.
- Mặc định không wrap để giữ cột. Nút Wrap bật `pre-wrap` + `overflow-wrap:anywhere`.
- Follow mặc định bật. Kéo lên đọc thì tắt follow; nút Follow đưa về cuối.
- Không gắn `aria-live` cho log 10 Hz. Status tóm tắt dùng `role="status"`; lỗi đầy đủ
  và chi tiết vẫn xem được trong output. Firmware output có khung riêng, giới hạn
  chiều cao theo viewport; không để stack trace kéo dài toàn trang.

## Nội dung và icon

Một heading ngắn + một dòng trạng thái là mặc định. Đưa hướng dẫn dài, câu lệnh CLI
và mô tả giao thức vào help đóng sẵn. Không giấu phạm vi ghi, xác nhận hoặc lỗi đang xảy ra.
Nút thao tác vùng flash/log ưu tiên icon; control theo chuỗi prepare/download/write
có icon và nhãn ngắn để không nhầm thứ tự. Mỗi icon-only có `aria-label`, `title`,
focus và target tối thiểu 38px. Dùng SVG nội bộ từ `ui.js`, không dùng emoji.

## Flash explorer

4 MB của firmware là **4 MiB = 0x400000 = 4,194,304 bytes**. Offset cuối trong bảng
là inclusive; thanh tổng thể ghi end-exclusive `0x400000`. Đây là dung lượng cấp
phát, không phải lượng image đã dùng. Bootloader hiển thị cả slot dành riêng đến table.

| Vùng | Offset | End inclusive | Dung lượng | Thao tác web |
| --- | --- | --- | --- | --- |
| Bootloader | `0x000000` | `0x007FFF` | 32 KiB | Mở luồng full release |
| Partition table | `0x008000` | `0x008FFF` | 4 KiB | Mở luồng full release |
| NVS | `0x009000` | `0x00DFFF` | 20 KiB | Tải backup NVS + OTA metadata sau Prepare |
| OTA metadata | `0x00E000` | `0x00FFFF` | 8 KiB | Tải cùng backup; không restore metadata cũ |
| Recovery / factory | `0x010000` | `0x0FFFFF` | 960 KiB | Mở luồng full release |
| Flight / ota_0 | `0x100000` | `0x3FFFFF` | 3 MiB | Mở luồng full release |

Nguồn offset: `partitions.csv` và `scripts/full_update.py` ở repo firmware. Khi firmware
đổi layout, cập nhật hợp đồng và test cùng lúc. Không nhận offset ghi tùy ý từ UI.

Chọn vùng chỉ chuyển panel, không đọc/ghi board. Backend hiện không có API backup image,
ghi một vùng riêng hoặc raw restore NVS. Các thao tác đó disabled, có lý do hiển thị.
Icon ghi của vùng app/system mở full release và hiển thị rõ bốn thành phần được ghi.

Luồng ghi: chọn ZIP + port → validate/backup → tải backup → xác nhận → ghi/readback.
Đổi file hoặc port hủy xác nhận và yêu cầu Prepare lại. NVS chứa Wi-Fi credentials;
nhắc giữ riêng tư ngay cạnh thao tác. Không chạy thao tác phần cứng trong UI tests.

## Kiểm tra

```sh
npm ci
npm run build:ui
npm test
npx playwright install chromium  # lần đầu
npm run test:ui
```

Có thể dùng Chromium đã cài: `UI_BROWSER_PATH=/path/to/chrome npm run test:ui`.
UI tests chạy static server riêng tại 8097 và giả lập updater, không chạm USB thật.
Kiểm tra 320/390/768/1440px, tương phản tab khi hover, tab lồng/keyboard, log dài,
follow/wrap, demo và trình tự backup/confirm/write. Review ảnh desktop/mobile trước
khi giao. Nếu chỉ có bằng chứng browser mock, không báo đã kiểm tra flash trên board.
