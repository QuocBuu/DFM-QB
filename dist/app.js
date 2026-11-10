import {hydrateIcons,LogView,bindTabs} from './ui.js';
import {setupFlashMap} from './flash-ui.js';
import {ParameterBackup,FirmwarePanel,setupTabs,download} from './maintenance.js';
import { Attitude,fromEuler,rotate,inverse,euler } from './telemetry.js';
import { COMMAND,parseDeviceLine } from './protocol.js';
import {MotorTest} from './motor.js';
import {MotorSettings} from './motor-settings.js';
import { SerialLink } from './serial.js';
import { ImuSettings } from './data-ui.js';
import { chart } from './charts.js';
const $=id=>document.getElementById(id);
hydrateIcons();
setupFlashMap();
const serialLog=new LogView($('console'));
const attitude=new Attitude();
let view=null;
try {const {DroneView}=await import('./drone.js');view=new DroneView($('viewport'));}
catch(error){$('viewportHint').innerHTML='<span>3D INITIALIZATION FAILED</span><small>Could not create the canvas. IMU readings are still available.</small>';console.error(error);}
let recoveryMode=false,flightIdentified=false,maintenanceBusy=false;
let connected=false,connecting=false,streaming=false,demo=false,closing=false,lastSampleAt=0,lastSample=null,history=[],total=0,calibration=null,pendingStart=0,gotStop=false;
let demoTimer=null,demoN=0,demoStart=0;
const link=new SerialLink(onLine,message=>{
  motor.disconnect();motorSettings.disconnect();backup.disconnect();settings.disconnect();connected=false;streaming=false;connecting=false;calibration=null;pendingStart=0;
  messageNotice(`Connection lost. ${message} Plug the board back in and click Connect USB / UART.`, 'error');log(`SYS · ${message}`);updateControls();
});
const motor=new MotorTest(bytes=>link.send(bytes),updateControls);
const settings=new ImuSettings({send:bytes=>link.send(bytes),changed:updateControls,report:(text,error)=>messageNotice(text,error?'error':''),apply:p=>{
  attitude.bias=p?p.bias.map(x=>x/1000):[0,0,0];
  $('mount').value=String(p?p.turns*90:0);$('flipped').checked=p?.flipped??false;
  attitude.setMount(Number($('mount').value),$('flipped').checked);history=[];
}});
const motorSettings=new MotorSettings({send:bytes=>link.send(bytes),stop:()=>settings.client.exchange(0,'q',true),run:fn=>settings.run(fn),changed:updateControls});
const selectParameter=bindTabs($('parameterTabs'),{onSelect:tab=>{
  $('parameterSelection').textContent=tab.id==='parameter-motor'?'Motor calib':'IMU calib';
  if(tab.id!=='parameter-motor')leaveMotor();
}});
const selectTab=setupTabs({onSelect:tab=>{if(tab.id!=='tab-parameters')leaveMotor();}});
const backup=new ParameterBackup(settings.client,bytes=>link.send(bytes),{canExport:()=>connected&&flightIdentified&&!recoveryMode});
const firmware=new FirmwarePanel({report:messageNotice,changed:busy=>{maintenanceBusy=busy;updateControls();},release:async()=>{
  if(settings.busy||connecting||closing)throw new Error('Wait for the connection or parameter operation to finish.');
  if(demo)endDemo();
  if(connected){backup.disconnect();settings.disconnect();closing=true;updateControls();try{await link.disconnect();}finally{motor.disconnect();motorSettings.disconnect();connected=false;streaming=false;closing=false;updateControls();}}
}});
$('backupParameters').onclick=()=>settings.run(async()=>{
  try{const response=await fetch('./settings-catalog.json');if(!response.ok)throw new Error('Settings catalog unavailable');const saved=await backup.read(await response.json());download(JSON.stringify(saved,null,2)+'\n',`mini-drone-parameters-${Date.now()}.json`);$('backupResult').textContent='Parameters read twice and checksums verified; backup download requested.';}
  catch(error){$('backupResult').textContent=`[DRN-1019] Backup failed: ${error.message}`;throw error;}
});
$('enterRecovery').onclick=()=>settings.run(async()=>{
  await settings.client.exchange(0,'q',true);
  await link.send('sys recovery\n');
  messageNotice('Recovery requested. Wait for the Recovery boot banner; reconnect if USB resets.');
  streaming=false;selectTab('firmware');
});
function messageNotice(message,kind=''){const n=$('notice');n.textContent=message;n.className=`notice ${kind}`;}
function log(line){serialLog.append(`${new Date().toLocaleTimeString('en-US')}  ${line}`);}
$('infoImu').addEventListener('click',()=>selectTab('log'));
function clearData(){attitude.reset();history=[];total=0;lastSampleAt=0;lastSample=null;calibration=null;pendingStart=0;gotStop=false;$('calibrationStatus').textContent='Keep the board still for 3 seconds.';}
function clearSession(){clearData();attitude.bias=[0,0,0];}
function updateControls(){
  const motorBlocked=maintenanceBusy||recoveryMode||!connected||connecting||closing||settings.busy||!!calibration;
  $('motorStart').disabled=motorBlocked||motor.busy;
  $('motorStop').disabled=!connected||closing||settings.busy||maintenanceBusy;
  for(const button of document.querySelectorAll('[data-motor]')){
    button.disabled=motorBlocked||!motor.mode||!!motor.pending;
    button.setAttribute('aria-pressed',String(motor.motor===Number(button.dataset.motor)));
  }
  $('motorStatus').textContent=motor.status;
  motorSettings.render({connected,activeMotor:motor.motor,blocked:maintenanceBusy||settings.busy||motor.busy||connecting||closing||!!calibration});
  $('backupParameters').disabled=recoveryMode||!flightIdentified||maintenanceBusy||motor.busy||!connected||settings.busy||!!calibration||closing||connecting;
  $('enterRecovery').disabled=maintenanceBusy||motor.busy||!connected||settings.busy||closing||connecting;
  settings.measuring=!!calibration||maintenanceBusy||motor.busy;settings.render();
  $('connect').disabled=maintenanceBusy||connecting||closing||settings.busy;
  $('connect').innerHTML=connecting?'Connecting…':closing?'Disconnecting…':connected?'↔ Disconnect':'↔ Connect USB / UART';
  $('demo').disabled=maintenanceBusy||connected||connecting||closing;
  $('demo').innerHTML=demo?'■ Stop demo':'▷ Try demo';
  $('stream').disabled=maintenanceBusy||motor.busy||recoveryMode||!connected||connecting||closing||settings.busy;
  $('stream').innerHTML=streaming?'Ⅱ Stop streaming':'▶ Start streaming';
  const fresh=lastSampleAt>0&&performance.now()-lastSampleAt<1500;
  $('zero').disabled=!fresh||(!streaming&&!demo);
  $('calibrate').disabled=!connected||!streaming||!!calibration||!fresh||settings.busy;
  $('mount').disabled=!!calibration||settings.busy;$('flipped').disabled=!!calibration||settings.busy;
  const badge=$('connectionBadge');badge.className=`status ${demo?'demo':connected?'live':''}`;
  badge.innerHTML=`<i></i>${demo?'SIMULATED DATA':connected?'CONNECTED':'DISCONNECTED'}`;
  $('source').textContent=demo?'DEMO / SIMULATED':connected?(streaming?(fresh?'LIVE / USB SERIAL':'WAITING FOR DATA'):'PAUSED'):'OFFLINE';
  $('source').className=`source ${demo?'demo':connected&&streaming&&fresh?'live':''}`;
  $('dataDot').className=fresh&&(demo||streaming)?'live':'';
  document.body.classList.toggle('demo-mode',demo);
  if(view){$('viewportHint').classList.toggle('hidden',fresh&&(streaming||demo));if(!fresh||(!streaming&&!demo))$('viewportHint').innerHTML=`<span>${streaming?'NO NEW DATA':connected?'PAUSED':'WAITING FOR BOARD'}</span><small>${lastSample?'Showing the last recorded attitude':'Connect to see live movement'}</small>`;}
}
function onLine(line){
  if(line.startsWith('Running=')){recoveryMode=line.startsWith('Running=factory');flightIdentified=line.startsWith('Running=ota_0');if(recoveryMode){selectTab('firmware');messageNotice('Recovery ready. Firmware updates use USB/UART; parameter export requires Flight.');}}
  if(motorSettings.client.onLine(line)){log(line);return;}
  if(backup.onLine(line)){log(line);return;}
  if(settings.onLine(line)){log(line);return;}
  const event=parseDeviceLine(line);
  motor.onEvent(event);
  if(event.type==='imu.sample'){if(!connected||gotStop)return;streaming=true;pendingStart=0;accept(event.sample,false);log(line);return;}
  log(line);
  if(event.type==='imu.started'){streaming=true;gotStop=false;pendingStart=performance.now();if(event.address)$('imuIdentity').textContent=`I²C ${event.address}`;}
  if(event.type==='imu.stopped'){streaming=false;gotStop=true;pendingStart=0;calibration=null;}
  if(event.type==='imu.error'){streaming=false;pendingStart=0;calibration=null;messageNotice(line+' · Check the board, then click Start streaming to try again.','error');}
  if(event.type==='device.recovery'){motor.disconnect();motorSettings.disconnect();recoveryMode=true;flightIdentified=false;settings.disconnect();streaming=false;pendingStart=0;messageNotice('Recovery is ready. Open Firmware for a full USB/UART update. Export parameters from Flight before entering Recovery.');selectTab('firmware');}
  updateControls();
}
function accept(sample,simulated){
  const now=performance.now();
  if(!attitude.update(sample,now))return;
  lastSampleAt=now;lastSample=sample;total++;
  if(!simulated && $('notice').classList.contains('error')) messageNotice('IMU data reception has resumed.');
  const angles=euler(attitude.display);
  history.push({at:now,accel:sample.accel,gyro:sample.gyro,angles:[angles.roll,angles.pitch,angles.yaw]});
  while(history.length>400||history[0]?.at<now-31000)history.shift();
  if(calibration&&!simulated){
    if(calibration.length&&sample.n!==calibration.at(-1).n+1){calibration=null;$('calibrationStatus').textContent='Samples were missed; keep the board still and calibrate again.';updateControls();return;}
    calibration.push(sample);$('calibrationStatus').textContent=`Keep the board still… ${calibration.length}/30 samples`;
    if(calibration.length>=30){try{attitude.bias=settings.measured(calibration);attitude.reset();history=[];$('calibrationStatus').textContent='Gyro bias compensated; ready to save to the board.';log(`SYS · Gyro bias [dps]: ${attitude.bias.map(v=>v.toFixed(3)).join(', ')}`);}catch(error){$('calibrationStatus').textContent=error.message;}calibration=null;}
  }
  showSample(sample,angles);updateControls();
}
function showSample(sample,angles){
  for(const key of ['roll','pitch','yaw']){const value=angles[key];$(key).innerHTML=`${value.toFixed(1)}<small>°</small>`;}
  for(const name of ['accel','gyro','mag']){const values=sample[name];$(name).querySelectorAll('b').forEach((n,i)=>n.textContent=values?values[i].toFixed(name==='accel'?3:2):'—');}
  $('temperature').textContent=`${sample.temp.toFixed(1)} °C`;
  $('sampleCount').textContent=`${total.toLocaleString('en-US')} samples`;
}
async function begin(){
  if(maintenanceBusy||motor.busy||settings.busy||recoveryMode)return;
  calibration=null;gotStop=false;attitude.reset();history=[];
  await link.send(COMMAND.imuStart);streaming=true;pendingStart=performance.now();
  messageNotice('Live IMU data · Rotate the board to inspect attitude.');updateControls();
}
async function stop(){if(settings.busy)return;await link.send(COMMAND.imuStop);streaming=false;pendingStart=0;calibration=null;messageNotice('Streaming stopped. Showing the last sample; click Start streaming to resume.');updateControls();}
function endDemo(){clearInterval(demoTimer);demoTimer=null;demo=false;streaming=false;clearSession();clearValues();view?.setQuaternion([0,0,0,1]);messageNotice('Connect the board via USB / UART to begin.');updateControls();}
function clearValues(){for(const key of ['roll','pitch','yaw']){$(key).innerHTML='—<small>°</small>';}for(const key of ['accel','gyro','mag'])$(key).querySelectorAll('b').forEach(x=>x.textContent='—');$('temperature').textContent='— °C';$('sampleCount').textContent='0 samples';$('imuIdentity').innerHTML='ID <b>—</b>';}
$('connect').addEventListener('click',async()=>{
  if(connected){backup.disconnect();settings.disconnect();closing=true;updateControls();try{await link.disconnect();}catch(error){log(`SYS · ${error.message}`);}finally{motor.disconnect();motorSettings.disconnect();connected=false;streaming=false;closing=false;calibration=null;messageNotice('Disconnected. The serial port is now available to other applications.');updateControls();}return;}
  if(demo)endDemo();connecting=true;updateControls();
  try{const info=await link.connect();connected=true;recoveryMode=false;flightIdentified=false;clearSession();clearValues();log(`SYS · Serial open 115200 8N1 / USB vendor ${info.usbVendorId?.toString(16)??'UART'}`);await link.send(COMMAND.imuStop+'\nsys boot\n');await new Promise(r=>setTimeout(r,250));if(!recoveryMode){await settings.connected();await settings.run(()=>motorSettings.load());await begin();}}
  catch(error){if(link.port)await link.disconnect().catch(()=>{});connected=false;messageNotice(error.name==='NotFoundError'?'No port selected. Click Connect USB / UART to select the ESP32-C3 or USB-UART adapter.':`Could not connect: ${error.message} · Close any terminals using the port and try again.`,'error');}
  finally{connecting=false;updateControls();}
});
$('stream').addEventListener('click',()=>{if(!connected)return;const op=streaming?stop():begin();op.catch(error=>messageNotice(error.message,'error'));});
$('demo').addEventListener('click',()=>{
  if(demo){endDemo();return;}clearSession();clearValues();demo=true;demoN=0;demoStart=performance.now();
  messageNotice('Demo · Simulated IMU data. No device commands.','demo');
  log('DEMO · Simulated data started.');
  demoTimer=setInterval(()=>{
    const t=(performance.now()-demoStart)/1000;
    const angles=[Math.sin(t*.55)*23,Math.sin(t*.38)*17,Math.sin(t*.2)*65];
    const [r,p]=angles.map(v=>v*Math.PI/180);
    const derivatives=[Math.cos(t*.55)*23*.55,Math.cos(t*.38)*17*.38,Math.cos(t*.2)*65*.2];
    const [rd,pd,yd]=derivatives;
    const gyro=[rd-yd*Math.sin(p),pd*Math.cos(r)+yd*Math.sin(r)*Math.cos(p),-pd*Math.sin(r)+yd*Math.cos(r)*Math.cos(p)];
    const q=fromEuler(...angles),sample={n:++demoN,accel:rotate(inverse(q),[0,0,1]),gyro,temp:32.4,mag:rotate(inverse(q),[22,4,-38])};
    accept(sample,true);if(demoN%10===0)log(`DEMO · Roll ${angles[0].toFixed(1)}° / Pitch ${angles[1].toFixed(1)}° / Yaw ${angles[2].toFixed(1)}°`);
  },100);updateControls();
});
$('zero').addEventListener('click',()=>{attitude.zero();history=[];if(lastSample)showSample(lastSample,euler(attitude.display));log('SYS · Current attitude set as the 0° reference.');});
$('calibrate').addEventListener('click',()=>{calibration=[];$('calibrationStatus').textContent='Keep the board still… 0/30 samples';updateControls();});
function mountChanged(){settings.edited();attitude.setMount(Number($('mount').value),$('flipped').checked);history=[];log('SYS · IMU mounting orientation changed; attitude reference reset.');}
$('mount').addEventListener('change',mountChanged);$('flipped').addEventListener('change',mountChanged);
for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>{view?.setView(button.dataset.view);document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('selected',b===button));});
$('clear').addEventListener('click',()=>serialLog.clear());
$('export').addEventListener('click',()=>{const blob=new Blob([serialLog.text()],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`mini-drone-${demo?'demo':'serial'}-${new Date().toISOString().replaceAll(':','-')}.log`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
function motorAction(operation){operation.catch(error=>messageNotice(error.message,'error'));}
function enterMotor(){
  if($('motorStart').disabled)return;
  selectTab('parameters');selectParameter($('parameter-motor'));
  calibration=null;streaming=false;pendingStart=0;
  messageNotice('Motor bench test · Remove propellers. Each press runs one motor at 10% for 2 seconds.');
  motorAction(motor.enter());
}
$('motorStart').addEventListener('click',enterMotor);
$('motorStop').addEventListener('click',()=>motorAction(motor.stop()));
for(const button of document.querySelectorAll('[data-motor]'))button.addEventListener('click',()=>motorAction(motor.select(Number(button.dataset.motor))));
document.addEventListener('keydown',e=>{
  if(!connected||closing||e.repeat)return;
  if(motor.busy){
    e.preventDefault();
    if(/^[1-4]$/.test(e.key)&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
      if(!motor.pending)motorAction(motor.select(Number(e.key)));
    }else leaveMotor();
    return;
  }
  if(maintenanceBusy||settings.busy)return;
  if(streaming){e.preventDefault();stop().catch(error=>messageNotice(error.message,'error'));return;}
  if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.key==='m'){e.preventDefault();enterMotor();}
  else if(e.key==='i'||e.key==='q'){e.preventDefault();(e.key==='i'?begin():stop()).catch(error=>messageNotice(error.message,'error'));}
});
function leaveMotor(){if(connected&&motor.busy&&motor.pending?.expected!=='imu.stopped')motorAction(motor.stop());}
window.addEventListener('blur',leaveMotor);
document.addEventListener('visibilitychange',()=>{if(document.hidden)leaveMotor();});
window.addEventListener('beforeunload',()=>{if(connected&&!settings.busy)link.send(COMMAND.imuStop).catch(()=>{});});
if(!navigator.serial||!isSecureContext){messageNotice('Web Serial is unavailable in this browser. Open the page in Chrome/Edge on localhost or HTTPS; you can still try the demo.','error');$('connect').title='Requires Chrome/Edge on localhost or HTTPS';}
let lastFrame=0,lastChart=0;
function frame(now){
  requestAnimationFrame(frame);
  if(document.hidden||now-lastFrame<33)return;
  lastFrame=now;view?.setQuaternion(attitude.display);view?.render();
  if(now-lastChart>100){
    const recent=history.filter(x=>now-x.at<2000),rate=recent.length>1?(recent.length-1)/((recent.at(-1).at-recent[0].at)/1000):0;
    const fresh=lastSampleAt>0&&now-lastSampleAt<1500;
    $('rate').innerHTML=`${fresh&&(streaming||demo)?Math.min(99,rate).toFixed(1):'—'}<small>Hz</small>`;
    $('sampleState').textContent=demo?'Demo':!connected?'Disconnected':!streaming?'Stopped':fresh?'Receiving':'Waiting for data';
    if($('historyPanel').open)chart($('attitudeChart'),history,'angles',{range:180,labels:true,now});
    if(connected&&streaming&&!fresh&&((lastSampleAt&&now-lastSampleAt>1800)||(pendingStart&&now-pendingStart>2500))){calibration=null;messageNotice('No new IMU samples received. Check the Flight firmware, cable and board power; click Stop streaming, then Start streaming to retry.','error');}
    lastChart=now;updateControls();
  }
}
updateControls();requestAnimationFrame(frame);
