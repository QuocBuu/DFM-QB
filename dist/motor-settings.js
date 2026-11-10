import {encodeConfigRequest,parseConfigReply,encodeOverrides,decodeOverrides} from './config-wire.js';

export const MOTOR_POSITIONS=['Not assigned','Front left','Front right','Rear left','Rear right'];
export const MOTOR_DIRECTIONS=['Not recorded','CW','CCW'];
export function motorLayout(position,direction) {
  if(!Number.isInteger(position)||!Number.isInteger(direction)||position<0||position>4||direction<0||direction>2)
    throw new Error('Invalid motor position or direction.');
  if(!position&&!direction)return 0;
  if(!position||!direction)throw new Error('Choose both position and observed direction for each assigned motor.');
  return position+(direction-1)*4;
}
export function splitLayout(value) {
  if(!Number.isInteger(value)||value<0||value>8)throw new Error('Invalid motor layout.');
  return value?{position:(value-1)%4+1,direction:value<=4?1:2}:{position:0,direction:0};
}
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);

// CFG1 replaces a complete snapshot: preserve unrelated keys and verify both ACK and GET.
// No SET retry after timeout, disconnect or uncertain result. Reload is required.
export class MotorSettingsClient {
  constructor(send,stop,{timeout=2500}={}) {
    this.send=send;this.stop=stop;this.timeout=timeout;this.sequence=0x4d000000;
    this.pending=null;this.known=false;this.snapshot=null;this.catalog=null;this.epoch=0;
  }
  onLine(line) {
    const reply=parseConfigReply(line),p=this.pending;
    if(!reply||!p||reply.id!==p.id)return false;
    if(reply.tag!==this.catalog.registry_tag)p.finish(new Error('Firmware settings version differs. Update firmware and reload.'));
    else if(reply.status!=='OK')p.finish(new Error(`Motor settings rejected (0x${reply.error.toString(16)}). Reload to check saved values.`));
    else p.finish(null,reply.payload);
    return true;
  }
  disconnect() {this.epoch++;this.known=false;this.snapshot=null;this.pending?.finish(new Error('Disconnected; reload motor settings before saving.'));}
  request(op,bytes) {
    if(this.pending)return Promise.reject(new Error('Motor settings request already in progress.'));
    return new Promise((resolve,reject)=>{
      const id=++this.sequence;
      const timer=setTimeout(()=>finish(new Error('Motor settings ACK timeout; result unknown. Reload before saving again.')),this.timeout);
      const finish=(error,value)=>{
        if(this.pending?.id!==id)return;
        clearTimeout(timer);this.pending=null;error?reject(error):resolve(value);
      };
      this.pending={id,finish};
      try {Promise.resolve(this.send(encodeConfigRequest(id,this.catalog.registry_tag,op,bytes))).catch(error=>finish(error));}
      catch(error){finish(error);}
    });
  }
  keys() {
    return [1,2,3,4].map(n=>{
      const key=this.catalog.settings.find(k=>k.group==='motor'&&k.name===`M${n}_LAYOUT`);
      if(!key||key.rule!=='motor_layout'||key.minimum!==0||key.maximum!==8)throw new Error('Motor settings are not supported by this catalog.');
      return key;
    });
  }
  layouts(bytes=this.snapshot) {
    const overrides=decodeOverrides(bytes,this.catalog);
    return this.keys().map(k=>overrides.get(k.id)??k.default);
  }
  async load(catalog) {
    this.known=false;this.catalog=catalog;this.keys();
    const epoch=this.epoch;await this.stop();
    if(epoch!==this.epoch)throw new Error('Connection changed; reload motor settings.');
    const bytes=await this.request('GET');
    if(epoch!==this.epoch)throw new Error('Connection changed; reload motor settings.');
    const layouts=this.layouts(bytes);
    this.snapshot=bytes;this.known=true;return layouts;
  }
  async save(layouts) {
    if(!this.known||!this.snapshot)throw new Error('Reload motor settings before saving.');
    if(!Array.isArray(layouts)||layouts.length!==4)throw new Error('Four motor records are required.');
    const overrides=decodeOverrides(this.snapshot,this.catalog);
    this.keys().forEach((key,n)=>{splitLayout(layouts[n]);if(layouts[n])overrides.set(key.id,layouts[n]);else overrides.delete(key.id);});
    const candidate=encodeOverrides(overrides,this.catalog),epoch=this.epoch,baseline=this.snapshot;
    this.known=false;
    await this.stop();
    if(epoch!==this.epoch)throw new Error('Connection changed; reload motor settings.');
    const latest=await this.request('GET');
    if(epoch!==this.epoch)throw new Error('Connection changed; reload motor settings.');
    if(!same(latest,baseline))throw new Error('Settings changed since loading. Reload before saving.');
    const ack=await this.request('SET',candidate);
    if(epoch!==this.epoch)throw new Error('Connection changed; reload motor settings.');
    if(!same(ack,candidate))throw new Error('Save acknowledgement differs. Reload to check the stored values.');
    const readback=await this.request('GET');
    if(epoch!==this.epoch)throw new Error('Connection changed; reload motor settings.');
    if(!same(readback,candidate))throw new Error('Motor settings readback differs. Reload required.');
    this.snapshot=readback;this.known=true;return this.layouts();
  }
}

export class MotorSettings {
  constructor({send,stop,run,changed}) {
    this.client=new MotorSettingsClient(send,stop);this.run=run;this.changed=changed;
    this.saved=null;this.dirty=false;
    const rows=document.getElementById('motorSettingsRows');
    [0,1,3,4].forEach((pin,n)=>{
      const row=document.createElement('tr');
      row.innerHTML=`<th scope="row">M${n+1}<small>GPIO ${pin}</small></th><td data-label="Frame position"><select class="form-select" id="motorPosition${n+1}" aria-label="Motor ${n+1} position"></select></td><td data-label="Observed rotation"><select class="form-select" id="motorDirection${n+1}" aria-label="Motor ${n+1} observed rotation"></select></td>`;
      for(const [prefix,labels] of [['motorPosition',MOTOR_POSITIONS],['motorDirection',MOTOR_DIRECTIONS]]){
        const select=row.querySelector(`#${prefix}${n+1}`);
        labels.forEach((label,value)=>select.add(new Option(label,String(value))));
        select.addEventListener('change',()=>{this.dirty=true;this.status('Unsaved motor layout.');this.draw();this.changed();});
      }
      rows.append(row);
    });
    document.getElementById('loadMotorSettings').onclick=()=>this.run(()=>this.load());
    document.getElementById('saveMotorSettings').onclick=()=>this.run(async()=>{
      try {this.status('Saving motor layout…');const saved=await this.client.save(this.values());this.apply(saved);this.status('Saved to device · readback verified. No reboot required.');}
      catch(error){this.status(error.message);throw error;}
    });
    this.draw();
  }
  status(text){document.getElementById('motorSettingsStatus').textContent=text;}
  values(){return [1,2,3,4].map(n=>motorLayout(Number(document.getElementById(`motorPosition${n}`).value),Number(document.getElementById(`motorDirection${n}`).value)));}
  apply(layouts){
    this.saved=layouts;this.dirty=false;
    layouts.forEach((v,n)=>{const p=splitLayout(v);document.getElementById(`motorPosition${n+1}`).value=String(p.position);document.getElementById(`motorDirection${n+1}`).value=String(p.direction);});
    this.draw();
  }
  async load(){
    this.status('Reading motor settings…');
    try{
      if(!this.catalog){const r=await fetch('./settings-catalog.json');if(!r.ok)throw new Error('Settings catalog unavailable.');this.catalog=await r.json();}
      this.apply(await this.client.load(this.catalog));this.status('Loaded from device. Record the physical position and observed rotation.');
    }catch(error){this.status(error.message);throw error;}
  }
  disconnect(){this.client.disconnect();this.saved=null;this.dirty=false;this.status('Disconnected · reload to verify the saved layout.');this.draw();}
  render({connected,blocked,activeMotor}){
    for(const group of document.querySelectorAll('[data-motor-position]'))group.classList.toggle('rotor-running',group.querySelector('.rotor-id').textContent===`M${activeMotor}`);
    document.getElementById('loadMotorSettings').disabled=!connected||blocked;
    document.getElementById('saveMotorSettings').disabled=!connected||blocked||!this.client.known||!this.dirty;
    for(const select of document.querySelectorAll('#motorSettingsRows select'))select.disabled=blocked;
  }
  draw(){
    const entries=[1,2,3,4].map(n=>({motor:n,position:Number(document.getElementById(`motorPosition${n}`).value),direction:Number(document.getElementById(`motorDirection${n}`).value)}));
    for(let position=1;position<=4;position++){
      const matches=entries.filter(e=>e.position===position),item=matches.length===1?matches[0]:null;
      const group=document.querySelector(`[data-motor-position="${position}"]`);
      group.querySelector('.rotor-id').textContent=matches.length>1?'Conflict':item?`M${item.motor}`:'—';
      group.querySelector('.rotor-direction').textContent=item?MOTOR_DIRECTIONS[item.direction]:'Unassigned';
      group.querySelector('.rotation-cw').setAttribute('visibility',item?.direction===1?'visible':'hidden');
      group.querySelector('.rotation-ccw').setAttribute('visibility',item?.direction===2?'visible':'hidden');
    }
    document.getElementById('motorLayoutState').textContent=this.dirty?'Unsaved preview':this.client.known?'Stored layout':'Unverified preview';
  }
}
