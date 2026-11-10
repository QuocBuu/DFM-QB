import {bindTabs} from './ui.js';
import {updateFlashActions} from './flash-ui.js';
import {encodeConfigRequest,parseConfigReply,decodeOverrides} from './config-wire.js';
import {decodeProfile} from './data-client.js';
import {errors} from './errors.js';
const $=id=>document.getElementById(id);
const hex=b=>Array.from(b,n=>n.toString(16).padStart(2,'0')).join('');
export function download(data,name){const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
export function showResult(value){const fallback=errors[value.code]??['Unknown device error.','Save details and reconnect.'];return `[${value.code??'DRN-1023'}] ${value.stage??'connection'}: ${value.message??fallback[0]}\n${value.action??fallback[1]}${value.detail?'\n'+value.detail:''}`;}
export class ParameterBackup {
  constructor(client,send,{canExport=()=>true}={}){this.client=client;this.send=send;this.canExport=canExport;this.pending=null;this.sequence=0;}
  onLine(line){const reply=parseConfigReply(line),p=this.pending;if(!p||!reply||reply.id!==p.id)return false;if(reply.tag!==p.tag||reply.status!=='OK')p.reject(new Error(`CFG1 rejected: registry=${reply.tag}, error=${reply.error}`));else p.resolve(reply.payload);return true;}
  disconnect(){this.pending?.reject(new Error('Connection lost during parameter backup.'));}
  config(tag){return new Promise((resolve,reject)=>{const id=++this.sequence;const finish=(error,value)=>{clearTimeout(timer);this.pending=null;error?reject(error):resolve(value);};const timer=setTimeout(()=>finish(new Error('CFG1 backup timeout; no backup was created.')),2500);this.pending={id,tag,resolve:v=>finish(null,v),reject:e=>finish(e)};this.send(encodeConfigRequest(id,tag,'GET')).catch(e=>finish(e));});}
  async read(catalog){if(!this.canExport())throw new Error("Parameter export requires Flight. Recovery only updates firmware.");return this.client.exclusive(async()=>{
    await this.client.exchange(0,'q',true);
    const config=await this.config(catalog.registry_tag),data=await this.client.request('GET');
    const overrides=decodeOverrides(config,catalog),profile=data.length?decodeProfile(data):null;
    const configAgain=await this.config(catalog.registry_tag),dataAgain=await this.client.request('GET');
    if(hex(config)!==hex(configAgain)||hex(data)!==hex(dataAgain))throw new Error('Parameters changed during backup; retry.');
    return {format:'mini-drone.parameters/1',created_at:new Date().toISOString(),registry_tag:catalog.registry_tag,
      config_hex:hex(config),data_hex:hex(data),overrides:Object.fromEntries(overrides),profile,
      settings:catalog.settings.map(key=>({id:key.id,name:`${key.group}.${key.name}`,value:overrides.get(key.id)??key.default})),
      note:'Stored parameters read from the connected board, not unsaved browser edits. No Wi-Fi credentials. Import must validate schema and device compatibility.'};
  });}
}
export function setupTabs(options){
  const select=bindTabs($('mainTabs'),options);
  return name=>select($(`tab-${name}`));
}
export class FirmwarePanel {
  constructor({release,report,changed=()=>{}}){this.release=release;this.report=report;this.changed=changed;this.token=null;this.state=null;this.polling=false;
    $('updaterRefresh').onclick=()=>this.refresh();
    $('prepareFirmware').onclick=()=>this.prepare();
    $('downloadBackup').onclick=()=>this.backup();
    $('installFirmware').onclick=()=>this.install();
    $('confirmFirmware').onchange=()=>this.render();
    for(const id of ['firmwareFile','firmwarePort'])$(id).onchange=()=>{this.selectionChanged=true;$('confirmFirmware').checked=false;this.render();};
    this.refresh();
  }
  render(){const s=this.state,working=s?.busy||this.polling;
    $('prepareFirmware').disabled=!this.token||working;
    $('downloadBackup').disabled=!this.token||!s?.backup_ready||working;
    $('installFirmware').disabled=!this.token||this.selectionChanged||s?.stage!=='backup-ready'||!s?.downloaded||working||!$('confirmFirmware').checked;
    $('confirmFirmware').disabled=working||this.selectionChanged||s?.stage!=='backup-ready'||!s?.downloaded;
    $('updaterRefresh').disabled=working;
    $('updaterStatus').textContent=working?'WORKING':this.token?'LOCAL UPDATER':'LOCAL UPDATER OFFLINE';
    $('updaterStatus').classList.toggle('live',!!this.token);
    updateFlashActions({backupReady:!!this.token&&s?.backup_ready,busy:working});
    $('firmwareFile').disabled=working;$('firmwarePort').disabled=working;this.changed(!!working);
  }
  async request(path,options={}){const response=await fetch(`/api/updater${path}`,{...options,headers:{'X-Drone-Token':this.token??'',...options.headers},signal:AbortSignal.timeout(20000)});const body=await response.json();if(!response.ok){const error=new Error(showResult(body));error.result=body;throw error;}return body;}
  async refresh(){try{const s=await this.request('');if(!s.available)throw new Error('Updater unavailable');this.token=s.token;this.state=s;const ports=$('firmwarePort'),selected=ports.value;const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Select a port';ports.replaceChildren(placeholder,...s.ports.map(port=>{const o=document.createElement('option');o.value=port;o.textContent=port;return o;}));if(s.ports.includes(selected))ports.value=selected;$('firmwareResult').textContent=showResult(s);if(s.busy&&!this.polling)this.watch();}catch(error){this.token=null;this.state=null;$('confirmFirmware').checked=false;$('firmwareResult').textContent='Local updater offline. Run make web, then open http://127.0.0.1:8080.\nMonitoring and parameter export from Flight remain available on static hosting.';}this.render();}
  async watch(){if(this.polling)return;this.polling=true;this.render();try{for(;;){await new Promise(r=>setTimeout(r,1000));this.state=await this.request('');$('firmwareResult').textContent=showResult(this.state);if(!this.state.busy)break;}}catch(error){this.token=null;this.state=null;$('confirmFirmware').checked=false;$('firmwareResult').textContent=showResult({code:'DRN-1023',stage:'connection',detail:error.message});}finally{this.polling=false;this.render();}}
  async prepare(){if(this.polling||this.state?.busy)return;try{const file=$('firmwareFile').files[0],port=$('firmwarePort').value;if(!file||!port)throw new Error('Select a full firmware ZIP and a USB/UART port.');if(file.size>5*1024*1024)throw new Error('Firmware package exceeds 5 MiB.');$('confirmFirmware').checked=false;this.polling=true;this.render();await this.release();this.state=null;await this.request(`/prepare?port=${encodeURIComponent(port)}`,{method:'POST',body:file});this.selectionChanged=false;this.polling=false;await this.watch();}catch(error){this.polling=false;$('firmwareResult').textContent=error.message;this.render();}}
  async backup(){try{const data=await this.request('/backup');download(JSON.stringify(data,null,2)+'\n',`mini-drone-nvs-${data.device_mac.replaceAll(':','')}.json`);await this.refresh();}catch(error){$('firmwareResult').textContent=error.message;}}
  async install(){if(!this.token||this.selectionChanged||this.polling||this.state?.busy||this.state?.stage!=='backup-ready'||!this.state?.downloaded||!$('confirmFirmware').checked)return;try{const job=this.state.job_id;this.polling=true;this.render();await this.release();await this.request('/install',{method:'POST',headers:{'X-Drone-Job':job}});this.polling=false;await this.watch();}catch(error){this.polling=false;$('firmwareResult').textContent=showResult(error.result??{code:'DRN-1023',stage:'install',detail:error.message});this.state=null;this.render();}}
}
