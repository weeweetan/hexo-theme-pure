# Theme regression checks

Run the search unit tests without installing theme dependencies:

```sh
node --test tests/search.test.cjs
```

Generate a Hexo site using this theme and the JSON-content, feed and sitemap
generators, then run the browser checks with an installed Playwright runtime:

```sh
BLOG_DIST=/absolute/path/to/blog/public \
PLAYWRIGHT_MODULE=/absolute/path/to/node_modules/playwright \
CHANNEL=chrome \
node tests/browser-smoke.cjs
```

Alternatively, set `CHROMIUM_PATH` to a Chromium executable. If neither browser
option is supplied, the script uses Playwright's installed Chromium. Screenshots
go to the temporary `blog-qa` directory unless `SCREENSHOT_DIR` is supplied.

The smoke check starts a local HTTP server, blocks external requests, and checks
search caching/retry/keyboard behavior, local core assets, article navigation,
desktop/mobile TOC, code copying/wrapping/collapsing, reading mode, tables and
generated feed/sitemap data. It does not deploy or write to the generated site.
