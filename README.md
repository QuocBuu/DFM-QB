# Mini Drone Flight Deck

Web tĩnh kết nối trực tiếp firmware Flight ESP32-C3 bằng Web Serial. Giám sát và xuất tham số hoạt động trực tiếp qua Web Serial. Full firmware update
cần backend USB/UART local trong repo firmware (`make web`).

## Hợp đồng CMD và settings

Xem [docs/PROTOCOL.md](docs/PROTOCOL.md) trước khi thêm lệnh hoặc chức năng ghi.
Tài liệu phân biệt giao thức đang chạy với discovery/transaction tương lai.

- `dist/protocol.js`: lệnh `i`/`q` và event thiết bị, tách khỏi UI.
- `dist/config-wire.js`: codec CFG1/DCF1; không tự mở cổng hoặc ghi dữ liệu.
- `dist/settings-catalog.json`: metadata sinh từ registry firmware, có fingerprint.
- `tests/fixtures/config-wire.json`: byte mẫu sinh bằng Python để kiểm tra JS tương thích.
- Web có **IMU settings** lưu gyro bias/hướng lắp qua DATA1; cấu hình chung CFG1 chưa có UI ghi.
  Zero pose chỉ thuộc phiên web; thay bias/trục là draft cho đến khi Save.

Khi cập nhật registry trong repo firmware, chạy `python3 scripts/web_contract.py --generate`
rồi đưa catalog/vector mới sang repo web. Không sửa bản JSON sinh tay.

## IMU settings: lưu và áp dụng

Mở **IMU settings**, đặt board yên và chọn **Hiệu chỉnh lệch gyro**, kiểm tra hướng
lắp rồi chọn **Lưu & reboot**. Web dùng CRC, retry, readback; sau reboot còn kiểm
tra boot ID thay đổi và thông số active trùng bản lưu trước khi báo **Đang áp dụng**.
Mục này hiển thị revision, ngày lưu theo đồng hồ máy tính và bias X/Y/Z.

Nút **info imu** mở kết quả trong Serial log. Từ terminal có thể gõ `info imu` + Enter,
`info data` hoặc `info help`; `i`/`q` vẫn dùng một ký tự không Enter.
Bảng cảm biến hiển thị dữ liệu thô; mô hình dùng bias/hướng lắp đang chọn trên web.
Lệnh `info imu` in thêm một mẫu đã bù theo thông số active trong firmware.

Xem [DATA_UPDATE.md](docs/DATA_UPDATE.md) để biết schema, vùng NVS, retry/reboot và lỗi.
Nếu mất kết nối khi lưu: kết nối lại, đọc lại để kiểm tra; không tự ghi lại hay reset.

## GitHub Pages — repo riêng cho web

Repo này lấy **nội dung `web/` làm thư mục gốc**, không đặt thêm một thư mục `web/`
bên trong repo GitHub. Workflow có sẵn tại `.github/workflows/pages.yml`.

1. Tạo repo GitHub trống, ví dụ `mini-drone-web` (không tạo sẵn README).
   Với GitHub Free, dùng repo public để bật Pages.
2. Đẩy source từ thư mục này (thay `YOUR_NAME` bằng tài khoản GitHub):

   ```sh
   cd /home/buu/Desktop/mini-drone/web
   git init
   git add .
   git commit -m "Simplify IMU dashboard and deploy with GitHub Pages"
   git branch -M main
   git remote add origin https://github.com/YOUR_NAME/mini-drone-web.git
   git push -u origin main
   ```

   Checkout hiện tại đã có Git, chưa có remote; `git init` có thể chạy lại an toàn.
   Nếu đã cấu hình `origin`, kiểm tra `git remote -v` và dùng URL của repo đó.
3. Trong repo GitHub, mở **Settings → Pages → Build and deployment → Source → GitHub Actions**.
4. Mở **Actions → Test and deploy web → Run workflow**, chọn `main`.
   Nếu lần push đầu thất bại vì chưa bật Pages, chạy lại sau bước 3.
5. Mở URL trong job `deploy`, thường là `https://YOUR_NAME.github.io/mini-drone-web/`.

Sau đó mỗi lần push `main`, workflow chạy tests rồi xuất bản `dist/`. Pull request
chỉ chạy tests. Không cần PAT, secret riêng, npm install, build hay máy tính chạy server
liên tục. Workflow dùng `GITHUB_TOKEN` do GitHub cấp. Nếu đổi tên nhánh, sửa cả
`branches` và điều kiện `github.ref` trong workflow.

Web được phục vụ bằng HTTPS; cắm drone vào **máy đang mở Chrome/Edge**, rồi chọn
cổng USB/UART trên trang. GitHub chỉ lưu trang tĩnh; dữ liệu serial được xử lý tại
trình duyệt. Mỗi phiên vẫn cần người dùng chọn cổng theo quyền của trình duyệt.

Tham khảo: [cấu hình GitHub Pages với Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Mở local

Từ thư mục gốc dự án:

```sh
make web
# Mở http://localhost:8080 trong Chrome hoặc Edge trên desktop.
```

Trong repo web riêng: chạy `npm start` (cần Python 3), rồi mở `http://localhost:8080`.
Trong dự án firmware dùng `make web` để có API cập nhật full; `npm start --prefix web`
chỉ chạy web tĩnh. Server chỉ bind loopback, không public file firmware,
`.secrets/` hay nội dung ngoài `web/dist`.

1. Đóng `make monitor`, serial terminal hay công cụ khác đang giữ cổng.
2. Cắm cáp USB của ESP32-C3. Nhấn **Kết nối USB / UART**, chọn Espressif USB JTAG
   (`/dev/ttyACM0`) hoặc USB-UART của bạn. Baud mặc định 115200, 8N1.
3. Web tự gửi `q` để đồng bộ, rồi `i` để đọc. Nút dừng gửi đúng `q`, không có newline.
4. Xoay board để xem mô hình. Dùng **Đặt mốc tư thế** để lấy tư thế hiện tại làm zero.
5. Có thể bù lệch gyro khi board đứng yên 3 giây; **Lưu & reboot** ghi profile NVS và
   kiểm tra áp dụng. Không có lệnh điều khiển motor.

UART qua adapter dùng GPIO20 RX / GPIO21 TX / GND của ESP32-C3. Trình duyệt nhận
adapter như một serial port; không thể nối chân UART trực tiếp vào máy không có adapter.
Chỉ một chương trình được mở cổng tại một thời điểm. Firefox/Safari không phải trình duyệt
được hỗ trợ cho Web Serial này. Truy cập qua `localhost` hoặc HTTPS, không mở file HTML trực tiếp.

## Tư thế và giới hạn

- Roll/pitch: bộ lọc quaternion kết hợp gyro với vector trọng lực từ accelerometer.
- Yaw: tích phân gyro tương đối, **không phải hướng Bắc**. Chưa dùng từ kế thô chưa hiệu chuẩn
  để kéo hướng về một giá trị tuyệt đối. Nút đặt mốc có thể dùng lại khi bị trôi.
- Quy ước mô hình: X hướng mũi, Y sang trái, Z hướng lên. Đổi góc lắp IMU và tùy chọn lắp úp
  nếu trục vật lý không khớp. Firmware chưa ghi nhận hướng lắp chính xác của board.
- Firmware hiện xuất 10 Hz, không có timestamp. Dùng số thứ tự `n` để tính bước thời gian,
  tránh sai khi USB gộp nhiều mẫu vào một gói. Gaps lớn hoặc restart sẽ reset bộ lọc.
- Mất mẫu quá 1.5 giây được thể hiện trên UI; mô hình giữ mẫu cuối, không tiếp tục tự quay.
- Đây là hiển thị tư thế chẩn đoán, không đo vị trí và không cung cấp dữ liệu điều khiển bay.
- **Xem mô phỏng** tạo dữ liệu thử có nhãn DEMO; không được trộn với dữ liệu board.

## Cấu trúc và kiểm tra

- `dist/telemetry.js`: parser, framing, quaternion filter, stationary bias validation.
- `dist/serial.js`: Web Serial, lifecycle và lệnh `i`/`q`.
- `dist/drone.js`: mô hình 3D vẽ bằng Canvas 2D, góc nhìn/zoom và hệ tọa độ.
- `dist/app.js`, `charts.js`: UI và đồ thị 30 giây; buffer/log giới hạn dung lượng.
- Không có thư viện 3D, font ngoài hoặc CDN. Tổng `dist/` có giới hạn 96 KiB trong CI sau khi thêm maintenance và catalog lỗi.
- Canvas chỉ vẽ khi tư thế/góc nhìn/kích thước thay đổi; đồ thị chỉ vẽ khi mở.
- `.github/workflows/pages.yml`: tests trên PR, tests + deploy khi push `main`.

```sh
npm test # chạy từ repo web; hoặc npm test --prefix web từ dự án firmware
```

Tham khảo: [Web Serial chính thức của Chrome](https://developer.chrome.com/docs/capabilities/serial),
[W3C Motion Sensors](https://www.w3.org/TR/motion-sensors/).

## Kiểm tra bản giao diện tối giản

- 21 Node tests đạt (gồm contract/codec/DATA1): protocol, quaternion/bias, serial lifecycle, giới hạn 64 KiB và
  đường dẫn asset dưới subpath GitHub Pages. Chạy `npm test` từ repo web.
- Tổng asset tĩnh dưới 64 KiB chưa nén, so với bản Three.js ban đầu ~2,17 MB.
  Codec cấu hình và catalog chưa dùng trên UI không được tải trong phiên đọc IMU.
- Chromium desktop 1360px / mobile 390px: không tràn ngang, không lỗi JS; demo,
  đặt mốc, ba góc nhìn, đồ thị và log đều hoạt động.
- Web Serial **giả lập trong bài kiểm tra trình duyệt**: mẫu nghiêng 30° được hiển thị
  đúng; bù gyro, dừng, đọc tiếp, ngắt kết nối; chỉ gửi các byte `i`/`q`, không newline.
  Các kiểm tra giả lập bổ sung cho bài kiểm tra board thật dưới đây.
- Workflow đã kiểm tra cú pháp YAML và cấu hình artifact `dist`; chưa chạy trên
  GitHub vì chưa cấu hình remote. Cần bật Pages và push theo hướng dẫn trên.

## Web Serial native / DATA1 ngày 2026-10-10

- Đã đo 30 mẫu, Save, reboot và xác nhận active qua USB thật `/dev/ttyACM0`.
- Đã thử gói SET đầu sai CRC, bỏ ACK lần SET hợp lệ tiếp: client gửi ba lần cùng
  request/write ID; revision chỉ tăng một lần (1 → 2), reboot/readback đạt.
- `info imu` báo stored=active revision 2, ngày lưu, `reboot_required=0` và dữ liệu đã bù.
- Đọc tiếp đạt ~10 Hz; stream được dừng và cổng trả lại sau test. Không mock serial,
  chỉ chèn lỗi truyền ở lớp client trong bài test retry. Chưa thử cắt nguồn vật lý.

## Bằng chứng kiểm tra bản trước khi tối giản giao diện

- 8 Node tests: parser/framing, scalar conversion, quaternion, yaw integration,
  restart/gap, trục lắp, gyro-bias validation và Web Serial lifecycle.
- Chromium: giao diện desktop 1440px và mobile 390px không tràn ngang, không có lỗi JS;
  kiểm tra demo, đặt mốc và các góc nhìn.
- Đọc board thật `/dev/ttyACM0` bằng cầu nối **chỉ trong bài test** vào browser:
  nhận 40 mẫu, roll khoảng 35.7°, pitch 13.4°, nhiệt độ 36.2°C;
  đã kiểm tra gửi i/q, dừng và trả lại cổng. Cầu nối không nằm trong ứng dụng phát hành.
- Đã kiểm tra tiếp bằng Web Serial native trên Chromium với board thật: 52 mẫu ở 10 Hz,
  mô hình cập nhật; dừng bằng q và ngắt kết nối đều thành công. Không mock API hay dùng cầu nối.
  Hồ sơ chi tiết nằm trong `docs/HARDWARE.md` của dự án firmware mini-drone (ngoài repo web).

### Linux báo “The device has been lost” ngay khi kết nối

Đóng terminal/Python đang dùng serial, rồi chạy trước khi bấm Kết nối:

```sh
stty -F /dev/ttyACM0 min 1 time 0
```

Công cụ Python có thể để lại `min=0 time=0` trên tty. Trên máy thử nghiệm này,
đổi về `min=1 time=0` khắc phục lỗi Chromium báo mất thiết bị lúc chưa có byte mới.
Không chạy công cụ serial khác đồng thời với web.

## Tabs, full update và backup (2026-10-10)

- **Monitor**: IMU/attitude; **Parameters**: đọc và tải CFG1 + profile IMU đã lưu;
  **Firmware**: backup NVS bắt buộc rồi update full; **Serial log**: log thiết bị.
- `make firmware-bundle` từ repo firmware xuất `firmware-full.zip` gồm bootloader,
  table, Recovery và Flight. `make web` phục vụ dashboard và updater cùng origin.
- Chọn ZIP + port → Prepare & back up → Download NVS backup → xác nhận → Install.
  Backend lưu backup vào `.secrets/backups/` trước mọi flash write, giữ nguyên NVS,
  và đối chiếu readback từng image. Không thực hiện flash từ trang hosting tĩnh.
- Có thể cập nhật không dùng web: `make update-full FILE=firmware-full.zip PORT=...`.
- **Enter Recovery** gửi `q` và `sys recovery`; command vẫn có trên Flight/Recovery.
- Bản export tham số không chứa credentials. Bản backup raw NVS có Wi-Fi credentials,
  cần giữ riêng tư. Tải file từ trình duyệt chưa đảm bảo người dùng đã lưu thành công;
  backend luôn giữ thêm bản fsync trên đĩa máy chạy updater.
- `errors.js` được sinh từ catalog firmware `config/errors.csv`; envelope mới là
  `drone.error/1`. Hiển thị mã + stage + nguyên nhân + bước xử lý. Không coi truyền
  xong file là update thành công; mất kết nối khi ghi là kết quả chưa xác nhận.

Hướng dẫn đầy đủ nằm tại `docs/FIRMWARE_UPDATE.md`, `docs/ERROR_CODES.md` và
`docs/ERROR_REPORTING.md` của repo firmware. Việc import/restore raw NVS tự động
chưa được triển khai; cập nhật bình thường giữ nguyên NVS nên không cần restore.
