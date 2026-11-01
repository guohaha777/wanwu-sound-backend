import test from 'node:test';
import assert from 'node:assert/strict';
import {ResultReceiver,RESULT_CHUNK_BYTES,MAX_RESULT_BYTES} from '../../src/browser/result-transfer.ts';

test('WAV IPC assembles bounded sequential binary chunks without dropping or duplicating bytes',()=>{
 const receiver=new ResultReceiver(),bytes=Uint8Array.from({length:RESULT_CHUNK_BYTES+73},(_,index)=>index%251);
 assert.equal(receiver.result,null);
 assert.equal(receiver.accept(bytes.length,0,bytes.subarray(0,RESULT_CHUNK_BYTES)),'accepted');
 assert.equal(receiver.result,null);
 assert.equal(receiver.accept(bytes.length,0,bytes.subarray(0,20)),'conflict');
 assert.equal(receiver.accept(bytes.length+1,RESULT_CHUNK_BYTES,bytes.subarray(RESULT_CHUNK_BYTES)),'conflict');
 assert.equal(receiver.accept(bytes.length,RESULT_CHUNK_BYTES,bytes.subarray(RESULT_CHUNK_BYTES)),'accepted');
 assert.deepEqual(receiver.result,bytes);
 assert.equal(receiver.accept(bytes.length,bytes.length,new Uint8Array([1])),'invalid');
});
test('WAV IPC rejects missing, oversized, fractional and out-of-order transfers before allocation',()=>{
 for(const [total,offset,chunk] of [[NaN,0,new Uint8Array(44)],[43,0,new Uint8Array(1)],
  [MAX_RESULT_BYTES+1,0,new Uint8Array(1)],[44,0,new Uint8Array(45)],
  [100,0.5,new Uint8Array(44)],[100,0,new Uint8Array(0)],
  [MAX_RESULT_BYTES,0,new Uint8Array(RESULT_CHUNK_BYTES+1)]] as const){
  const receiver=new ResultReceiver();
  assert.equal(receiver.accept(total,offset,chunk),'invalid');
  assert.equal(receiver.result,null);
 }
 const receiver=new ResultReceiver();
 assert.equal(receiver.accept(100,1,new Uint8Array(1)),'conflict');
 assert.equal(receiver.result,null);
});
