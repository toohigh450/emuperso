import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameCapture, installRuntimeFrameHook } from '../frame-capture.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
  let reads = 0, resumes = 0, pauses = 0;
  const capture = createFrameCapture({ read: () => ++reads, resume: async () => { resumes++; },
    pause: async () => { pauses++; }, isPaused: () => true, isClosed: () => false,
    timeout: 100, ...options });
  return { ...capture, counts: () => ({ reads, resumes, pauses }) };
}
test('capture only at native frame boundary, with audio resume and pause restored', async () => {
  const f = fixture(), result = f.capture(); await tick();
  assert.deepEqual(f.counts(), { reads: 0, resumes: 1, pauses: 0 });
  f.onFrame(); assert.equal(await result, 1);
  assert.deepEqual(f.counts(), { reads: 1, resumes: 1, pauses: 1 });
});
test('concurrent captures serialize without replacing another pending request', async () => {
  const f = fixture(), a = f.capture(), b = f.capture(); await tick();
  f.onFrame(); assert.equal(await a, 1); await tick();
  f.onFrame(); assert.equal(await b, 2); assert.equal(f.counts().reads, 2);
});
test('a frontend iteration without native frame progress does not serialize', async () => {
  let frame = 12;
  const f = fixture({ frameNumber: () => frame }), result = f.capture(); await tick();
  f.onFrame(); assert.equal(f.counts().reads, 0);
  frame++; f.onFrame(); assert.equal(await result, 1);
});
test('missing native frame times out, does not read later, and allows retry', async () => {
  const f = fixture({ timeout: 10 });
  await assert.rejects(f.capture(), { code: 'E_CAPTURE_FRAME_TIMEOUT' });
  f.onFrame(); assert.equal(f.counts().reads, 0);
  const retry = f.capture(); await tick(); f.onFrame(); assert.equal(await retry, 1);
});
test('native read failure preserves the next capture and does not pause a running session', async () => {
  let fail = true;
  const f = fixture({ isPaused: () => false, read: () => { if (fail) throw new Error('native'); return 7; } });
  const a = f.capture(); await tick(); f.onFrame(); await assert.rejects(a, /native/);
  fail = false; const b = f.capture(); await tick(); f.onFrame(); assert.equal(await b, 7);
  assert.equal(f.counts().pauses, 0);
});
test('resume failure and close cancel pending work without a later native read', async () => {
  const broken = fixture({ resume: async () => { throw new Error('audio'); } });
  await assert.rejects(broken.capture(), /audio/); broken.onFrame(); assert.equal(broken.counts().reads, 0);
  let closed = false; const f = fixture({ isClosed: () => closed }), a = f.capture(); await tick();
  closed = true; f.cancel(); await assert.rejects(a, { code: 'E_SESSION_CLOSED' });
  await assert.rejects(f.capture(), { code: 'E_SESSION_CLOSED' });
  f.onFrame(); assert.equal(f.counts().reads, 0); assert.equal(f.counts().pauses, 0);
});
test('runtime receives hook before initialization, preserving prior callback exactly once', () => {
  const target = {}, calls = []; installRuntimeFrameHook(target, () => calls.push('capture'));
  target.EJS_Runtime = options => { options.postMainLoop(); return options.other; };
  target.EJS_Runtime = target.EJS_Runtime;
  assert.equal(target.EJS_Runtime({ other: 42, postMainLoop: () => calls.push('original') }), 42);
  assert.deepEqual(calls, ['original', 'capture']);
});
