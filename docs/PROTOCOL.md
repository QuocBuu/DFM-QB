# Mini drone — hợp đồng CMD, settings và ghi dữ liệu

Revision tài liệu: 1, ngày 2026-10-09.

Bổ sung: nền cập nhật profile chẩn đoán Flight riêng đã có trong
[DATA_UPDATE.md](DATA_UPDATE.md). DATA1 không mở rộng quyền CFG1 và không triển khai
transaction draft/pagination tổng quát ở mục 7. Client DATA1 đã nối UI Save/reboot/verify; xem tài liệu bổ sung để biết schema FDT2. Tài liệu này nằm trong repo web để repo đó
có thể phát triển độc lập với firmware. Registry gốc nằm tại `config/registry.csv`
trong repo firmware; bản xuất tương ứng là `dist/settings-catalog.json`.

## 1. Trạng thái và nguyên tắc tương thích

| Phần | Trạng thái |
|---|---|
| USB/UART, phím `i`/`q`, dữ liệu IMU text | Firmware và web đã sử dụng |
| `@CFG1` GET/SET, snapshot DCF1 | Firmware và Python tool đã sử dụng |
| Metadata settings JSON + codec CFG1 JavaScript | Đã có, kiểm tra bằng cùng vector với Python; chưa có nút ghi trên web |
| Discovery, schema do thiết bị trả về, giao dịch chống ghi đè | Thiết kế ở mục 7; **chưa có trong firmware/web** |

Không đổi ý nghĩa của lệnh/key đã phát hành. Không tái sử dụng ID setting, kể cả
khi bỏ tính năng. Thay kiểu, đơn vị, ý nghĩa hoặc cách ghi cần ID mới hoặc major
protocol mới. Thêm setting cùng các kiểu đã hỗ trợ sẽ không cần thêm form riêng.
Một loại widget hoặc tính năng hoàn toàn mới vẫn có thể cần nâng cấp web.

Tách bốn phiên bản: firmware build; wire protocol; catalog/schema; storage format.
`CFG1`, `DCF1` và `mini-drone.settings/1` không phải cùng một version.
`registry_tag` hiện là CRC32 của **toàn bộ byte file registry.csv**, kể cả mô tả và
newline; không phải số version tăng dần, không phải mã xác thực. Không tự tính lại
bằng JSON hoặc chỉ bằng các ID. Tool và board phải có tag bằng nhau để ghi CFG1.

## 2. CMD hiện tại

USB Serial/JTAG hoặc UART adapter: 115200, 8 data bits, no parity, 1 stop bit,
không flow control. Không tự reset board khi mở cổng. USB/UART cùng một thiết bị:
chỉ một maintenance client được thao tác; không chạy web và terminal cùng lúc.

| CMD | Byte gửi | Phản hồi | Hiệu ứng |
|---|---|---|---|
| Bắt đầu IMU | `69` hex (`i`) | `IMU START ...`, rồi mẫu IMU | Bật stream, không ghi flash |
| Dừng IMU | `71` hex (`q`) | `IMU STOP` | Tắt stream, không ghi flash |
| Đọc settings | `@CFG1 ... GET - ...` + LF | `OK` snapshot hoặc `ERR` | Chỉ đọc |
| Thay settings | `@CFG1 ... SET <hex> ...` + LF | `OK` snapshot hoặc `ERR` | Thay toàn bộ editable overrides |

`i` và `q` là **đúng một byte, không Enter, không CR/LF**. Firmware chỉ nhận phím
này khi buffer dòng CLI đang rỗng. Không nhét `q` vào giữa một frame cấu hình.
Khi chuyển từ terminal có dòng dở sang machine client, gửi LF riêng để đồng bộ
parser, rồi mới gửi lệnh. Giao dịch cấu hình của Python dùng LF dẫn đầu cho việc này.
Web IMU hiện tại giả định buffer CLI sạch, gửi `q`, đợi 180 ms rồi gửi `i`; khoảng
đợi đó không phải ACK chắc chắn. Client ghi trong tương lai phải đợi ACK có hạn chót.

CLI cũ (`sys info`, `sys reboot`, `BOOT_MAIN`, `wifi config ...`) cần newline;
đó là giao diện bảo trì cho người, không phải API để web suy đoán phản hồi ghi.
Không dùng dòng `ESP_OK`, log hoặc timer làm bằng chứng đã lưu cấu hình.
Lệnh reboot, credential, OTA và calibration không được chạy như hệ quả ngầm của Save.

### IMU legacy

```text
IMU START ICM-20948 address=0x69 WHO_AM_I=0xea mag=AK09916 rate=10Hz; q stops
IMU n=1 a[g]=0.0000,0.0000,1.0000 g[dps]=0.000,0.000,0.000 T[C]=30.00 m[uT]=NA
IMU STOP
IMU ERROR init=ESP_FAIL; ...
```

`n` là uint32 đếm mẫu trong lần stream; `a` tính theo g, `g` theo °/s, `T` theo °C,
`m` theo µT hoặc NA. Thứ tự vector X/Y/Z theo trục chip; hướng lắp là phép biến đổi
riêng. Không đổi scale/đơn vị legacy. Chu kỳ danh định 100 ms; không có timestamp
thiết bị trong frame cũ. Web dùng `n`, không dùng thời điểm USB gom gói để suy ra dt.
Restart/wrap hoặc gap lớn reset bộ lọc. Mất mẫu 1,5 s: stale, giữ mẫu cuối.

Roll/pitch/yaw hiện do web tính; yaw tương đối. Không gắn nhãn góc này là quaternion
hay heading tuyệt đối do firmware đo. Log không đúng khuôn là log, không là command ACK.
Bộ chia dòng web giới hạn 2048 ký tự, bỏ dòng tràn đến LF kế tiếp.

## 3. Vùng settings và quyền ghi

| Vùng logic | Nơi giữ | Quyền của web/config import |
|---|---|---|
| Telemetry/status | RAM thiết bị | Chỉ đọc, không Save |
| View: camera, zero, đổi trục, gyro bias demo/bench | RAM phiên web | Chỉ ảnh hưởng hiển thị, không âm thầm ghi NVS |
| Editable settings | `nvs` → namespace `sys`, key `config_v1` | Chỉ whitelist registry, thay snapshot có kiểm tra |
| Calibration cảm biến/motor | Namespace/record bảo trì riêng | CFG1 không đọc, không ghi, không reset |
| Wi-Fi secrets, identity, MAC | Record bảo vệ/thiết bị | Không export/import qua settings |
| Boot metadata, partition, firmware | Ngoài config snapshot | Chỉ quy trình boot/OTA/provisioning hiện có |

Không cung cấp `write(address,data)`, `erase(namespace)`, `set arbitrary key` hay
`factory reset all` qua màn hình settings. Key/group của UI không phải địa chỉ flash.
`config-default` chỉ xóa editable overrides; không xóa mật khẩu hay calibration.

Layout hiện tại của firmware, ghi ở đây để phân định ranh giới, **không để web ghi**:

| Partition | Offset | Size | Chủ sở hữu |
|---|---|---|---|
| nvs | 0x9000 | 0x5000 | sys_storage; config chia sẻ NVS với các record bảo vệ |
| otadata | 0xE000 | 0x2000 | Boot/OTA |
| factory | 0x10000 | 0xF0000 | Recovery |
| ota_0 | 0x100000 | 0x300000 | Flight |

Không cấp offset cố định bên trong NVS cho từng setting. Không đổi partition để
thêm setting. Header/table/bootloader cũng nằm ngoài CMD settings.

### Registry hiện tại

| ID | Group / key | Kiểu | Default | Hợp lệ | Áp dụng |
|---|---|---|---|---|---|
| 1 | sys / PREFER_RECOVERY | bool | false | false, true | Boot kế tiếp |
| 2 | wifi / STA_TIMEOUT_MS | u32 | 20000 ms | 1000..120000 | Sau reboot |
| 3 | flight / ARMING_ENABLED | bool | false | **false duy nhất** | Phase 1 luôn khóa |

Phase 1 không có điều khiển bay. Không thêm PID/motor/calibration setting khi
firmware chưa thực thi và kiểm thử tính năng đó. `ARMING_ENABLED=false` không có
nghĩa là đổi giá trị này sẽ đủ điều kiện arm; gate phần cứng/runtime độc lập vẫn bắt buộc.
Registry C/Python hiện giới hạn 8 setting và yêu cầu ID liên tiếp; đó là giới hạn
legacy cần nâng cấp có kiểm thử, không phải cho phép renumber khi xóa key.

Mỗi descriptor JSON có `id`, `group`, `name`, `type`, `default`, `unit`,
`minimum`, `maximum`, `rule`, `description`, `storage`, `apply`, `access`.
`bool` là JSON boolean thật; `u32` là số nguyên 0..4294967295; không ép chuỗi/số
thực thành integer, không chấp nhận NaN/Infinity. Min/max bool dùng 0/1 để thể hiện
false-only. `storage=persistent`, `apply=reboot` và `access=read_write` mô tả ba
key hiện tại; đây không phải quyền bỏ qua validation/gate của thiết bị.

Web sinh widget từ type: bool → checkbox, u32 → input có min/max/đơn vị. Group/name
chỉ để trình bày. Text descriptor phải dùng textContent, không thực thi HTML/JS.
Type/rule chưa hiểu: chỉ đọc/không cho sửa; với CFG1 full replacement phải khóa
**toàn bộ Save** nếu không hiểu trọn catalog, tránh làm mất override không nhận biết.
File catalog đính kèm chỉ dùng khi tag khớp board; file tồn tại không chứng minh
board đã hỗ trợ discovery hay đã chấp nhận ghi.

## 4. CFG1: định dạng byte và phản hồi

ASCII lowercase hex, các trường cách đúng một space:

```text
@CFG1 <request:8hex> <registry:8hex> GET - <crc:8hex>\n
@CFG1 <request:8hex> <registry:8hex> SET <snapshot:hex> <crc:8hex>\n
@CFG1 <request:8hex> <registry:8hex> OK <snapshot:hex> <crc:8hex>\n
@CFG1 <request:8hex> <registry:8hex> ERR <esp_error:8hex> <crc:8hex>\n
```

CRC32/ISO-HDLC (polynomial reflected 0xEDB88320, init/xorout 0xFFFFFFFF), tương
thích zlib.crc32. Check vector ASCII `123456789` → `cbf43926`. CRC bao gồm byte từ
`@` đến cuối payload; **không** gồm space ngay trước CRC hay CR/LF. Kích thước tối
đa 192 byte gồm LF, không tính LF đồng bộ dẫn đầu. Gửi LF; bộ nhận web chấp nhận
CRLF nếu tổng dòng vẫn trong giới hạn. CRC chỉ phát hiện lỗi truyền, không xác thực.

Request ID uint32 do client tạo; không tái sử dụng trong giao dịch đang chờ. Mỗi
thời điểm một giao dịch. Retry giữ nguyên ID và toàn bộ payload; ID không phải
transaction lock hay sequence chống replay của firmware. Client chỉ nhận reply
khớp ID **và** registry; bỏ log, reply cũ, frame sai CRC. Registry mismatch khóa ghi,
không tự đổi tag rồi thử SET. `ERR` là mã ESP dạng hex big-endian hiển thị, không
phải JSON/string. Không ràng buộc UI vào nội dung tiếng Anh của lỗi.

DCF1 snapshot nhị phân, sau đó hex-encode vào frame:

| Byte | Nội dung |
|---|---|
| 0..3 | ASCII `DCF1` |
| 4 | Số override, uint8 |
| 5.. | Mỗi entry: ID uint8 + value uint32 **little-endian**, 5 byte |
| 4 byte cuối | CRC32 của toàn bộ byte trước đó, **little-endian** |

Entries tăng dần theo ID, không trùng. Bool encode 0/1; ID lạ, bool khác 0/1,
value ngoài range đều bị từ chối. Độ dài chính xác `9 + 5 * count`; snapshot hiện
3 key tối đa 24 byte. Snapshot rỗng là marker có CRC, không phải payload rỗng.
Key vắng mặt → dùng firmware default; key bằng default nhưng có mặt → override
explicit. DCF1 không mã hóa version catalog; frame registry tag đảm nhận phần đó.

Vector byte chuẩn nằm trong `tests/fixtures/config-wire.json`, sinh từ Python tool
cùng registry firmware. Codec JavaScript phải khớp chính xác vector này.

## 5. Quy trình ghi và hành vi màn hình settings

Trạng thái: disconnected → identifying → ready/read-only → editing → validating →
saving → verifying → saved hoặc error/unknown. UI chỉ hiện Saved sau GET/readback.

1. Xác định phiên bản/capability và catalog hợp lệ. Board cũ không discovery:
   chỉ cho ghi nếu ứng dụng có catalog CFG1 khớp tag, đã GET thành công. Web hiện
   chưa mở chức năng ghi này.
2. Dừng telemetry và đợi `IMU STOP` khi đang ở Flight; Recovery không có i/q hook.
   Không xen lệnh CLI/phím tắt giữa giao dịch. Đọc snapshot gốc, tạo draft độc lập.
3. Người dùng sửa draft; gõ phím, đổi tab, blur không ghi flash. Hiển thị khác biệt,
   đơn vị, default/override và yêu cầu reboot. Revert chỉ bỏ draft.
4. Save tạo **toàn bộ tập override**, gồm các override cũ không sửa. Validate tất cả
   trước khi gửi; không lấy các ô hiện thấy làm snapshot thiếu key. Import file là
   replace toàn bộ, không merge: key thiếu bị trả default.
5. Gửi SET một lần; timeout 2 giây, tối đa 3 lần tổng cộng cùng request. Firmware
   revalidate, giữ guard/safe-output check, publish blob, commit và readback. Không
   ghi từng key độc lập, không erase namespace. Snapshot giống hệt bỏ qua flash write.
6. ACK OK phải chứa đúng candidate; gửi GET ID mới và kiểm tra byte snapshot đúng
   candidate lần nữa. Chỉ khi đó báo Saved. Reboot là hành động riêng, không tự chạy.
7. Timeout, mất cáp, ERR lưu trữ hoặc ACK không khớp: trạng thái **chưa rõ kết quả**,
   không nói “chưa ghi gì”. Khóa Save tiếp, giữ draft, kết nối lại/GET để đối chiếu.
   Không tự rollback, không tự áp default, không phát lại write sau reconnect.
8. Restore defaults là snapshot rỗng với cùng validation/readback; ghi rõ phạm vi
   editable settings. Export không chứa secret/calibration. Giữ định dạng backup
   `drone.conf` INI hiện tại; JSON catalog không phải file backup.

CFG1 **không có optimistic concurrency/CAS**. Hai client hoặc UART+USB cùng sửa có
thể ghi đè nhau; GET-trước-SET không loại trừ race. Chỉ hỗ trợ một người ghi trên
bench cho legacy. Không quảng cáo transaction isolation mà firmware chưa cung cấp.

## 6. Ranh giới code để giảm thay đổi web

```text
Web Serial (serial.js) → framing + codec (protocol.js / config-wire.js)
                      → DeviceClient / SettingsModel (bổ sung khi triển khai discovery)
                      → widget chung theo descriptor → view
```

`app.js` hiện chỉ nhận event `imu.sample`, `imu.started`, `imu.stopped`, `imu.error`,
`device.recovery`, `log` và dùng hằng COMMAND. Không rải regex hay ký tự lệnh trong
component giao diện. `config-wire.js` chỉ encode/decode, **không tự gửi lệnh**;
caller tương lai phải thực hiện đúng state machine ở mục 5. `serial.send()` là
primitive nội bộ của transport, không được expose thành ô ghi bộ nhớ tùy ý.

Khi có DeviceClient: UI gọi `startImu`, `stopImu`, `getCatalog`, `getSettings`,
`validateDraft`, `saveDraft`, `discardDraft`; không dựng packet trực tiếp. ACK,
timeout, request ID, version negotiation và retry nằm ở client, không nằm trong
button handler. Không nhận secret vào serial log/export chung.

Thay schema: sửa registry firmware → generate C + web catalog/vector → test hai
bên → phát hành. Sau khi có discovery, thêm key bool/u32 chỉ sửa firmware registry;
web lấy descriptor mới từ thiết bị. Cache catalog theo device/schema fingerprint,
không theo baudrate hay tên cổng. Mỗi reconnect phải xác thực lại catalog.

## 7. Thiết kế discovery và giao dịch kế tiếp — chưa triển khai

Mục này là yêu cầu cho lần nâng cấp tiếp theo, **không được gửi các tên operation
này vào firmware hiện tại**. Không đổi/nhồi JSON vào `@CFG1`, không đổi i/q để làm
discovery. Wire envelope mới và mã version phải được triển khai, cung cấp golden
vectors và kiểm thử firmware/client cùng lúc trước khi công bố là supported.

### Discovery và schema-driven UI

- `hello`: trả device/session ID, firmware build, app Recovery/Flight, protocol
  major/minor, catalog version/fingerprint, danh sách capability, hạn mức frame,
  timeout và transaction capacity. Hello là read-only, không reset/ghi/arm.
- `settings.catalog`: có pagination bounded; mỗi trang gắn cùng fingerprint.
  Descriptor dùng cùng field mục 3, ID ổn định. Schema đổi giữa các trang → tải lại.
- `settings.get`: trả snapshot overrides + effective values/source default/override
  và revision. Trả cả pending-reboot trạng thái thay vì suy ra từ ACK.
- Firmware cũ không trả hello: timeout hữu hạn rồi dùng IMU legacy; settings read-only
  nếu không có catalog khớp. Major chưa hỗ trợ → không ghi. Unknown capability → bỏ qua.
- `telemetry` mới phải tự mô tả schema/topic, sequence, monotonic timestamp, đơn vị,
  coordinate frame, sensor validity và gap/drop. Tách event khỏi response. Web vẫn
  duy trì adapter legacy cho text IMU hiện tại; không thay âm thầm format i/q.

### Transaction chống ghi đè

Tên operation là API mục tiêu, chưa phải CLI:

| Operation | Đầu vào chính | Kết quả / tính chất |
|---|---|---|
| `settings.begin` | schema fingerprint, expected revision, write ID | txn ID, TTL; chỉ tạo draft RAM |
| `settings.put` | txn ID, key ID, typed value hoặc use-default | Validate/stage key, không ghi flash |
| `settings.validate` | txn ID | Kiểm tra toàn candidate, trả lỗi theo key; không commit |
| `settings.commit` | txn ID, write ID | Revalidate, CAS revision + publish atomically dưới cùng lock |
| `settings.abort` | txn ID | Bỏ draft RAM, không đổi NVS |
| `settings.get` | không | Đọc trạng thái đã commit, revision, last write ID |

Begin dựng draft từ snapshot đã đọc; use-default là thao tác riêng, không dùng
null/0/false để xóa mơ hồ. Không tự bỏ key lạ. Mỗi device chỉ một write transaction;
transaction gắn session, TTL công bố trong hello, quota hữu hạn. Mất kết nối/hết TTL
chỉ bỏ draft chưa commit. Commit kiểm tra lại schema, revision, arming, safe outputs,
OTA lock và storage health. Race check và publication nằm **trong cùng lock**.

`write ID` là định danh duy nhất của nội dung commit; cùng ID + khác nội dung bị từ
chối. Snapshot/revision/last-write-ID phải persist cùng một bản publish để retry
sau mất ACK/reboot không tạo commit kép. Không hứa dedupe chỉ bằng RAM cache.
Client không tự resend commit sau reconnect; GET đối chiếu write ID/revision/candidate,
đổi trạng thái unknown thành saved/conflict theo bằng chứng. Nếu ACK success đã
trả, flash/readback phải hoàn tất; ACK nhận request không được gọi là saved.

Lỗi máy đọc được cần phân biệt: unsupported protocol/operation, schema mismatch,
invalid type, out of range, protected key, conflict revision, busy, armed,
transaction expired, storage failure, outcome unknown. Message chỉ để hiển thị;
client điều khiển theo code. Reboot/calibration/credential/OTA dùng capability và
operation riêng, không đi xuyên `settings.put`. Không thêm motor-test/arming vào
settings để vượt gate.

Acceptance trước khi bật web Save mới: board thực sự quảng bá capability; hai client
cùng revision chỉ một commit thắng; lỗi validation không ghi; retry mất ACK/reboot
không commit kép; timeout không reset defaults; bảo toàn secrets/calibration;
readback sau reboot và bench power-cut có bằng chứng riêng. Host mock không thay
thế kiểm tra mất nguồn thật.

## 8. Kiểm tra và phát hành hai repo

Từ repo firmware:

```sh
python3 scripts/config_registry.py --generate
python3 scripts/web_contract.py --generate
make test
```

Từ repo web:

```sh
npm test
```

`make test` phát hiện catalog/vector xuất bị lệch registry. Repo web độc lập chỉ
cần Node: không cần Python, không import file ngoài repo. CI web kiểm tra wire
vectors, unsafe values, protected IDs, checksum, snapshot semantics và budget
64 KiB. Khi release firmware thay registry, cập nhật bản export ở repo web để hỗ
trợ legacy; discovery tương lai mới bỏ được bước phát hành web cho mỗi key mới.
