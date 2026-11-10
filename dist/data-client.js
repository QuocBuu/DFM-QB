// Flight DATA1. Schema FDT2; no arbitrary namespace/address writes.
import { crc32 } from './config-wire.js';
import { PROFILE } from './profile-contract.js';
const O = PROFILE.offsets, L = PROFILE.limits;
export const DATA_SIZE = PROFILE.size;
const text = new TextEncoder();
const replyPattern = new RegExp(String.raw`^(@${PROFILE.transport} ([0-9a-f]{8}) (OK|ERR) (-|[0-9a-f]+)) ([0-9a-f]{8})(?:\r?\n)?$`);
const hex = bytes => Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
const unhex = s => Uint8Array.from(s.match(/../g) ?? [], v => parseInt(v, 16));
const u32 = n => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
const equal = (a,b) => a.length === b.length && a.every((v,i) => v === b[i]);
export function dataFrame(id, op, bytes = new Uint8Array()) {
  if (!u32(id) || !['INFO','GET','ACTIVE','SET','REBOOT'].includes(op) || !(bytes instanceof Uint8Array)
      || (bytes.length !== (op === 'SET' ? DATA_SIZE : op === 'REBOOT' ? 8 : 0))) throw new Error('Invalid DATA1 request');
  const body = `@${PROFILE.transport} ${id.toString(16).padStart(8,'0')} ${op} ${bytes.length ? hex(bytes) : '-'}`;
  return `${body} ${crc32(text.encode(body)).toString(16).padStart(8,'0')}\n`;
}
export function dataReply(line) {
  if (typeof line !== 'string' || line.length > PROFILE.frame_max) return null;
  const m = replyPattern.exec(line);
  if (!m || m[0] !== line || crc32(text.encode(m[1])) !== parseInt(m[5],16)
      || (m[4] !== '-' && m[4].length % 2) || (m[3] === 'ERR' && m[4].length !== 8)) return null;
  return {id:parseInt(m[2],16), status:m[3], bytes:m[4] === '-' ? new Uint8Array() : unhex(m[4])};
}
export function encodeProfile(p) {
  if (!p || !u32(p.revision) || !p.revision || !/^[0-9a-f]{16}$/.test(p.writeId)
      || p.writeId === '0000000000000000' || !PROFILE.addresses.includes(p.address)
      || !Number.isInteger(p.turns) || p.turns < 0 || p.turns > L.turns_max || typeof p.flipped !== 'boolean'
      || !Array.isArray(p.bias) || p.bias.length !== 3 || p.bias.some(n => !Number.isInteger(n) || Math.abs(n)>L.bias_max)
      || p.bias.reduce((sum,n) => sum+n*n,0)>L.bias_norm_squared_max || !u32(p.samples) || p.samples<L.samples_min || p.samples>L.samples_max
      || !u32(p.savedAt) || !u32(p.std) || p.std>L.std_max || !u32(p.gravity) || p.gravity>L.gravity_max) throw new Error('Invalid calibration settings.');
  const b = new Uint8Array(DATA_SIZE), v = new DataView(b.buffer);
  b.set(text.encode(PROFILE.magic));v.setUint32(O.revision,p.revision,true);b.set(unhex(p.writeId),O.write_id);
  b.set([p.address,p.turns,Number(p.flipped),PROFILE.who_am_i],O.address);
  p.bias.forEach((n,i)=>v.setInt32(O.bias+4*i,n,true));
  v.setUint32(O.samples,p.samples,true);v.setUint32(O.std,p.std,true);v.setUint32(O.gravity,p.gravity,true);
  v.setUint32(O.saved_at,p.savedAt,true);v.setUint32(O.crc,crc32(b.subarray(0,O.crc)),true);return b;
}
export function decodeProfile(b) {
  if (!(b instanceof Uint8Array) || b.length !== DATA_SIZE || !equal(b.subarray(0,4),text.encode(PROFILE.magic))
      || b[O.flipped]>1 || b[O.who_am_i]!==PROFILE.who_am_i) throw new Error('Invalid Flight data schema.');
  const v = new DataView(b.buffer,b.byteOffset,b.byteLength);
  if (v.getUint32(O.crc,true)!==crc32(b.subarray(0,O.crc))) throw new Error('Flight data CRC mismatch.');
  const p = {revision:v.getUint32(O.revision,true),writeId:hex(b.subarray(O.write_id,O.address)),address:b[O.address],turns:b[O.turns],flipped:b[O.flipped]===1,
    bias:[0,1,2].map(i=>v.getInt32(O.bias+4*i,true)),samples:v.getUint32(O.samples,true),std:v.getUint32(O.std,true),gravity:v.getUint32(O.gravity,true),savedAt:v.getUint32(O.saved_at,true)};
  encodeProfile(p);return p;
}
const errorNames = PROFILE.errors;
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
    if(info.length!==12 || info[0]!==PROFILE.schema || info[1]!==DATA_SIZE || info[2]!==PROFILE.kind
        || !PROFILE.addresses.includes(info[3]) || info[4]!==PROFILE.who_am_i || info.slice(5,8).some(v=>v)) throw new Error('The firmware does not support FDT2 IMU settings.');
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
