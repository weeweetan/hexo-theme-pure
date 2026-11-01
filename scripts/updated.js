'use strict';

// Hexo otherwise uses file mtime, which changes when cloning on another machine.
hexo.extend.helper.register('pure_explicit_updated', function (post) {
  const front = String(post.raw || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const field = front && front[1].match(/^updated[ \t]*:[ \t]*([^\r\n]*)/m);
  const value = field && field[1].trim();
  return !!(value && !value.startsWith('#') && post.updated &&
    Number.isFinite(Number(post.updated)) && Number(post.updated) > Number(post.date));
});
