import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ParameterBackup,showResult} from '../dist/maintenance.js';
import {encodeOverrides,crc32} from '../dist/config-wire.js';
import {DataClient,dataReply} from '../dist/data-client.js';
const catalog=JSON.parse(await readFile(new URL('../dist/settings-catalog.json',import.meta.url)));
const hex=b=>Buffer.from(b).toString('hex');
const frame=body=>`${body} ${crc32(new TextEncoder().encode(body)).toString(16).padStart(8,'0')}`;
function fixture({change=false,wrongTag=false,corrupt=false}={}){
  const commands=[];let reads=0,backup;
  const send=async wire=>{commands.push(wire);queueMicrotask(()=>{
    if(wire==='q'){client.onLine('IMU STOP');return;}
    if(wire.startsWith('@DATA1')){const id=wire.split(' ')[1];client.onLine(frame(`@DATA1 ${id} OK -`));return;}
    const id=wire.split(' ')[1],config=encodeOverrides(new Map(change&&++reads===2?[[2,30000]]:[]),catalog);
    if(corrupt)config[config.length-1]^=1;
    backup.onLine(frame(`@CFG1 ${id} ${wrongTag?'ffffffff':catalog.registry_tag} OK ${hex(config)}`));
  });};
  const client=new DataClient(send,{timeout:20,retries:1});backup=new ParameterBackup(client,send);
  return {backup,commands};
}
test('parameter backup reads both stores twice, validates CRC and never sends SET',async()=>{
  const {backup,commands}=fixture();const saved=await backup.read(catalog);
  assert.equal(saved.format,'mini-drone.parameters/1');assert.equal(saved.profile,null);
  assert.equal(saved.data_hex,'');assert.equal(saved.settings.length,catalog.settings.length);
  assert.equal(commands[0],'q');assert.equal(commands.length,5);
  assert.ok(commands.slice(1).every(c=>c.includes(' GET ')));assert.ok(!commands.some(c=>c.includes(' SET ')));
});
test('changing parameters, registry mismatch and bad snapshot CRC prevent backup',async()=>{
  for(const options of [{change:true},{wrongTag:true},{corrupt:true}]){
    const {backup}=fixture(options);await assert.rejects(backup.read(catalog));
  }
});
test('corrupt reply CRC is ignored and disconnect cancels pending backup',async()=>{
  const client=new DataClient(async()=>{});const backup=new ParameterBackup(client,async()=>{});
  const pending=backup.config(catalog.registry_tag);
  assert.equal(backup.onLine('@CFG1 00000001 00000000 OK 000000000000000000 00000000'),false);
  backup.disconnect();await assert.rejects(pending,/Connection lost/);
});
test('known and future error codes remain visible with diagnostic details',()=>{
  assert.match(showResult({code:'DRN-1019',stage:'save-backup',detail:'disk full'}),/DRN-1019.*save-backup/s);
  assert.match(showResult({code:'DRN-9999',stage:'future'}),/Unknown device error/);
  assert.match(showResult({code:'DRN-1023'}),/not confirmed/);
});
