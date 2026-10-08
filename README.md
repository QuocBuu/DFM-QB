# Mini Drone Flight Deck

Web tĩnh kết nối trực tiếp firmware Flight ESP32-C3 bằng Web Serial. Không cần
sửa/nạp lại firmware, không cần backend hay cài package để chạy.

## Mở local

Từ thư mục gốc dự án:

```sh
make web
# Mở http://localhost:8080 trong Chrome hoặc Edge trên desktop.
```

Hoặc `npm start --prefix web`. Server chỉ bind loopback, không public file firmware,
`.secrets/` hay nội dung ngoài `web/dist`.

1. Đóng `make monitor`, serial terminal hay công cụ khác đang giữ cổng.
2. Cắm cáp USB của ESP32-C3. Nhấn **Kết nối USB / UART**, chọn Espressif USB JTAG
   (`/dev/ttyACM0`) hoặc USB-UART của bạn. Baud mặc định 115200, 8N1.
3. Web tự gửi `q` để đồng bộ, rồi `i` để đọc. Nút dừng gửi đúng `q`, không có newline.
4. Xoay board để xem mô hình. Dùng **Đặt mốc tư thế** để lấy tư thế hiện tại làm zero.
5. Có thể bù lệch gyro khi board đứng yên 3 giây. Bù lệch và cấu hình trục chỉ tồn tại
   trong phiên web, không ghi NVS hay điều khiển motor.

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
- `dist/drone.js`: mô hình Three.js, góc nhìn/zoom và hệ tọa độ.
- `dist/app.js`, `charts.js`: UI và đồ thị 30 giây; buffer/log giới hạn dung lượng.
- `dist/vendor/`: Three.js 0.186.1, MIT; bản local để chạy offline, không tải CDN.

```sh
npm test --prefix web
```

Tham khảo: [Web Serial chính thức của Chrome](https://developer.chrome.com/docs/capabilities/serial),
[W3C Motion Sensors](https://www.w3.org/TR/motion-sensors/).

## Bằng chứng kiểm tra

- 8 Node tests: parser/framing, scalar conversion, quaternion, yaw integration,
  restart/gap, trục lắp, gyro-bias validation và Web Serial lifecycle.
- Chromium: giao diện desktop 1440px và mobile 390px không tràn ngang, không có lỗi JS;
  kiểm tra demo, đặt mốc và các góc nhìn.
- Đọc board thật `/dev/ttyACM0` bằng cầu nối **chỉ trong bài test** vào browser:
  nhận 40 mẫu, roll khoảng 35.7°, pitch 13.4°, nhiệt độ 36.2°C;
  đã kiểm tra gửi i/q, dừng và trả lại cổng. Cầu nối không nằm trong ứng dụng phát hành.
- Hộp chọn thiết bị Web Serial native cần người dùng thao tác trên Chrome/Edge;
  chưa tự động hóa được bước chọn thiết bị đó. Web phát hành dùng `navigator.serial`
  trực tiếp, không dùng cầu nối hoặc daemon.
