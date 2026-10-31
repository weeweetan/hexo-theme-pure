'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { search, tokenize } = require('../source/js/search-core.js');

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
