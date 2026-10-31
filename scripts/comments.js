'use strict';

// One predicate keeps the article link, container and third-party assets in sync.
hexo.extend.helper.register('pure_comments_enabled', function (post) {
  if (!post || post.comments === false) return false;
  var comment = this.theme.comment || {};
  var settings = comment[comment.type] || {};
  function present(value) {
    return typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
  }
  switch (comment.type) {
    case 'disqus': return present(comment.disqus);
    case 'youyan':
    case 'livere': return present(settings.uid);
    case 'valine': return present(settings.appid) && present(settings.appkey);
    case 'gitment': return ['githubID', 'repo', 'ClientID', 'ClientSecret'].every(function (key) { return present(settings[key]); });
    case 'gitalk': return ['owner', 'repo', 'ClientID', 'ClientSecret'].every(function (key) { return present(settings[key]); });
    default: return false;
  }
});
