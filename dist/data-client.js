// Flight DATA1. Schema FDT2; no arbitrary namespace/address writes.
import { crc32 } from './config-wire.js';
export const DATA_SIZE = 52;
const text = new TextEncoder();
const hex = bytes => Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
const unhex = s => Uint8Array.from(s.match(/../g) ?? [], v => parseInt(v, 16));
const u32 = n => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
const equal = (a,b) => a.length === b.length && a.every((v,i) => v === b[i]);
export function dataFrame(id, op, bytes = new Uint8Array()) {
  if (!u32(id) || !['INFO','GET','ACTIVE','SET','REBOOT'].includes(op) || !(bytes instanceof Uint8Array)
      || (bytes.length !== (op === 'SET' ? DATA_SIZE : op === 'REBOOT' ? 8 : 0))) throw new Error('Invalid DATA1 request');
  const body = `@DATA1 ${id.toString(16).padStart(8,'0')} ${op} ${bytes.length ? hex(bytes) : '-'}`;
  return `${body} ${crc32(text.encode(body)).toString(16).padStart(8,'0')}\n`;
}
export function dataReply(line) {
  if (typeof line !== 'string' || line.length > 192) return null;
  const m = /^(@DATA1 ([0-9a-f]{8}) (OK|ERR) (-|[0-9a-f]+)) ([0-9a-f]{8})(?:\r?\n)?$/.exec(line);
  if (!m || m[0] !== line || crc32(text.encode(m[1])) !== parseInt(m[5],16)
      || (m[4] !== '-' && m[4].length % 2) || (m[3] === 'ERR' && m[4].length !== 8)) return null;
  return {id:parseInt(m[2],16), status:m[3], bytes:m[4] === '-' ? new Uint8Array() : unhex(m[4])};
}
export function encodeProfile(p) {
  if (!p || !u32(p.revision) || !p.revision || !/^[0-9a-f]{16}$/.test(p.writeId)
      || p.writeId === '0000000000000000' || ![0x68,0x69].includes(p.address)
      || !Number.isInteger(p.turns) || p.turns < 0 || p.turns > 3 || typeof p.flipped !== 'boolean'
      || !Array.isArray(p.bias) || p.bias.length !== 3 || p.bias.some(n => !Number.isInteger(n) || Math.abs(n)>8000)
      || p.bias.reduce((sum,n) => sum+n*n,0)>64000000 || !u32(p.samples) || p.samples<30 || p.samples>1000
      || !u32(p.savedAt) || !u32(p.std) || p.std>350 || !u32(p.gravity) || p.gravity>150) throw new Error('Invalid calibration settings.');
  const b = new Uint8Array(DATA_SIZE), v = new DataView(b.buffer);
  b.set(text.encode('FDT2'));v.setUint32(4,p.revision,true);b.set(unhex(p.writeId),8);
  b.set([p.address,p.turns,Number(p.flipped),0xea],16);
  p.bias.forEach((n,i)=>v.setInt32(20+4*i,n,true));
  v.setUint32(32,p.samples,true);v.setUint32(36,p.std,true);v.setUint32(40,p.gravity,true);
  v.setUint32(44,p.savedAt,true);v.setUint32(48,crc32(b.subarray(0,48)),true);return b;
}
export function decodeProfile(b) {
  if (!(b instanceof Uint8Array) || b.length !== DATA_SIZE || hex(b.subarray(0,4)) !== '46445432'
      || b[18]>1 || b[19]!==0xea) throw new Error('Invalid Flight data schema.');
  const v = new DataView(b.buffer,b.byteOffset,b.byteLength);
  if (v.getUint32(48,true)!==crc32(b.subarray(0,48))) throw new Error('Flight data CRC mismatch.');
  const p = {revision:v.getUint32(4,true),writeId:hex(b.subarray(8,16)),address:b[16],turns:b[17],flipped:b[18]===1,
    bias:[0,1,2].map(i=>v.getInt32(20+4*i,true)),samples:v.getUint32(32,true),std:v.getUint32(36,true),gravity:v.getUint32(40,true),savedAt:v.getUint32(44,true)};
  encodeProfile(p);return p;
}
const errorNames = {0x7101:'Data was changed by another session; reload before saving.',
  0x7102:'This write ID has already been used for different data.',0x7103:'Data, checksum or sensor mismatch.',
  0x7104:'The board has not stopped IMU streaming.'};
export class DataClient {
  constructor(send,{timeout=2000,retries=3}={}) {
    this.send=send;this.timeout=timeout;this.retries=retries;this.pending=null;
    this.sequence=crypto.getRandomValues(new Uint32Array(1))[0];this.profile=null;this.info=null;this.known=false;this.busy=false;this.epoch=0;this.applied=false;
  }
  onLine(line) {
    const p=this.pending;
    if (!p) return false;
    if(p.stop && line==='IMU STOP'){p.resolve();return false;}
    const reply=dataReply(line);
    if(!reply || p.stop || reply.id!==p.id)return false;
    if(reply.status==='ERR'){
      const code=parseInt(hex(reply.bytes),16),error=new Error(errorNames[code]??`Board rejected the request (0x${code.toString(16)}). Reload to check the current state.`);
      error.code=code;p.reject(error);
    } else p.resolve(reply.bytes);
    return true;
  }
  disconnect() {
    this.epoch++;this.applied=false;
    this.known=false;this.info=null;this.profile=null;
    this.pending?.reject(new Error('Connection lost; the write result may be unknown. Reload after reconnecting.'));
  }
  async exchange(id, wire, stop=false, attempts=this.retries) {
    for(let attempt=0;attempt<attempts;attempt++) {
      try {
        return await new Promise((resolve,reject)=>{
          const pending={id,stop,resolve:v=>finish(null,v),reject:e=>finish(e)};
          const finish=(error,value)=>{
            if(this.pending!==pending)return;
            clearTimeout(timer);this.pending=null;error?reject(error):resolve(value);
          };
          const timer=setTimeout(()=>{const e=new Error('ACK timeout; the write result is unknown. Reload required.');e.code='TIMEOUT';finish(e);},this.timeout);
          this.pending=pending;
          Promise.resolve().then(()=>this.send(wire)).catch(e=>finish(e));
        });
      } catch(error) {if(error.code!=='TIMEOUT'||attempt===attempts-1)throw error;}
    }
  }
  request(op,bytes,attempts) {
    const id=this.sequence=(this.sequence+1)>>>0;
    return this.exchange(id,dataFrame(id,op,bytes),false,attempts);
  }
  async exclusive(action) {
    if(this.busy)throw new Error('A data transaction is in progress.');
    this.busy=true;
    try{return await action();}finally{this.busy=false;}
  }
  decodeInfo(info) {
    if(info.length!==12 || info[0]!==2 || info[1]!==DATA_SIZE || info[2]!==1
        || ![0x68,0x69].includes(info[3]) || info[4]!==0xea || info.slice(5,8).some(v=>v)) throw new Error('The firmware does not support FDT2 IMU settings.');
    return {address:info[3],bootId:new DataView(info.buffer,info.byteOffset,info.byteLength).getUint32(8,true)};
  }
  async reboot() {
    return this.exclusive(async()=>{
      if(!this.known || !this.profile || !this.info)throw new Error('Reload the saved settings before rebooting.');
      const expected=encodeProfile(this.profile),before=this.info.bootId,epoch=this.epoch;
      this.known=false;this.applied=false;
      await this.exchange(0,'q',true);
      try {await this.request('REBOOT',unhex(this.profile.writeId),1);}
      catch(error){if(error.code!=='TIMEOUT')throw error; /* ACK may be lost during reset; never replay reboot. */}
      for(let n=0;n<12;n++) {
        await new Promise(r=>setTimeout(r,250));
        if(epoch!==this.epoch)throw new Error('Saved; reconnect to verify settings after reboot.');
        try {
          const info=this.decodeInfo(await this.request('INFO',undefined,1));
          if(info.bootId===before)continue;
          if(info.address!==this.profile.address)throw new Error('The IMU changed after reboot.');
          const stored=await this.request('GET'),active=await this.request('ACTIVE');
          if(!equal(stored,expected)||!equal(active,expected))throw new Error('Active settings do not match after reboot. Reload to verify.');
          if(epoch!==this.epoch)throw new Error('The connection session has changed.');
          this.info=info;this.known=true;this.applied=true;return this.profile;
        } catch(error){if(error.code!=='TIMEOUT' && error.code!==0x103)throw error;}
      }
      throw new Error('Saved, but reboot is unconfirmed. Reconnect and reload IMU settings.');
    });
  }
  async load() {
    return this.exclusive(async()=>{
      const epoch=this.epoch;
      this.known=false;this.info=null;
      // INFO is harmless and bounded. Older firmware may ignore it.
      const info=this.decodeInfo(await this.request('INFO',undefined,1));
      const bytes=await this.request('GET');
      const profile=bytes.length?decodeProfile(bytes):null;
      if(profile && profile.address!==info.address)throw new Error('Saved settings belong to a different IMU address.');
      if(epoch!==this.epoch)throw new Error('The connection session has changed.');
      const active=await this.request('ACTIVE');
      if(epoch!==this.epoch)throw new Error('The connection session has changed.');
      this.applied=equal(active,bytes);
      this.profile=profile;this.info=info;this.known=true;return profile;
    });
  }
  async save(draft) {
    return this.exclusive(async()=>{
      if(!this.known || !this.info)throw new Error('Read board data before writing.');
      const epoch=this.epoch;
      const id=hex(crypto.getRandomValues(new Uint8Array(8)));
      const candidate=encodeProfile({...draft,address:this.info.address,revision:(this.profile?.revision??0)+1,writeId:id,savedAt:Math.floor(Date.now()/1000)});
      this.known=false;
      // Bare q is unchanged. ACK must arrive before SET; no blind timing delay.
      await this.exchange(0,'q',true);
      if(epoch!==this.epoch)throw new Error('The connection session has changed.');
      const ack=await this.request('SET',candidate);
      if(!equal(ack,candidate))throw new Error('ACK does not match the sent data. Reload required.');
      const readback=await this.request('GET');
      if(!equal(readback,candidate))throw new Error('Readback does not match the sent data. Reload required.');
      if(epoch!==this.epoch)throw new Error('The connection session has changed.');
      this.profile=decodeProfile(readback);this.known=true;this.applied=false;return this.profile;
    });
  }
}
