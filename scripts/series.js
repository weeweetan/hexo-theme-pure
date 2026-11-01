'use strict';

hexo.extend.helper.register('pure_series', function (key) {
  const series = (this.site.data.series || {})[key];
  if (!series) return null;
  const posts = this.site.posts.toArray();
  const groups = series.groups.map(group => ({
    title: group.title,
    posts: group.posts.map(source => {
      const post = posts.find(post => post.source === '_posts/' + source);
      if (!post) throw new Error('Series article not found: ' + source);
      return post;
    })
  }));
  return { ...series, groups, posts: groups.flatMap(group => group.posts) };
});

hexo.extend.helper.register('pure_series_navigation', function (post) {
  for (const key of Object.keys(this.site.data.series || {})) {
    const series = this.pure_series(key);
    const index = series.posts.findIndex(item => item.path === post.path);
    if (index >= 0) return { title: series.title, path: series.path, position: index + 1, total: series.posts.length,
      previous: series.posts[index - 1], next: series.posts[index + 1] };
  }
  return null;
});
