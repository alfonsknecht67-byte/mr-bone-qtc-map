const test = require('node:test');
const assert = require('node:assert/strict');
const status = require('../docs/network-freshness.js');
const now = Date.parse('2026-10-16T23:55:00Z');
test('hourly source remains within cadence at 24 minutes and is overdue after 90', () => {
  const result = status({generated_at:'2026-10-16T23:30:59Z',publishing_interval_seconds:3600},now);
  assert.equal(result.fresh,true);
  assert.equal(result.ageLabel,'24 min old');
  assert.equal(result.cadenceLabel,'60 min');
  assert.equal(result.warning,'');
  assert.equal(status({generated_at:'2026-10-16T22:24:00Z'},now).fresh,false);
});
test('missing, future or invalid timestamps never imply current data', () => {
  assert.equal(status({},now).fresh,false);
  assert.equal(status({generated_at:'bad'},now).fresh,false);
  assert.equal(status({generated_at:'2026-10-17T01:00:00Z'},now).fresh,false);
});
test('declared faster sources use their own interval and invalid intervals fall back', () => {
  assert.equal(status({generated_at:'2026-10-16T23:50:00Z',publishing_interval_seconds:60},now).fresh,false);
  assert.equal(status({generated_at:'2026-10-16T23:30:59Z',publishing_interval_seconds:-1},now).fresh,true);
});
