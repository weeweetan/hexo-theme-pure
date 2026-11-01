'use strict';

// Hexo otherwise uses file mtime, which changes when cloning on another machine.
hexo.extend.helper.register('pure_explicit_updated', function (post) {
  const front = String(post.raw || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return !!(front && /^updated\s*:\s*\S/m.test(front[1]) && post.updated &&
    Number.isFinite(Number(post.updated)) && Number(post.updated) > Number(post.date));
});
