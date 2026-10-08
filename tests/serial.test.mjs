import test from 'node:test';
import assert from 'node:assert/strict';
import {SerialLink} from '../dist/serial.js';
test('serial uses 115200 8N1, decodes fragmented lines, sends bare i/q and closes unlocked',async()=>{
 const sent=[],lines=[];let input,closed=false,options;
 const port={readable:new ReadableStream({start(c){input=c;}}),writable:new WritableStream({write(value){sent.push(new TextDecoder().decode(value));}}),async open(o){options=o;},getInfo(){return{usbVendorId:0x303a};},async close(){assert.equal(this.readable.locked,false);assert.equal(this.writable.locked,false);closed=true;}};
 Object.defineProperty(globalThis,'navigator',{value:{serial:{async requestPort(){return port;}}},configurable:true});globalThis.isSecureContext=true;
 const link=new SerialLink(x=>lines.push(x),()=>assert.fail('unexpected close'));
 await link.connect();assert.equal(options.baudRate,115200);assert.equal(options.parity,'none');
 input.enqueue(new TextEncoder().encode('IMU ST'));input.enqueue(new TextEncoder().encode('ART\r\n'));
 await link.send('i');await new Promise(r=>setTimeout(r,0));assert.deepEqual(lines,['IMU START']);
 await link.disconnect();assert.deepEqual(sent,['i','q']);assert.equal(closed,true);assert.equal(link.port,null);
});
test('unexpected unplug releases reader and reports disconnect',async()=>{
 let input,reported;const port={readable:new ReadableStream({start(c){input=c;}}),writable:new WritableStream(),async open(){},getInfo(){return{};},async close(){assert.equal(this.readable.locked,false);}};
 Object.defineProperty(globalThis,'navigator',{value:{serial:{async requestPort(){return port;}}},configurable:true});
 const link=new SerialLink(()=>{},message=>reported=message);await link.connect();input.error(new Error('Device removed'));await link.readTask;
 assert.equal(link.port,null);assert.match(reported,/Device removed/);
});
