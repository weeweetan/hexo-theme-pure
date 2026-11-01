'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let explicitUpdated;
vm.runInNewContext(fs.readFileSync(require.resolve('../scripts/updated.js'), 'utf8'), {
  hexo: { extend: { helper: { register(name, fn) { explicitUpdated = fn; } } } }
});

test('only explicit content updates are shown, not clone-time filesystem timestamps', () => {
  const post = { date: new Date('2024-03-09'), updated: new Date('2026-10-30'), raw: '---\ntitle: Test\n---\nbody' };
  assert.equal(explicitUpdated(post), false);
  assert.equal(explicitUpdated({ ...post, raw: '---\ntitle: Test\nupdated: 2026-10-30\n---\nbody' }), true);
  assert.equal(explicitUpdated({ ...post, raw: '---\ntitle: Test\n---\nupdated: example in body' }), false);
});
