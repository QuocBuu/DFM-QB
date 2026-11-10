import test from 'node:test';
import assert from 'node:assert/strict';
import {MotorTest} from '../dist/motor.js';

test('motor requires START ACK, sends only 1-4, and waits for RUN ACK', async () => {
  const writes=[];
  const motor=new MotorTest(async bytes=>writes.push(bytes));
  const start=motor.enter();
  assert.equal(motor.mode,false);
  await assert.rejects(motor.select(1));
  motor.onEvent({type:'motor.started'});await start;
  for(const n of [0,5,1.5,'1',NaN])await assert.rejects(motor.select(n));
  const run=motor.select(3);
  assert.equal(motor.motor,0);
  await assert.rejects(motor.select(4),/Wait/);
  motor.onEvent({type:'motor.running',motor:3});await run;
  assert.equal(motor.motor,3);
  motor.onEvent({type:'motor.idle'});assert.equal(motor.motor,0);assert.equal(motor.mode,true);
  const stop=motor.stop();
  motor.onEvent({type:'motor.stopped'});motor.onEvent({type:'imu.stopped'});await stop;
  assert.equal(motor.busy,false);
  assert.deepEqual(writes,['q\nm','3','\nq']);
});

test('stop cancels pending selection; disconnect never replays commands', async () => {
  const writes=[];const motor=new MotorTest(async bytes=>writes.push(bytes));
  const start=motor.enter();motor.onEvent({type:'motor.started'});await start;
  const run=motor.select(1);const cancelled=assert.rejects(run,/cancelled/);
  const stop=motor.stop();motor.onEvent({type:'motor.stopped'});motor.onEvent({type:'imu.stopped'});
  await cancelled;await stop;
  const retry=motor.enter();const disconnected=assert.rejects(retry,/disconnected/);
  motor.disconnect();await disconnected;
  assert.equal(motor.busy,false);
  assert.deepEqual(writes,['q\nm','1','\nq','q\nm']);
});

test('missing ACK and firmware errors cannot report a running motor', async () => {
  const motor=new MotorTest(async()=>{});
  await assert.rejects(motor.enter(),/No motor response/);
  assert.equal(motor.mode,false);assert.equal(motor.motor,0);
  const start=motor.enter();motor.onEvent({type:'motor.error',message:'MOTOR ERROR unavailable'});
  await assert.rejects(start,/unavailable/);assert.equal(motor.busy,false);
});
