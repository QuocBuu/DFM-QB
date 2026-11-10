import test from 'node:test';
import assert from 'node:assert/strict';
import {flashRegions, FLASH_SIZE, hexOffset} from '../dist/flash-layout.js';
test('flash regions cover the complete 4 MiB contract without overlap or gaps',()=>{
  let next=0;const names=new Set();
  for(const region of flashRegions){assert.equal(region.offset,next);assert.ok(region.size>0);assert.ok(!names.has(region.id));names.add(region.id);next+=region.size;}
  assert.equal(next,FLASH_SIZE);assert.equal(hexOffset(next-1),'0x3FFFFF');
  assert.deepEqual(flashRegions.map(r=>[r.partition,r.offset,r.size]),[
    ['bootloader',0,0x8000],['partitions',0x8000,0x1000],['nvs',0x9000,0x5000],['otadata',0xe000,0x2000],['factory',0x10000,0xf0000],['ota_0',0x100000,0x300000]
  ]);
});
test('data regions cannot offer writes and image regions cannot claim a backup API',()=>{
  assert.deepEqual(flashRegions.filter(r=>r.backup).map(r=>r.id),['nvs','otadata']);
  assert.deepEqual(flashRegions.filter(r=>r.write).map(r=>r.id),['bootloader','partitions','recovery','flight']);
});
