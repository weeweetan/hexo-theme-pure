#!/usr/bin/env node
'use strict';

// Read-only browser smoke checks for a generated Hexo directory.
// Required: BLOG_DIST=/path/to/public
// Optional: PLAYWRIGHT_MODULE, CHROMIUM_PATH, CHANNEL, ARTICLE_PATH,
//           SCREENSHOT_DIR, PORT, HEADLESS
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const siteRoot = process.env.BLOG_DIST ? path.resolve(process.env.BLOG_DIST) : null;
const screenshotDir = process.env.SCREENSHOT_DIR || path.join(os.tmpdir(), 'blog-qa');
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8'
};

function getPlaywright() {
  try {
    return require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  } catch (error) {
    throw new Error('Install Playwright or set PLAYWRIGHT_MODULE. ' + error.message);
  }
}

function walkFiles(directory) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) return [];
    if (entry.isDirectory()) return walkFiles(absolute);
    return entry.isFile() ? [absolute] : [];
  });
}

function pathFromUrl(value) {
  try {
    let pathname = new URL(value, 'http://hexo.local').pathname;
    pathname = decodeURIComponent(pathname);
    return pathname.startsWith('/') ? pathname : '/' + pathname;
  } catch {
    return null;
  }
}

function normalizedUrlPath(value) {
  const pathname = pathFromUrl(value) || '/';
  const normalized = pathname.replace(/\/index\.html?$/i, '/').replace(/\/+/g, '/');
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : '/';
}

function fileForUrlPath(urlPath) {
  if (!urlPath || !siteRoot) return null;
  const cleanPath = urlPath.split(/[?#]/, 1)[0];
  const candidate = path.resolve(siteRoot, '.' + cleanPath);
  const relative = path.relative(siteRoot, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const options = [candidate];
  if (!path.extname(candidate)) {
    options.push(path.join(candidate, 'index.html'));
    options.push(candidate + '.html');
  }
  for (const option of options) {
    try {
      if (fs.statSync(option).isFile()) return option;
      if (fs.statSync(option).isDirectory() && fs.statSync(path.join(option, 'index.html')).isFile()) {
        return path.join(option, 'index.html');
      }
    } catch {
      // Try the next generated-file convention.
    }
  }
  return null;
}

function urlPathForFile(file) {
  const relative = path.relative(siteRoot, file).split(path.sep).join('/');
  if (relative === 'index.html') return '/';
  if (relative.endsWith('/index.html')) return '/' + relative.slice(0, -'index.html'.length);
  return '/' + relative;
}

function readContentIndex() {
  const file = path.join(siteRoot, 'content.json');
  assert.ok(fs.existsSync(file), 'Generated site must contain content.json at its root');
  let index;
  try {
    index = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error('content.json is not valid JSON: ' + error.message);
  }
  assert.ok(index && Array.isArray(index.posts) && Array.isArray(index.pages), 'content.json must expose posts and pages arrays');
  return index;
}

function pageFeatures(file, metadata) {
  const html = fs.readFileSync(file, 'utf8');
  const titleMatch = html.match(/<h1[^>]*class=["'][^"']*article-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
  const title = (metadata && metadata.title) || (titleMatch ? titleMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : path.basename(path.dirname(file)));
  const isArticle = /article-type-post/.test(html) && /<article\b/i.test(html);
  const hasToc = /id=["']collapseToc["']/.test(html) && /id=["']toc["']/.test(html);
  const hasCode = /<pre\b/i.test(html);
  const bodyStart = html.indexOf('article-entry');
  const bodyEnd = html.indexOf('article-footer', bodyStart);
  const bodyHtml = bodyStart >= 0 ? html.slice(bodyStart, bodyEnd >= 0 ? bodyEnd : undefined) : '';
  const withoutCodeTables = bodyHtml
    .replace(/<figure\b[^>]*class=["'][^"']*\bhighlight\b[^"']*["'][^>]*>[\s\S]*?<\/figure>/gi, '')
    .replace(/<div\b[^>]*class=["'][^"']*\bhighlight\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
  const hasTable = /<table\b/i.test(withoutCodeTables);
  const bpf = /bpf|BPF之巅|BPF之巔/i.test(title + ' ' + file);
  const longCode = (html.match(/<pre\b[\s\S]*?<\/pre>/gi) || []).some(block => (block.match(/\n/g) || []).length >= 18);
  return { file, title, isArticle, hasToc, hasCode, hasTable, bpf, longCode };
}

function discoverArticles(index) {
  const files = walkFiles(siteRoot).filter(file => file.endsWith('.html'));
  const metadataByPath = new Map();
  for (const post of index.posts.concat(index.pages)) {
    if (post && typeof post.path === 'string') {
      metadataByPath.set(normalizedUrlPath(post.path), post);
    }
  }

  const candidates = [];
  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    if (!/article-type-post/.test(html) || !/<article\b/i.test(html)) continue;
    const urlPath = urlPathForFile(file);
    const metadata = metadataByPath.get(normalizedUrlPath(urlPath));
    candidates.push({ ...pageFeatures(file, metadata), urlPath });
  }
  assert.ok(candidates.length, 'Could not find a generated article page in BLOG_DIST');

  if (process.env.ARTICLE_PATH) {
    const urlPath = pathFromUrl(process.env.ARTICLE_PATH);
    const file = fileForUrlPath(urlPath);
    assert.ok(file, 'ARTICLE_PATH does not map to a generated HTML file: ' + process.env.ARTICLE_PATH);
    const explicit = pageFeatures(file, metadataByPath.get(normalizedUrlPath(urlPath)));
    assert.ok(explicit.isArticle, 'ARTICLE_PATH is not a generated post page');
    explicit.urlPath = urlPath;
    candidates.unshift(explicit);
  }

  const score = candidate =>
    (candidate.bpf ? 100000 : 0) +
    (candidate.hasToc ? 10000 : 0) +
    (candidate.hasCode ? 1000 : 0) +
    (candidate.hasTable ? 100 : 0) +
    (candidate.longCode ? 10 : 0);
  candidates.sort((a, b) => score(b) - score(a));
  return {
    primary: candidates[0],
    code: candidates.find(candidate => candidate.hasCode && candidate.longCode) ||
      candidates.find(candidate => candidate.hasCode),
    table: candidates.find(candidate => candidate.hasTable)
  };
}

function xmlArtifacts() {
  const xmlFiles = walkFiles(siteRoot).filter(file => /\.xml$/i.test(file));
  const rss = xmlFiles.find(file => {
    const text = fs.readFileSync(file, 'utf8');
    return /<(rss|feed)(\s|>)/i.test(text);
  });
  const sitemap = xmlFiles.find(file => {
    const text = fs.readFileSync(file, 'utf8');
    return /<(urlset|sitemapindex)(\s|>)/i.test(text);
  });
  assert.ok(rss, 'Generated site must include an RSS/Atom XML feed');
  assert.ok(sitemap, 'Generated site must include a sitemap XML document');
  return { rss, sitemap };
}

function createServer(state) {
  return http.createServer((request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    } catch {
      state.serverErrors.push('400 invalid path');
      response.writeHead(400).end('Invalid URL');
      return;
    }

    const file = fileForUrlPath(pathname);
    if (!file) {
      state.serverErrors.push('404 ' + pathname);
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }

    try {
      const stat = fs.statSync(file);
      response.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': mimeTypes[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      if (request.method === 'HEAD') response.end();
      else fs.createReadStream(file).pipe(response);
    } catch (error) {
      state.serverErrors.push('500 ' + pathname + ': ' + error.message);
      response.writeHead(500).end('Read error');
    }
  });
}

function attachObservers(page, label, state, options) {
  const settings = options || {};
  page.on('pageerror', error => state.pageErrors.push(label + ': ' + error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    const location = message.location().url || '';
    let isExternalLocation = false;
    try {
      isExternalLocation = location && new URL(location).origin !== state.origin;
    } catch {
      // Browser-generated errors can have empty or non-URL locations.
    }
    if (isExternalLocation || /ERR_BLOCKED_BY_CLIENT|ERR_ABORTED/.test(text)) return;
    if (settings.allowContent503 && /503 \(Service Unavailable\)/i.test(text)) return;
    state.consoleErrors.push(label + ': ' + text);
  });
  page.on('request', request => {
    const url = request.url();
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (parsed.origin === state.origin) {
      state.localRequests.add(parsed.pathname);
      return;
    }
    const record = { url, type: request.resourceType() };
    state.externalRequests.push(record);
    if (/disqus|livere|uyan|youyan|gitment|gitalk|valine|leancloud|twikoo|waline|giscus|utteranc/i.test(url)) {
      state.commentSdkRequests.push(url);
    }
  });
  page.on('response', response => {
    const url = response.url();
    if (new URL(url).origin !== state.origin || response.status() < 400) return;
    if (settings.allowContent503 && response.status() === 503 && /content\.json(?:$|\?)/.test(url)) return;
    state.httpErrors.push(label + ': ' + response.status() + ' ' + new URL(url).pathname);
  });
}

async function blockExternalRequests(context, state) {
  await context.route('**/*', async route => {
    const requestUrl = route.request().url();
    let target;
    try {
      target = new URL(requestUrl);
    } catch {
      return route.abort();
    }
    if (target.origin !== state.origin) {
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
}

async function installClipboardSpy(context) {
  await context.addInitScript(() => {
    window.__smokeClipboardWrites = [];
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText(value) {
            window.__smokeClipboardWrites.push(String(value));
            return Promise.resolve();
          }
        }
      });
    } catch {
      // If an engine prevents replacement, the browser permission path can still work.
    }
  });
}

async function assertNoHorizontalOverflow(page, label) {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0)
  }));
  assert.ok(widths.document <= widths.viewport + 1, label + ' overflows horizontally: ' + widths.document + 'px > ' + widths.viewport + 'px');
}

async function waitForMobileNavigation(page, expanded) {
  await page.waitForFunction(expected => {
    const toggle = document.querySelector('.navbar-toggle');
    const menu = document.querySelector('#main-navbar');
    return toggle && menu &&
      toggle.getAttribute('aria-expanded') === expected &&
      !menu.classList.contains('collapsing');
  }, expanded ? 'true' : 'false', { timeout: 5000 });
}

async function waitForSearchSettled(page) {
  await page.waitForFunction(() => {
    const root = document.querySelector('.ins-search .ins-section-container');
    if (!root) return false;
    const status = root.querySelector('.ins-search-status');
    return root.querySelector('.ins-search-item') || (status && !/正在加载|loading/i.test(status.textContent));
  }, undefined, { timeout: 10000 });
}

function makeState() {
  return {
    origin: '',
    serverErrors: [],
    pageErrors: [],
    consoleErrors: [],
    httpErrors: [],
    localRequests: new Set(),
    externalRequests: [],
    commentSdkRequests: []
  };
}

function assertBrowserIsClean(state) {
  assert.deepEqual(state.serverErrors, [], 'Local server errors');
  assert.deepEqual(state.httpErrors, [], 'Local HTTP errors');
  assert.deepEqual(state.pageErrors, [], 'Uncaught page errors');
  assert.deepEqual(state.consoleErrors, [], 'Unexpected browser console errors');
}

async function checkGeneratedArtifacts(page, origin, index, primary, xml) {
  const rssPath = urlPathForFile(xml.rss);
  const sitemapPath = urlPathForFile(xml.sitemap);
  const rss = await page.request.get(new URL(rssPath, origin).href);
  const sitemap = await page.request.get(new URL(sitemapPath, origin).href);
  assert.equal(rss.status(), 200, 'RSS/Atom feed should be served');
  assert.equal(sitemap.status(), 200, 'Sitemap should be served');

  const rssText = await rss.text();
  const sitemapText = await sitemap.text();
  assert.match(rssText, /<(rss|feed)(\s|>)/i, 'RSS/Atom endpoint should contain an XML feed');
  assert.match(sitemapText, /<(urlset|sitemapindex)(\s|>)/i, 'Sitemap endpoint should contain sitemap XML');
  const postPaths = index.posts.map(post => post && typeof post.path === 'string' ? normalizedUrlPath(post.path) : null);
  assert.ok(postPaths.includes(normalizedUrlPath(primary.urlPath)), 'content.json should include the selected nested article');
  const sitemapPaths = Array.from(sitemapText.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)).map(match => {
    const value = match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    return normalizedUrlPath(value);
  });
  assert.ok(sitemapPaths.includes(normalizedUrlPath(primary.urlPath)), 'Sitemap should include the selected article');
}

async function checkArchiveCommentLinks(page, origin) {
  assert.equal(await page.locator('.article-comment-link').count(), 0, 'Homepage should not show dead article-comment links when comments are disabled');
  const navLinks = await page.locator('#main-navbar .main-nav a[href]').evaluateAll(anchors => anchors.map(anchor => ({
    href: anchor.href,
    text: anchor.textContent.trim()
  })));
  const archive = navLinks.find(link => /archive|归档/i.test(link.href + ' ' + link.text) && (() => {
    try {
      const url = new URL(link.href);
      return url.origin === origin && !!fileForUrlPath(decodeURIComponent(url.pathname));
    } catch {
      return false;
    }
  })());
  const archivePath = archive ? new URL(archive.href).pathname : ['/archives/', '/archive/'].find(candidate => !!fileForUrlPath(candidate));
  assert.ok(archivePath, 'Generated site should expose an archive page for comment-link checks');
  const response = await page.goto(new URL(archivePath, origin).href, { waitUntil: 'domcontentloaded' });
  assert.ok(response && response.status() === 200, 'Archive page should load');
  assert.equal(await page.locator('.article-comment-link').count(), 0, 'Archive should not render dead article-comment links when comments are disabled');
}

async function exerciseSearch(page, state, primary) {
  const trigger = page.locator('.search-form-input:visible').first();
  assert.ok(await trigger.count(), 'Search trigger should be visible');
  const dialog = page.locator('.ins-search');
  const input = dialog.locator('.ins-search-input');
  let contentRequests = 0;
  page.on('request', request => {
    if (/\/content\.json(?:$|\?)/.test(new URL(request.url()).pathname + new URL(request.url()).search)) contentRequests += 1;
  });

  const indexResponse = page.waitForResponse(response =>
    new URL(response.url()).origin === state.origin &&
    /\/content\.json(?:$|\?)/.test(new URL(response.url()).pathname + new URL(response.url()).search),
  { timeout: 10000 });
  await trigger.click();
  await dialog.waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(await dialog.getAttribute('role'), 'dialog', 'Search should expose dialog semantics');
  assert.equal(await dialog.getAttribute('aria-modal'), 'true', 'Search dialog should be modal');
  await indexResponse;

  const query = primary.title.trim();
  assert.ok(query, 'Selected article needs a title to test search');
  await input.fill(query);
  await waitForSearchSettled(page);
  assert.ok(await dialog.locator('.ins-search-item').count(), 'A title search should return a result');
  assert.equal(contentRequests, 1, 'Opening/searching should fetch content.json once');

  const special = '[.*+?()\\\\]';
  await input.fill(special);
  await waitForSearchSettled(page);
  assert.ok(await dialog.locator('.ins-search-item, .ins-search-status').count(), 'Special-character search should render a result state');
  assert.equal(state.pageErrors.length, 0, 'Special characters must not cause a browser exception');

  const missing = '__browser_smoke_no_match_' + Date.now() + '__';
  await input.fill(missing);
  await waitForSearchSettled(page);
  const noResultsMessage = await page.evaluate(() => window.INSIGHT_CONFIG && window.INSIGHT_CONFIG.MESSAGES && window.INSIGHT_CONFIG.MESSAGES.NO_RESULTS);
  const statusText = await dialog.locator('.ins-search-status').innerText();
  assert.ok(statusText.includes(noResultsMessage || '没有找到'), 'No-result search should show the configured empty state');

  await input.fill(query);
  await waitForSearchSettled(page);
  const resultLinks = dialog.locator('.ins-search-item');
  const resultCount = await resultLinks.count();
  assert.ok(resultCount > 0, 'Results should be available for keyboard testing');
  await resultLinks.nth(resultCount - 1).evaluate(element => element.focus());
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('ins-search-input')), true, 'Tab from the final result should wrap to search input');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('ins-search-item')), true, 'Shift+Tab from the first control should wrap to the final result');

  await page.screenshot({ path: path.join(screenshotDir, 'desktop-search.png'), fullPage: true });
  await page.keyboard.press('Escape');
  assert.equal(await dialog.getAttribute('aria-hidden'), 'true', 'Escape should close search');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('search-form-input')), true, 'Escape should restore focus to the trigger');

  await trigger.click();
  await input.fill(query);
  await waitForSearchSettled(page);
  assert.equal(contentRequests, 1, 'Closing and reopening search should reuse the fetched content.json');
  const firstResult = dialog.locator('.ins-search-item').first();
  const resultPath = normalizedUrlPath(await firstResult.getAttribute('href'));
  assert.equal(resultPath, normalizedUrlPath(primary.urlPath), 'Search result should link to the selected nested article');
  await Promise.all([
    page.waitForURL(url => normalizedUrlPath(url.pathname) === normalizedUrlPath(primary.urlPath), { timeout: 10000 }),
    firstResult.click()
  ]);
  assert.ok(await page.locator('article.article-type-post').isVisible(), 'Search result navigation should open a nested article');
  await page.screenshot({ path: path.join(screenshotDir, 'desktop-article-top.png') });
}

async function headingTargetMetrics(page, link, expectFocus) {
  const href = await link.getAttribute('href');
  const id = href ? decodeURIComponent(new URL(href, page.url()).hash.slice(1)) : '';
  assert.ok(id, 'TOC link should point to a heading anchor');
  await link.click();
  if (expectFocus) {
    await page.waitForFunction(targetId => {
      const target = document.getElementById(targetId);
      return target && document.activeElement && (target === document.activeElement || target.contains(document.activeElement));
    }, id, { timeout: 5000 });
  } else {
    await page.waitForFunction(targetId => {
      try { return decodeURIComponent(location.hash.slice(1)) === targetId; }
      catch { return location.hash.slice(1) === targetId; }
    }, id, { timeout: 5000 });
  }
  await page.waitForFunction(() => !!document.querySelector('#collapseToc a.is-current[aria-current="location"]'), undefined, { timeout: 5000 });
  const metrics = await page.evaluate(targetId => {
    const target = document.getElementById(targetId);
    const header = document.querySelector('.header');
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    const headerRect = header ? header.getBoundingClientRect() : null;
    const headerStyle = header ? getComputedStyle(header) : null;
    const overlapsHorizontally = !!headerRect && rect.left < headerRect.right && rect.right > headerRect.left;
    const stickyHeader = !!header && headerStyle && /fixed|sticky/.test(headerStyle.position) &&
      headerRect && headerRect.bottom > 0 && overlapsHorizontally;
    return {
      targetTop: rect.top,
      targetBottom: rect.bottom,
      headerBottom: stickyHeader ? headerRect.bottom : 0,
      fixedHeader: stickyHeader
    };
  }, id);
  assert.ok(metrics, 'Heading target should still exist after TOC navigation');
  if (metrics.fixedHeader) {
    assert.ok(metrics.targetTop >= metrics.headerBottom - 1, 'TOC jump should leave the heading below the sticky header');
  } else {
    assert.ok(metrics.targetTop >= -1, 'TOC jump should leave the target heading in the viewport');
  }
}

async function exerciseDesktopTocAndReading(page, primary) {
  const toc = page.locator('aside#collapseToc[data-reading-toc]');
  assert.equal(await toc.count(), 1, 'Article should render the reading TOC container');
  const toggle = page.locator('button[data-reading-toc-toggle]');
  assert.ok(await toggle.count(), 'Article should render an accessible TOC toggle');
  assert.equal(await page.locator('.reading-toc-toggle').isVisible(), false, 'The mobile TOC toggle should not be visible on desktop');
  if (!(await toc.isVisible())) {
    await toggle.click();
    await toc.waitFor({ state: 'visible', timeout: 5000 });
  }
  const tocLinks = toc.locator('a[href^="#"]');
  assert.ok(await tocLinks.count(), 'Article TOC should contain heading links');
  assert.doesNotMatch(await tocLinks.first().innerText(), /阅读导航/, 'TOC should omit the hidden manual navigation heading');
  await headingTargetMetrics(page, toc.locator('a[href^="#"]').first(), false);
  await page.screenshot({ path: path.join(screenshotDir, 'desktop-article-toc.png'), fullPage: true });

  const mode = page.locator('[data-reading-mode-toggle]');
  assert.ok(await mode.count(), 'Article should provide a reading mode control');
  const widthButton = page.locator('[data-reading-width]');
  assert.ok(await widthButton.count(), 'Article should provide a reading-width control');
  assert.equal(await widthButton.isVisible(), false, 'Reading-width control should be hidden outside reading mode');
  await mode.click();
  assert.ok(await page.locator('body.reading-mode').count(), 'Reading mode should activate the body state');
  assert.equal(await mode.getAttribute('aria-pressed'), 'true', 'Reading mode should expose its pressed state');
  assert.equal(await widthButton.isVisible(), true, 'Reading-width control should appear in reading mode');
  await page.screenshot({ path: path.join(screenshotDir, 'desktop-reading-mode.png') });
  await mode.click();
  assert.equal(await page.locator('body.reading-mode').count(), 0, 'Reading mode should be exit-able');
  assert.equal(await mode.getAttribute('aria-pressed'), 'false', 'Reading mode should clear its pressed state');
}

async function exerciseCodeControls(page, codeCandidate) {
  if (normalizedUrlPath(page.url()) !== normalizedUrlPath(codeCandidate.urlPath)) {
    await page.goto(new URL(codeCandidate.urlPath, page.url()).href, { waitUntil: 'domcontentloaded' });
  }

  const copy = page.locator('[data-reading-code-copy]').first();
  assert.ok(await copy.count(), 'Code blocks should expose a copy control');
  const expectedText = await copy.evaluate(element => {
    const root = element.closest('[data-reading-code-block]') ||
      element.closest('.highlight') ||
      element.closest('pre') ||
      element.parentElement;
    const codePre = root.querySelector('.highlight td.code pre') ||
      root.querySelector('pre code') ||
      root.querySelector('pre');
    return codePre ? codePre.textContent.replace(/\r\n/g, '\n').replace(/\n+$/, '') : '';
  });
  assert.ok(expectedText, 'A code block should expose copyable source text');
  await copy.click();
  const status = page.locator('[data-reading-copy-status]').first();
  await status.waitFor({ state: 'attached', timeout: 3000 });
  await page.waitForFunction(() => {
    const statusNode = document.querySelector('[data-reading-copy-status]');
    return statusNode && statusNode.textContent.trim();
  }, undefined, { timeout: 3000 });
  await page.waitForFunction(() => window.__smokeClipboardWrites && window.__smokeClipboardWrites.length > 0, undefined, { timeout: 3000 });
  const copied = await page.evaluate(() => window.__smokeClipboardWrites[window.__smokeClipboardWrites.length - 1]);
  assert.equal(copied.replace(/\r\n/g, '\n').replace(/\n+$/, ''), expectedText, 'Copy must include source code only and exclude line-number gutters');
  assert.ok((await status.textContent()).trim(), 'Copy action should report an accessible status');

  const wrap = page.locator('[data-reading-code-wrap]').first();
  assert.ok(await wrap.count(), 'Code blocks should expose a line-wrap control');
  const originalWrap = await wrap.getAttribute('aria-pressed');
  await wrap.click();
  assert.notEqual(await wrap.getAttribute('aria-pressed'), originalWrap, 'Line-wrap control should toggle its aria-pressed state');
  await wrap.click();
  assert.equal(await wrap.getAttribute('aria-pressed'), originalWrap, 'Line-wrap control should restore its prior state');

  const expand = page.locator('[data-reading-code-expand]').first();
  assert.ok(await expand.count(), 'Long code blocks should expose an expand/collapse control');
  const originalExpanded = await expand.getAttribute('aria-expanded');
  const isCodeCollapsed = () => expand.evaluate(element => {
    const container = element.closest('[data-reading-code-block]');
    return !!container && container.classList.contains('is-collapsed');
  });
  const originalCollapsed = await isCodeCollapsed();
  await expand.click();
  assert.notEqual(await expand.getAttribute('aria-expanded'), originalExpanded, 'Long code block should expand or collapse');
  assert.notEqual(
    await isCodeCollapsed(),
    originalCollapsed,
    'Long code block should toggle its collapsed presentation'
  );
  await expand.click();
  assert.equal(await expand.getAttribute('aria-expanded'), originalExpanded, 'Long code block should return to its original state');
  assert.equal(
    await isCodeCollapsed(),
    originalCollapsed,
    'Long code block should restore its original collapsed presentation'
  );
  await page.screenshot({ path: path.join(screenshotDir, 'desktop-code-controls.png'), fullPage: true });
}

async function exerciseMobile(browser, origin, primary, tableCandidate, state) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });
  await blockExternalRequests(context, state);
  await installClipboardSpy(context);
  const page = await context.newPage();
  attachObservers(page, 'mobile', state);
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await page.locator('main').waitFor({ state: 'visible' });
  assert.ok(await page.evaluate(() => !!(window.jQuery && window.jQuery.fn)), 'Local jQuery fallback should work on mobile with external CDNs blocked');
  await assertNoHorizontalOverflow(page, 'Mobile home');
  const viewportMeta = await page.locator('meta[name="viewport"]').getAttribute('content');
  assert.ok(!/maximum-scale\s*=\s*1|user-scalable\s*=\s*no/i.test(viewportMeta || ''), 'Mobile pages must permit pinch zoom');
  await page.screenshot({ path: path.join(screenshotDir, 'mobile-home.png'), fullPage: true });

  const menuToggle = page.locator('.navbar-toggle');
  assert.ok(await menuToggle.count(), 'Mobile navigation toggle should exist');
  await menuToggle.click();
  await waitForMobileNavigation(page, true);
  assert.equal(await menuToggle.getAttribute('aria-expanded'), 'true', 'Mobile navigation should open with external CDNs blocked');
  assert.ok(await page.locator('#main-navbar').isVisible(), 'Expanded mobile navigation should be visible');
  await menuToggle.click();
  await waitForMobileNavigation(page, false);
  assert.equal(await menuToggle.getAttribute('aria-expanded'), 'false', 'Mobile navigation should close again');

  await page.goto(new URL(primary.urlPath, origin).href, { waitUntil: 'domcontentloaded' });
  assert.ok(await page.locator('article.article-type-post').isVisible(), 'Nested article should load on mobile');
  assert.ok(await page.evaluate(() => !!(window.jQuery && window.jQuery.fn)), 'Local jQuery should load on a nested article with external CDNs blocked');
  await page.screenshot({ path: path.join(screenshotDir, 'mobile-article-top.png') });
  await page.locator('.navbar-toggle').click();
  await waitForMobileNavigation(page, true);
  assert.equal(await page.locator('.navbar-toggle').getAttribute('aria-expanded'), 'true', 'Mobile navigation should work on a nested article without external CDNs');
  await page.locator('.navbar-toggle').click();
  await waitForMobileNavigation(page, false);
  await assertNoHorizontalOverflow(page, 'Mobile article');
  const toc = page.locator('aside#collapseToc[data-reading-toc]');
  const toggle = page.locator('button[data-reading-toc-toggle]');
  assert.ok(await toc.count(), 'Mobile article should render its TOC drawer');
  const firstTocText = await toc.locator('a[href^="#"]').first().innerText();
  assert.match(firstTocText, /第二章/, 'The first mobile TOC entry should be the first chapter heading');
  assert.doesNotMatch(firstTocText, /阅读导航/, 'Mobile TOC should omit the manual navigation heading');
  await toggle.click();
  assert.ok(await toc.evaluate(element => element.classList.contains('is-mobile-open')), 'Mobile TOC should open as a drawer');
  assert.ok(await page.locator('body.reading-toc-open').count(), 'Open mobile TOC should lock the page backdrop');
  assert.equal(await toc.getAttribute('aria-hidden'), 'false', 'Open mobile TOC should be exposed to assistive technology');
  assert.equal(await toc.getAttribute('role'), 'dialog', 'Open mobile TOC should have dialog semantics');
  assert.equal(await toc.getAttribute('aria-modal'), 'true', 'Open mobile TOC should be modal');
  await page.keyboard.press('Escape');
  assert.ok(!(await toc.evaluate(element => element.classList.contains('is-mobile-open'))), 'Escape should close mobile TOC');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.matches('[data-reading-toc-toggle]')), true, 'Escape should restore focus to the TOC toggle');

  await toggle.click();
  await headingTargetMetrics(page, toc.locator('a[href^="#"]').first(), true);
  assert.ok(!(await toc.evaluate(element => element.classList.contains('is-mobile-open'))), 'Selecting a mobile TOC heading should close the drawer');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.matches('[data-reading-toc-toggle]')), false, 'TOC navigation should move focus to its heading');
  await assertNoHorizontalOverflow(page, 'Mobile article after TOC navigation');
  await page.screenshot({ path: path.join(screenshotDir, 'mobile-article-toc.png'), fullPage: true });

  if (normalizedUrlPath(primary.urlPath) !== normalizedUrlPath(tableCandidate.urlPath)) {
    await page.goto(new URL(tableCandidate.urlPath, origin).href, { waitUntil: 'domcontentloaded' });
  }
  const bodyTables = page.locator('article.article-type-post .article-entry table');
  const tableCount = await bodyTables.evaluateAll(tables => tables.filter(table => !table.closest('.highlight')).length);
  assert.ok(tableCount > 0, 'A generated article should contain a body table for mobile layout checks');
  await assertNoHorizontalOverflow(page, 'Mobile article table');
  const tableBounds = await bodyTables.evaluateAll(tables => {
    const table = tables.find(element => !element.closest('.highlight'));
    if (!table) return null;
    const rect = table.getBoundingClientRect();
    const entry = table.closest('.article-entry').getBoundingClientRect();
    return { left: rect.left, right: rect.right, entryLeft: entry.left, entryRight: entry.right };
  });
  assert.ok(tableBounds, 'Body table should be present in the article content');
  assert.ok(tableBounds.entryLeft >= -1 && tableBounds.entryRight <= 391, 'Article text column should fit the mobile viewport around its table');
  assert.ok(tableBounds.left >= -1 && tableBounds.right <= 391, 'Table should not overflow the mobile viewport');
  await page.screenshot({ path: path.join(screenshotDir, 'mobile-article-table.png'), fullPage: true });
  await context.close();
}

async function exerciseRetry(browser, origin, state, primary) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await blockExternalRequests(context, state);
  const page = await context.newPage();
  attachObservers(page, 'retry', state, { allowContent503: true });
  let attempts = 0;
  await page.route('**/content.json', async route => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"temporary failure"}' });
      return;
    }
    await route.continue();
  });
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await page.locator('.search-form-input:visible').first().click();
  const dialog = page.locator('.ins-search');
  await dialog.waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('.ins-search-input').fill(primary.title);
  await page.locator('.ins-search-retry').waitFor({ state: 'visible', timeout: 8000 });
  assert.ok(/失败|无法加载|error|fail/i.test(await dialog.innerText()), 'Failed search-index load should explain the error');
  await page.locator('.ins-search-retry').click();
  await page.locator('.ins-search-item').first().waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(attempts, 2, 'Retry should issue one new request and then cache the successful index');
  await page.locator('.ins-search-input').fill(primary.title);
  await page.locator('.ins-search-item').first().waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(attempts, 2, 'Successful retry should be cached for the rest of the page session');
  await context.close();
}

async function main() {
  assert.ok(siteRoot, 'Set BLOG_DIST to the Hexo-generated public directory');
  assert.ok(fs.existsSync(siteRoot) && fs.statSync(siteRoot).isDirectory(), 'BLOG_DIST directory does not exist: ' + siteRoot);
  assert.ok(fs.existsSync(path.join(siteRoot, 'index.html')), 'BLOG_DIST must contain index.html');
  fs.mkdirSync(screenshotDir, { recursive: true });

  const index = readContentIndex();
  const articles = discoverArticles(index);
  assert.ok(articles.primary.hasToc, 'Selected article should have a generated TOC for navigation tests');
  assert.ok(articles.code, 'At least one article should contain a code block for code-control tests');
  assert.ok(articles.table, 'At least one article should contain a table for mobile layout tests');
  const xml = xmlArtifacts();
  const state = makeState();
  const server = createServer(state);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(process.env.PORT || 0), '127.0.0.1', resolve);
  });
  const address = server.address();
  const origin = 'http://127.0.0.1:' + address.port;
  state.origin = origin;

  const { chromium } = getPlaywright();
  const launchOptions = { headless: process.env.HEADLESS !== '0' };
  if (process.env.CHROMIUM_PATH) launchOptions.executablePath = path.resolve(process.env.CHROMIUM_PATH);
  else if (process.env.CHANNEL) launchOptions.channel = process.env.CHANNEL;

  let browser;
  try {
    browser = await chromium.launch(launchOptions);
    const desktopContext = await browser.newContext({ viewport: { width: 1365, height: 900 } });
    await blockExternalRequests(desktopContext, state);
    await installClipboardSpy(desktopContext);
    const page = await desktopContext.newPage();
    attachObservers(page, 'desktop', state);
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
    await page.locator('main').waitFor({ state: 'visible', timeout: 10000 });
    assert.ok(await page.evaluate(() => !!(window.jQuery && window.jQuery.fn)), 'Local jQuery must initialize with every external origin blocked');
    assert.ok(await page.evaluate(() => !!window.InsightSearchCore), 'Local search core should load');
    assert.ok([...state.localRequests].some(url => /\/js\/application(?:\.min)?\.js$/.test(url)), 'Theme application JavaScript should load locally');
    await assertNoHorizontalOverflow(page, 'Desktop home');
    await page.screenshot({ path: path.join(screenshotDir, 'desktop-home.png'), fullPage: true });
    await checkArchiveCommentLinks(page, origin);
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });

    const navLinks = await page.locator('#main-navbar .main-nav a[href]').evaluateAll(anchors => anchors.map(anchor => anchor.href));
    const usableInternalNavIndex = navLinks.findIndex(href => {
      try {
        const parsed = new URL(href);
        return parsed.origin === state.origin && !!fileForUrlPath(decodeURIComponent(parsed.pathname));
      } catch {
        return false;
      }
    });
    assert.ok(usableInternalNavIndex >= 0, 'Desktop primary navigation should point to a generated local page');
    const usableInternalNav = new URL(navLinks[usableInternalNavIndex]);
    await Promise.all([
      page.waitForURL(url => normalizedUrlPath(url.pathname) === normalizedUrlPath(usableInternalNav.pathname), { timeout: 10000 }),
      page.locator('#main-navbar .main-nav a[href]').nth(usableInternalNavIndex).click()
    ]);
    assert.equal(normalizedUrlPath(new URL(page.url()).pathname), normalizedUrlPath(usableInternalNav.pathname), 'Desktop internal navigation should open its generated page');
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });

    await exerciseSearch(page, state, articles.primary);
    await exerciseDesktopTocAndReading(page, articles.primary);
    await exerciseCodeControls(page, articles.code);
    await checkGeneratedArtifacts(page, origin, index, articles.primary, xml);

    await desktopContext.close();

    await exerciseMobile(browser, origin, articles.primary, articles.table, state);
    await exerciseRetry(browser, origin, state, articles.primary);

    assert.deepEqual(state.commentSdkRequests, [], 'Empty comment configuration must not request a third-party comment SDK');
    assertBrowserIsClean(state);
    console.log('Browser smoke checks passed for ' + siteRoot);
    console.log('Article: ' + articles.primary.urlPath);
    console.log('Screenshots: ' + screenshotDir);
    console.log('Blocked external requests: ' + state.externalRequests.length);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
