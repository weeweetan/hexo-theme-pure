'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { search, tokenize, snippet, highlight, sectionFor } = require('../source/js/search-core.js');

test('tokenizes whitespace-separated Chinese and Latin search terms', () => {
  assert.deepEqual(tokenize('  Nginx\t日志  模块 '), ['NGINX', '日志', '模块']);
  assert.deepEqual(tokenize(' \n\t '), []);
});

test('matches search punctuation literally without constructing a regular expression', () => {
  const index = {
    posts: [
      { title: 'C[17] parser', text: 'Use a + b and dots.' },
      { title: 'C17 parser', text: 'Different example' }
    ],
    pages: []
  };

  assert.deepEqual(search(index, '[').posts.map((post) => post.title), ['C[17] parser']);
  assert.deepEqual(search(index, 'a + b').posts.map((post) => post.title), ['C[17] parser']);
  assert.deepEqual(search(index, '.').posts.map((post) => post.title), ['C[17] parser']);
});

test('matches every query term across a post title and body, ignoring case', () => {
  const index = {
    posts: [
      { title: 'Nginx Mirror', text: '配置回源策略' },
      { title: 'nginx proxy', text: '缓存设置' },
      { title: 'Nginx', text: 'mirror configuration' }
    ],
    pages: []
  };

  assert.deepEqual(search(index, 'NGINX 配置').posts.map((post) => post.title), ['Nginx Mirror']);
  assert.deepEqual(search(index, 'nginx MIRROR').posts.map((post) => post.title), [
    'Nginx Mirror',
    'Nginx'
  ]);
});

test('ranks title matches ahead of body matches and retains source order for ties', () => {
  const index = {
    posts: [
      { title: 'Notes', text: 'nginx' },
      { title: 'Nginx guide', text: 'reference' },
      { title: 'Nginx tips', text: 'reference' }
    ],
    pages: []
  };

  assert.deepEqual(search(index, 'nginx').posts.map((post) => post.title), [
    'Nginx guide',
    'Nginx tips',
    'Notes'
  ]);
});

test('returns bounded results and de-duplicates categories and tags by name', () => {
  const posts = Array.from({ length: 7 }, (_, index) => ({
    title: `Nginx guide ${index}`,
    text: '',
    categories: [{ name: 'Nginx', slug: 'nginx', permalink: '/categories/Nginx/' }],
    tags: [{ name: 'Nginx', slug: 'nginx', permalink: '/tags/Nginx/' }]
  }));

  const result = search({ posts, pages: [] }, 'nginx');
  assert.equal(result.posts.length, 5);
  assert.equal(result.categories.length, 1);
  assert.equal(result.tags.length, 1);
});

test('empty queries and missing index arrays return no matches safely', () => {
  assert.deepEqual(search({ posts: [], pages: [] }, '  '), {
    posts: [],
    pages: [],
    categories: [],
    tags: []
  });
  assert.deepEqual(search({}, 'Nginx'), {
    posts: [],
    pages: [],
    categories: [],
    tags: []
  });
});

test('snippets reveal body matches beyond the introduction and highlight literal text safely', () => {
  const text = '开头说明。'.repeat(100) + '观察 runqlat 的延迟分布。' + '后续内容。'.repeat(100);
  const result = snippet(text, 'runqlat');
  assert.ok(result.includes('runqlat'));
  assert.ok(result.startsWith('…') && result.endsWith('…'));
  assert.ok(result.length <= 162);
  assert.deepEqual(highlight('<img src=x> C[17]', '['), [
    { text: '<img src=x> C', match: false }, { text: '[', match: true }, { text: '17]', match: false }
  ]);
});

test('section results link to matching chapters, with article fallback for old indexes and title-only queries', () => {
  const post = { title: 'Nginx 笔记', text: '简介。调度 runqlat 延迟。磁盘 biolatency。', sections: [
    { title: '调度', id: 'CPU', start: 3, end: 17 },
    { title: '磁盘', id: '磁盘', start: 17, end: 30 }
  ] };
  post.sections[1].end = post.text.length;
  assert.equal(sectionFor(post, 'Nginx runqlat').id, 'CPU');
  assert.equal(sectionFor(post, 'biolatency').id, '磁盘');
  assert.equal(sectionFor(post, 'Nginx'), null);
  assert.equal(sectionFor({ title: 'old', text: 'runqlat' }, 'runqlat'), null);
  assert.equal(sectionFor({ ...post, sections: [{ id: 'bad', start: -1, end: 999 }] }, 'runqlat'), null);
});
