# Flight DATA1 — nền cập nhật dữ liệu chẩn đoán

Trạng thái 2026-10-10: đã nối **IMU settings** vào web, nạp Flight lên ESP32-C3,
kiểm tra lưu/reboot/readback qua Web Serial native và kiểm tra CRC lỗi/mất ACK
trên board thật. Ngày lưu lấy từ đồng hồ máy tính, không phải RTC đáng tin của board.
Chưa thử cắt nguồn vật lý. Phase 1 vẫn khóa motor và chưa có bộ điều khiển bay.

## Sử dụng trên web

1. Kết nối USB/UART. Web tự đọc INFO, GET và ACTIVE để phân biệt thông số đã lưu
   với thông số đang dùng; firmware cũ chưa hỗ trợ sẽ không được bật nút Save.
2. Mở **IMU settings · Gyro & hướng lắp**, giữ board yên, chọn **Hiệu chỉnh lệch gyro**.
   Web lấy 30 mẫu liên tiếp, kiểm tra chuyển động, tính bias và thống kê chất lượng.
3. Kiểm tra hướng lắp. Các chỉnh sửa trước Save chỉ là draft trên web.
4. Chọn **Lưu & reboot**. Web dừng stream, lưu có retry/readback, yêu cầu reboot,
   rồi kiểm tra boot ID đã đổi và GET/ACTIVE bằng chính xác candidate đã lưu.
5. Chỉ khi đủ bằng chứng mới hiện **Đang áp dụng**. Nếu mất cáp/lỗi, kết nối lại và
   **Đọc lại / Bỏ chỉnh sửa**; bộ thông số lưu nhưng chưa áp dụng có nút **Reboot để áp dụng**.
6. Nút **info imu** hiển thị thông số và một mẫu đã bù trong Serial log. Có thể
   gõ `info imu` + Enter, `info data` hoặc `info help` trong terminal.

Lệnh `i` vẫn bắt đầu stream ngay. Console giữ tiền tố này để nhận tiếp `nfo imu`;
việc gõ `info imu` có thể phát IMU START trước khi lệnh hoàn tất. Lệnh hoàn tất sẽ
ngừng stream và in khối `[IMU settings]`. Ký tự q vẫn dừng ngay ở ranh giới lệnh.

Ví dụ kết quả kiểm tra thật:

```text
[IMU settings]
stored schema=FDT2 revision=2 saved_utc=2026-10-09T23:48:37Z ...
reboot_required=0
active schema=FDT2 revision=2 ... bias[dps]=-1.239,-0.080,-0.058 ...
IMU calibrated a[g]=... g[dps]=... T[C]=...
[/IMU settings]
```

## Phạm vi

`sys_data` trong Flight sở hữu i/q và stream IMU, cùng INFO/GET/SET DATA1.
`sys_imu` vẫn trả dữ liệu thô; stream legacy không tự trừ bias hoặc đổi trục để
tránh web bù hai lần. `sys_data_read_calibrated()` trừ bias và đổi trục theo profile nạp lúc boot;
`info imu` sử dụng API này. SET không đổi profile active giữa phiên. Profile là dữ liệu chẩn đoán đã tính trên host, **không phải
chứng nhận calibration đủ điều kiện bay**. Recovery không đăng ký handler DATA1.

Record FDT2 chứa ngày lưu, gyro bias và hướng lắp. Chưa có schema accelerometer sáu mặt,
magnetometer, motor/PID, secret hay key tùy ý. Việc mở rộng cần loại record/version
mới, validation và quy trình đo tương ứng; không đổi nghĩa các byte FDT1 đã phát hành.

## Phân vùng và công bố

Dùng partition `nvs` hiện có, offset 0x9000, size 0x5000. Namespace riêng
`flight_data`, key `profile_v1`; không sửa partition table, `sys/config_v1`, Wi-Fi
credentials hay các record calibration `imu/*` cũ. Không erase namespace/partition.

Mỗi snapshot lưu **cùng một blob**: schema, revision, write ID, thông số, CRC.
Validation trước khi mở NVS ghi; kiểm tra revision và publish nằm trong cùng
`sys_guard` lock với gate outputs safe. SET khi đang stream bị từ chối. Commit
thành công rồi đóng/mở lại handle, đọc lại đúng từng byte mới trả OK.

Không có record: GET/ACTIVE OK `-` (revision logic 0). Record lỗi CRC/schema hoặc NVS lỗi:
trả ERR, không coi như default, không tự sửa/xóa. Chưa cung cấp reset/repair profile.
ICM được khởi tạo và đọc mẫu thật khi INFO/SET; address trong record phải khớp cảm biến hiện tại.
WHO_AM_I xác nhận model, không phải serial number riêng của chip; thay chip cùng
model/address cần đo lại, firmware chưa tự phát hiện được việc thay đó.

## Framing

```text
@DATA1 <request-id:8hex> INFO - <crc32:8hex>\n
@DATA1 <request-id:8hex> GET - <crc32:8hex>\n
@DATA1 <request-id:8hex> ACTIVE - <crc32:8hex>\n
@DATA1 <request-id:8hex> REBOOT <write-id:16hex> <crc32:8hex>\n@DATA1 <request-id:8hex> SET <52-byte-record-as-104-hex> <crc32:8hex>\n
@DATA1 <request-id:8hex> OK <payload-hex-or-dash> <crc32:8hex>\n
@DATA1 <request-id:8hex> ERR <error-code:8hex> <crc32:8hex>\n
```

ASCII, lowercase hex, một space giữa các trường. CRC32 giống zlib/CFG1: reflected
0xEDB88320, init/xorout 0xFFFFFFFF, tính từ `@` đến cuối payload, không gồm space
trước CRC hay newline. Giới hạn frame 192 byte gồm LF. CRC lỗi/frame dở bị bỏ,
không ghi và không ACK. Client chỉ chấp nhận reply đúng request ID + CRC + schema.
CLI/log/ESP_OK không phải ACK. Nếu trước đó có dòng CLI dở, LF riêng để đồng bộ.

INFO payload 12 byte: `[schema=2, record-size=52, kind=1, i2c-address, 0xea, 0,0,0]`
rồi boot ID uint32 little-endian, được sinh lại mỗi boot. Client v1 sẽ từ chối schema 2.
ACTIVE trả bản profile đang áp dụng từ lúc boot. REBOOT chỉ nhận write ID đúng với
bản đang lưu, chỉ khi stream đã dừng; ACK rồi đợi 250 ms trước gọi guarded reboot.
Trong thời gian chờ reboot, DATA1 request tiếp bị từ chối busy. ACK REBOOT chỉ xác
nhận đã lên lịch, **không chứng minh reboot hoàn tất**. Không tự retry REBOOT.
Firmware đọc record legacy FDT1 48 byte, xuất FDT2 ngày 0 trong RAM, không tự ghi
NVS/migrate trên flash. Lần Save mới nâng revision và ghi FDT2 vào cùng key.
GET payload là record hoặc `-`. SET OK trả chính xác record đã commit và readback.
INFO chỉ probe/init cảm biến, không ghi flash. GET có thể chạy trong stream.
Ký tự `@` mở frame ngay cả lúc stream; `i`/`q` vẫn đúng một byte không newline.
Stream là trạng thái chung của board; client khác gửi q có thể dừng stream.

## Record FDT2, 52 byte

Các integer nhiều byte dùng little-endian, không gửi raw struct C.

| Offset | Size | Trường |
|---|---|---|
| 0 | 4 | ASCII FDT2 |
| 4 | 4 | Revision uint32, bắt đầu 1 |
| 8 | 8 | Write ID opaque nonzero, sinh ngẫu nhiên mỗi lần Save |
| 16 | 1 | ICM I²C address 0x68 hoặc 0x69 |
| 17 | 1 | Quarter turns quanh Z, 0..3 |
| 18 | 1 | Flipped, 0/1; xoay X 180° trước xoay Z |
| 19 | 1 | WHO_AM_I 0xea |
| 20 | 12 | Bias gyro X/Y/Z int32, milli-degrees/second, trục chip gốc |
| 32 | 4 | Số mẫu dùng tính bias, 30..1000 |
| 36 | 4 | Max standard deviation gyro ba trục, mdps, 0..350 |
| 40 | 4 | Max abs(norm(accel)-1g) của mẫu, milli-g, 0..150 |
| 44 | 4 | saved_at UTC Unix seconds uint32 từ host; SET yêu cầu ≥ 2020-01-01 |
| 48 | 4 | CRC32 byte 0..47 |

Mỗi bias trong ±8000 mdps và norm vector ≤8000 mdps. Bằng chứng thống kê do host
cung cấp; firmware kiểm tra kiểu/range/model, chưa tự kiểm chứng toàn bộ mẫu đo.
Không dùng profile này để khẳng định accelerometer/từ kế đã được hiệu chuẩn.
Hướng lắp theo quy ước web X trước/Y trái/Z lên, trừ bias trước khi đổi trục.
Zero pose camera không nằm trong record.

## Retry, revision và lỗi

- Candidate revision phải bằng current revision + 1; nếu absent dùng 1. UINT32_MAX
  chặn lần ghi kế tiếp; không wrap revision.
- Write ID trùng bản hiện tại + toàn bộ record giống nhau: retry hợp lệ, không
  set_blob lần nữa. Vẫn gọi commit vì lần trước có thể set_blob rồi commit lỗi.
- Write ID trùng nhưng nội dung khác: ERR 0x7102.
- Candidate revision cũ/nhảy: ERR 0x7101, phải GET/đối chiếu lại, không tự overwrite.
- Chỉ last write ID được giữ. Retry bản cũ sau khi đã có một commit mới bị conflict,
  không quay record về phiên bản cũ. Dedupe hoạt động qua reboot nhờ ID trong blob.
- Gói hoặc record CRC có tác dụng phát hiện lỗi, **không phải authentication**.
  USB/UART là giao diện bảo trì vật lý đáng tin theo mô hình dự án.

| Code | Nghĩa |
|---|---|
| 0x7101 | Revision conflict |
| 0x7102 | Write ID reuse với nội dung khác |
| 0x7103 | Profile/schema/CRC/sensor mismatch |
| 0x7104 | Phải dừng stream trước SET |
| ESP error khác | Sensor, storage, busy, argument hoặc readback failure |

Client `dist/data-client.js` thực hiện:

1. `load()` INFO (1 lần, 2 s), GET (tối đa 3 lần, 2 s/lần); xác nhận schema/model.
2. `save(draft)` tạo một record/write ID cố định cho cả giao dịch.
3. Gửi byte q và đợi IMU STOP; timeout retry q tối đa 3 lần. Không gửi SET nếu
   chưa có STOP. Phải độc quyền thao tác với IMU trong lúc Save.
4. SET timeout retry **cùng frame, request ID và record** tối đa 3 lần tổng cộng.
   ERR xác định không tự retry. Log, reply sai ID, CRC lỗi không giải phóng request.
5. SET OK phải bằng candidate; GET ID mới phải đọc lại đúng candidate. Chỉ lúc đó
   mới xác nhận đã lưu. UI tiếp tục gọi REBOOT, kiểm tra boot ID mới rồi GET và ACTIVE
   phải cùng bằng candidate trước khi báo đã áp dụng. GET có thể phát hiện writer khác vừa cập nhật.
6. Mất kết nối/lỗi/timeout: khóa Save tiếp đến khi `load()` thành công. Không tự
   gửi SET sau reconnect, không rollback và không báo dữ liệu cũ chắc chắn còn.

NVS có cơ chế phục hồi nội bộ nhưng module không tuyên bố chống mọi lỗi nguồn/flash.
Nếu commit trả lỗi, trạng thái là chưa rõ; explicit readback/reconnect để điều tra.
Ghi thành công phải được kiểm tra thêm bằng reboot/power-cut thật trên bench.

## Ranh giới triển khai

- Firmware: `src/common/sys_data/{sys_data,data_values,data_store}.*`.
- Console thêm hook line bounded, còn CLI/CFG1 và Recovery giữ hành vi cũ.
- Flight main khởi tạo module, không còn chứa parser/stream riêng.
- Client và `data-ui.js` đã nối UI; mở trang/kết nối chỉ đọc, chỉ nút Save mới ghi.
- `tests/test_data.py` chạy code C thật với NVS substitute: persist qua process,
  CRC lỗi, CAS, retry sau mất ACK/commit lỗi, streaming/busy/sensor guard và readback.
- `web/tests/data-client.test.mjs`: retry byte-identical, required stop ACK, wrong
  ID/CRC, readback mismatch, unknown outcome, disconnect, concurrent requests.

Chạy `make`, `make test`, `make validate`, `npm test --prefix web`. Tests host
không chứng minh độ bền điện/flash. Không auto-save theo mỗi mẫu IMU. Bằng chứng board chi tiết nằm tại
`docs/HARDWARE.md` trong repo firmware; record mới nhất là revision 2, hướng lắp
0°/không úp (giá trị mặc định, chưa có kiểm tra cơ khí từng trục).
