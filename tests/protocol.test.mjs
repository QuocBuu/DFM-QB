import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { COMMAND, parseDeviceLine } from '../dist/protocol.js';
import { crc32, encodeConfigRequest, parseConfigReply, encodeOverrides, decodeOverrides } from '../dist/config-wire.js';
const catalog = JSON.parse(await readFile(new URL('../dist/settings-catalog.json', import.meta.url)));
const fixtures = JSON.parse(await readFile(new URL('./fixtures/config-wire.json', import.meta.url)));
const hex = bytes => Buffer.from(bytes).toString('hex');

test('diagnostic command bytes and typed events isolate firmware text from UI', () => {
  assert.deepEqual(COMMAND, { imuStart: 'i', imuStop: 'q' });
  assert.deepEqual(parseDeviceLine('IMU START ICM-20948 address=0x69 WHO_AM_I=0xea'), {type:'imu.started',address:'0x69'});
  assert.equal(parseDeviceLine('IMU n=1 a[g]=0,0,1 g[dps]=0,0,0 T[C]=30 m[uT]=NA').type,'imu.sample');
  assert.equal(parseDeviceLine('IMU STOP').type,'imu.stopped');
  assert.equal(parseDeviceLine('IMU STOPPED?').type,'log');
  assert.equal(parseDeviceLine('IMU ERROR init=ESP_FAIL').type,'imu.error');
  assert.equal(parseDeviceLine('Running=factory Boot=ota_0').type,'device.recovery');
  assert.equal(parseDeviceLine('<script>log</script>').type,'log');
});

test('JS codecs match Python firmware-tool golden frames and snapshot byte order', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);
  assert.equal(catalog.registry_tag, fixtures.registry_tag);
  for(const v of fixtures.vectors) {
    const overrides = new Map(v.overrides), bytes = encodeOverrides(overrides,catalog);
    assert.equal(hex(bytes),v.snapshot_hex);
    assert.deepEqual(decodeOverrides(bytes,catalog),overrides);
    assert.equal(encodeConfigRequest(v.id,catalog.registry_tag,'GET'),v.get);
    assert.equal(encodeConfigRequest(v.id,catalog.registry_tag,'SET',bytes),v.set);
    const reply = parseConfigReply(v.ok);
    assert.equal(reply.id,v.id); assert.equal(reply.tag,catalog.registry_tag);
    assert.equal(reply.status,'OK');assert.equal(hex(reply.payload),v.snapshot_hex);
  }
  assert.equal(parseConfigReply(fixtures.error).error,0x102);
});

test('default absence stays distinct from explicit default, and protected/unsafe values are denied', () => {
  assert.notEqual(hex(encodeOverrides(new Map(),catalog)),hex(encodeOverrides(new Map([[1,false]]),catalog)));
  for(const pair of [[1,1],[2,'30000'],[2,999],[2,120001],[2,NaN],[2,1.5],[3,true],[99,0],['1',false]]) {
    assert.throws(()=>encodeOverrides(new Map([pair]),catalog));
  }
  const unknown=structuredClone(catalog); unknown.settings[0].type='float';
  assert.throws(()=>encodeOverrides(new Map(),unknown));
  const future=structuredClone(catalog);future.format='mini-drone.settings/2';
  assert.throws(()=>decodeOverrides(encodeOverrides(new Map(),catalog),future));
});

test('bad framing, CRC, lengths and semantic corruption cannot become configuration ACKs', () => {
  const good=fixtures.vectors[2];
  for(const line of ['ESP_OK',good.get,good.ok+'\n',good.ok.slice(0,-5),good.ok.replace(' OK ',' ERR '),'x'.repeat(193)]) {
    assert.equal(parseConfigReply(line),null);
  }
  assert.throws(()=>encodeConfigRequest(1,catalog.registry_tag,'ERASE'));
  assert.throws(()=>encodeConfigRequest(1,catalog.registry_tag,'GET',new Uint8Array(9)));
  assert.throws(()=>encodeConfigRequest(1,catalog.registry_tag,'SET',new Uint8Array(100)));
  const original=Uint8Array.from(Buffer.from(good.snapshot_hex,'hex'));
  const badCrc=original.slice();badCrc[6]^=1;assert.throws(()=>decodeOverrides(badCrc,catalog));
  for(const mutate of [b=>b[10]=1,b=>b[5]=99,b=>b[6]=2,b=>b[16]=1]) {
    const b=original.slice();mutate(b);
    new DataView(b.buffer).setUint32(b.length-4,crc32(b.subarray(0,-4)),true);
    assert.throws(()=>decodeOverrides(b,catalog));
  }
});
