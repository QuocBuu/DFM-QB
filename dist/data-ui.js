import { DataClient } from './data-client.js';
import { gyroBias } from './telemetry.js';
const $=id=>document.getElementById(id);
export class ImuSettings {
  constructor({send,apply,changed,report}) {
    this.client=new DataClient(send);this.apply=apply;this.changed=changed;this.report=report;
    this.draft=null;this.dirty=false;this.busy=false;this.online=false;
    $('saveProfile').onclick=()=>this.run(async()=>{
      const saved=await this.client.save(this.candidate());
      this.status(`Saved revision ${saved.revision}; rebooting and verifying…`);
      await this.client.reboot();this.showSaved(saved);
      this.report('Saved and rebooted. The board is using the new settings; click Start streaming to resume.');
    });
    $('loadProfile').onclick=()=>this.run(()=>this.load());
    $('applyProfile').onclick=()=>this.run(async()=>{await this.client.reboot();this.showSaved(this.client.profile);});
    $('infoImu').onclick=()=>this.run(async()=>{
      await this.client.exchange(0,'q',true);
      await send('info imu\n');this.report('Sent info imu. See the results in Serial log.');
      $('console').open=true;
    });
    this.render();
  }
  status(text){$('profileStatus').textContent=text;}
  async run(fn) {
    if(this.busy)return;this.busy=true;this.render();this.changed();
    try{await fn();}catch(error){this.status(error.message);this.report(error.message,true);}
    finally{this.busy=false;this.render();this.changed();}
  }
  candidate(){return {...this.draft,turns:Number($('mount').value)/90,flipped:$('flipped').checked};}
  onLine(line){return this.client.onLine(line);}
  disconnect(){this.client.disconnect();this.online=false;this.draft=null;this.dirty=false;this.status('No board connected.');this.render();}
  async connected(){this.online=true;await this.run(()=>this.load());}
  async load() {
    const saved=await this.client.load();
    this.draft=saved?{...saved}:null;this.dirty=false;
    this.showSaved(saved);
  }
  showSaved(saved) {
    this.draft=saved?{...saved}:null;this.dirty=false;
    this.apply(saved);
    $('calibrationStatus').textContent=saved?(this.client.applied?'Settings are active on the board.':'Settings saved; reboot to apply.'):'Keep the board still for 3 seconds.';
    this.status(saved?`Revision ${saved.revision} · ${this.client.applied?'Active':'Saved, reboot required'} · ${saved.savedAt?new Date(saved.savedAt*1000).toLocaleString('en-US'):'No save date'}`:'No settings saved on the board. Keep it still to calibrate the gyro.');
    this.render();
  }
  measured(samples) {
    const bias=gyroBias(samples);
    const std=Math.max(...[0,1,2].map(i=>Math.sqrt(samples.reduce((s,p)=>s+(p.gyro[i]-bias[i])**2,0)/samples.length)));
    this.draft={bias:bias.map(x=>Math.round(x*1000)),samples:samples.length,std:Math.ceil(std*1000),
      gravity:Math.ceil(Math.max(...samples.map(p=>Math.abs(Math.hypot(...p.accel)-1)))*1000)};
    this.dirty=true;this.status('Gyro bias calculated; not yet saved. Check the mounting orientation, then click Save & reboot.');this.render();
    return this.draft.bias.map(x=>x/1000);
  }
  edited(){if(this.draft){this.dirty=true;this.status('Settings edited in the browser; not yet saved to the board.');}this.render();}
  render() {
    const ready=this.online&&!this.busy&&!this.measuring;
    $('saveProfile').disabled=!ready||!this.client.known||!this.draft||!this.dirty;
    $('loadProfile').disabled=!ready;
    $('applyProfile').disabled=!ready||!this.client.known||!this.client.profile||this.client.applied||this.dirty;
    $('infoImu').disabled=!ready;
    $('profileBias').textContent=this.draft?this.draft.bias.map(v=>(v/1000).toFixed(3)).join(' / ')+' °/s':'Not measured';
  }
}
