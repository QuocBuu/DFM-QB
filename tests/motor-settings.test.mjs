import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MotorSettingsClient,motorLayout,splitLayout} from '../dist/motor-settings.js';
import {crc32,encodeOverrides,decodeOverrides} from '../dist/config-wire.js';
const catalog=JSON.parse(await readFile(new URL('../dist/settings-catalog.json',import.meta.url)));
const hex=b=>Buffer.from(b).toString('hex');
function fixture(options={}){
  let stored=encodeOverrides(new Map([[1,true],[2,35000],[3,false]]),catalog),client;
  const writes=[];let didSet=false;
  const send=async wire=>{
    writes.push(wire);const [,id,tag,op,payload]=wire.split(' ');
    if(op==='SET'){didSet=true;stored=Uint8Array.from(Buffer.from(payload,'hex'));}
    if(options.timeout&&op==='SET')return;
    queueMicrotask(()=>{
      const bytes=(options.mismatch&&op==='SET'||options.readbackMismatch&&didSet&&op==='GET')?encodeOverrides(new Map(),catalog):stored;
      const body=`@CFG1 ${id} ${options.wrongTag?'00000000':tag} OK ${hex(bytes)}`;
      client.onLine(`${body} ${crc32(new TextEncoder().encode(body)).toString(16).padStart(8,'0')}`);
    });
  };
  const stop=async()=>{writes.push('q');};
  client=new MotorSettingsClient(send,stop,{timeout:30});
  return {get client(){return client;},writes,get stored(){return stored;},change:()=>{stored=encodeOverrides(new Map([[2,45000]]),catalog);},reconnect:()=>{client.disconnect();client=new MotorSettingsClient(send,stop,{timeout:30});return client;}};
}
test('position and direction encoding stays explicit and rejects half-assigned motors',()=>{
  for(let v=0;v<=8;v++){const {position,direction}=splitLayout(v);assert.equal(motorLayout(position,direction),v);}
  for(const pair of [[1,0],[0,2],[5,1],[1,3],['1',1]])assert.throws(()=>motorLayout(...pair));
  for(const value of [-1,9,1.5,NaN])assert.throws(()=>splitLayout(value));
});
test('save preserves unrelated settings and only reports saved after ACK plus GET; reload after reconnect',async()=>{
  const f=fixture();assert.deepEqual(await f.client.load(catalog),[0,0,0,0]);
  assert.deepEqual(await f.client.save([5,2,3,8]),[5,2,3,8]);
  assert.equal(f.client.known,true);
  assert.deepEqual(decodeOverrides(f.stored,catalog),new Map([[1,true],[2,35000],[3,false],[4,5],[5,2],[6,3],[7,8]]));
  assert.match(f.writes.at(-2),/ SET /);assert.match(f.writes.at(-1),/ GET /);
  assert.deepEqual(await f.reconnect().load(catalog),[5,2,3,8]);
  await f.client.save([0,0,0,0]);assert.deepEqual([...decodeOverrides(f.stored,catalog).keys()],[1,2,3]);
});
test('duplicate corners, stale snapshot and old firmware cannot overwrite saved configuration',async()=>{
  const f=fixture();await f.client.load(catalog);
  await assert.rejects(f.client.save([1,5,0,0]),/unique/);
  assert.ok(!f.writes.some(w=>w.includes(' SET ')));
  f.change();await assert.rejects(f.client.save([1,2,3,4]),/changed/);assert.equal(f.client.known,false);
  assert.ok(!f.writes.some(w=>w.includes(' SET ')));
  const old=fixture({wrongTag:true});await assert.rejects(old.client.load(catalog),/version/);assert.equal(old.client.known,false);
});
test('lost or wrong save acknowledgement requires reload and never automatically retries SET',async()=>{
  for(const options of [{timeout:true},{mismatch:true},{readbackMismatch:true}]){
    const f=fixture(options);await f.client.load(catalog);
    await assert.rejects(f.client.save([5,2,3,8]));
    assert.equal(f.client.known,false);assert.equal(f.writes.filter(w=>w.includes(' SET ')).length,1);
    await assert.rejects(f.client.save([5,2,3,8]),/Reload/);
    options.readbackMismatch=false;
    assert.deepEqual(await f.client.load(catalog),[5,2,3,8]);
  }
});
test('disconnect rejects in-flight work without replay',async()=>{
  let sent=0;const client=new MotorSettingsClient(async()=>{sent++;},async()=>{}, {timeout:30});
  const pending=client.load(catalog);await Promise.resolve();client.disconnect();
  await assert.rejects(pending,/Disconnected/);assert.equal(client.known,false);assert.equal(sent,1);
});
