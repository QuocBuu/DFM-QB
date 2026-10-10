import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from '../dist/config-wire.js';
import { DataClient, encodeProfile, decodeProfile, dataFrame, dataReply } from '../dist/data-client.js';
const profile={revision:1,writeId:'0100000000000000',address:0x69,turns:0,flipped:false,
  bias:[-1000,250,0],samples:30,std:10,gravity:10,savedAt:1791586800};
const hex=b=>Buffer.from(b).toString('hex');
function reply(id,bytes=new Uint8Array(),status='OK') {
  const s=`@DATA1 ${id} ${status} ${bytes.length?hex(bytes):'-'}`;
  return `${s} ${crc32(new TextEncoder().encode(s)).toString(16).padStart(8,'0')}`;
}
function device(options={}) {
  let stored=null,active=null,writes=0,setRequests=0,boot=10;
  const sent=[];
  const client=new DataClient(async wire=>{
    sent.push(wire);
    if(wire==='q'){if(!options.noStop)client.onLine('IMU STOP');return;}
    const [,id,op,payload]=wire.trim().split(' ');
    let bytes;
    if(op==='INFO')bytes=Uint8Array.from([2,52,1,0x69,0xea,0,0,0,boot,0,0,0]);
    if(op==='ACTIVE')bytes=active??new Uint8Array();
    if(op==='REBOOT'){if(!options.noReboot){boot++;active=stored;}bytes=stored;if(options.dropRebootAck)return;}
    if(op==='GET')bytes=options.badReadback&&stored?encodeProfile({...decodeProfile(stored),turns:1}):stored??new Uint8Array();
    if(op==='SET') {
      setRequests++;
      bytes=Uint8Array.from(Buffer.from(payload,'hex'));
      if(options.setError){client.onLine(reply(id,Uint8Array.from([0,0,0x71,1]),'ERR'));return;}
      if(!stored||hex(bytes)!==hex(stored)){writes++;stored=bytes;}
      if(options.dropAll || (options.dropAck&&setRequests===1))return;
    }
    client.onLine('unrelated ESP_OK');
    client.onLine(reply('ffffffff',bytes));
    client.onLine(reply(id,bytes));
  },{timeout:10,retries:3});
  return {client,sent,get stored(){return stored;},get writes(){return writes;}};
}

test('DATA1 rejects malformed payload/CRC and preserves signed fixed-point profile',()=>{
  const bytes=encodeProfile(profile);assert.equal(bytes.length,52);
  assert.deepEqual(decodeProfile(bytes),profile);
  const expected='46445432010000000100000000000000690000ea18fcfffffa000000000000001e0000000a0000000a000000';
  assert.equal(hex(bytes.subarray(0,44)),expected);
  const corrupt=bytes.slice();corrupt[20]^=1;assert.throws(()=>decodeProfile(corrupt));
  for(const patch of [{revision:0},{writeId:'0000000000000000'},{bias:[8000,8000,0]},
    {turns:4},{samples:29},{std:351},{gravity:151},{flipped:1},{bias:[NaN,0,0]}])assert.throws(()=>encodeProfile({...profile,...patch}));
  assert.equal(dataReply(reply('00000001',bytes)).bytes.length,52);
  assert.equal(dataReply(reply('00000001',bytes).replace(' OK ',' ERR ')),null);
  assert.equal(dataReply(reply('00000001',bytes)+'\n\n'),null);
  assert.equal(dataReply('x'.repeat(193)),null);
  assert.throws(()=>dataFrame(1,'SET',new Uint8Array()));
});

test('lost SET ACK retries identical frame/write ID then GET verifies; one durable write',async()=>{
  const d=device({dropAck:true});assert.equal(await d.client.load(),null);
  const saved=await d.client.save(profile);
  assert.equal(saved.revision,1);assert.equal(d.writes,1);assert.equal(d.client.known,true);
  const sets=d.sent.filter(x=>x.includes(' SET '));assert.equal(sets.length,2);assert.equal(sets[0],sets[1]);
  assert.ok(d.sent.indexOf('q')<d.sent.indexOf(sets[0]));
  assert.ok(d.sent.at(-1).includes(' GET '));
  assert.deepEqual(await d.client.load(),saved);
});

test('stop ACK required; lost all write ACKs leave unknown and require explicit reload',async()=>{
  const noStop=device({noStop:true});await noStop.client.load();
  await assert.rejects(noStop.client.save(profile),/ACK/);
  assert.equal(noStop.writes,0);assert.equal(noStop.sent.filter(x=>x==='q').length,3);
  const lost=device({dropAll:true});await lost.client.load();
  await assert.rejects(lost.client.save(profile),/ACK/);
  assert.equal(lost.client.known,false);assert.equal(lost.writes,1);
  assert.equal(lost.sent.filter(x=>x.includes(' SET ')).length,3);
  await assert.rejects(lost.client.save(profile),/Read board data/);
  assert.equal((await lost.client.load()).revision,1);
});

test('conflict and mismatched readback cannot become Saved or automatic overwrite',async()=>{
  for(const option of [{setError:true},{badReadback:true}]) {
    const d=device(option);await d.client.load();
    await assert.rejects(d.client.save(profile));assert.equal(d.client.known,false);
    assert.equal(d.sent.filter(x=>x.includes(' SET ')).length,1);
  }
});

test('disconnect cancels retries and concurrent operations cannot steal replies',async()=>{
  const d=device();await d.client.load();
  d.client.send=()=>{};
  const pending=d.client.save(profile);
  await assert.rejects(d.client.load(),/data transaction/);
  d.client.disconnect();await assert.rejects(pending,/Connection lost/);
  assert.equal(d.client.known,false);assert.equal(d.client.pending,null);
});

test('reboot success requires changed boot identity and active/stored bytes, not only ACK',async()=>{
  const d=device({dropRebootAck:true});await d.client.load();await d.client.save(profile);
  assert.equal(d.client.applied,false);await d.client.reboot();assert.equal(d.client.applied,true);
  assert.equal(d.sent.filter(x=>x.includes(' REBOOT ')).length,1);
  assert.equal(d.writes,1);
});

test('ACK without a reboot cannot be reported as applied',async()=>{
  const d=device({noReboot:true});await d.client.load();await d.client.save(profile);
  await assert.rejects(d.client.reboot(),/reboot is unconfirmed/);
  assert.equal(d.client.applied,false);assert.equal(d.client.known,false);
  assert.equal(d.sent.filter(x=>x.includes(' REBOOT ')).length,1);
});
