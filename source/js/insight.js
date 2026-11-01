(function (window, document) {
  'use strict';

  function initialize() {
    var config = window.INSIGHT_CONFIG || {};
    var core = window.InsightSearchCore;
    var dialog = document.querySelector('.ins-search');
    if (!dialog || !core) return;

    var input = dialog.querySelector('.ins-search-input');
    var results = dialog.querySelector('.ins-section-container');
    var closeButton = dialog.querySelector('.ins-close');
    var mask = dialog.querySelector('.ins-search-mask');
    var index = null;
    var request = null;
    var returnFocus = null;
    var suppressTriggerFocus = false;
    var activeResult = -1;
    var messages = config.MESSAGES || {};

    if (!input || !results) return;

    // The header is transformed/fixed at mobile widths. Keep the dialog outside
    // that stacking context so it can cover the viewport without clipping.
    document.body.appendChild(dialog);

    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', config.DIALOG_LABEL || '站内搜索');
    dialog.setAttribute('aria-hidden', 'true');
    input.setAttribute('aria-label', input.getAttribute('aria-label') || '搜索文章');
    results.setAttribute('aria-live', 'polite');
    results.setAttribute('aria-relevant', 'additions text');

    function message(key, fallback) {
      return typeof messages[key] === 'string' ? messages[key] : fallback;
    }

    function setStatus(text, retry) {
      results.replaceChildren();
      var status = document.createElement('p');
      status.className = 'ins-search-status';
      status.setAttribute('role', 'status');
      status.textContent = text;
      results.appendChild(status);

      if (retry) {
        var button = document.createElement('button');
        button.className = 'ins-search-retry';
        button.type = 'button';
        button.textContent = message('RETRY', '重试');
        results.appendChild(button);
      }
    }

    function resolveUrl(path) {
      if (typeof path !== 'string' || !path.trim()) return null;
      try {
        var root = new URL(config.ROOT_URL || '/', document.baseURI);
        var url = new URL(path, root);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
      } catch (error) {
        return null;
      }
    }

    function makeSection(title, items, kind) {
      if (!items.length) return null;

      var section = document.createElement('section');
      section.className = 'ins-section';
      var heading = document.createElement('header');
      heading.className = 'ins-section-header';
      heading.setAttribute('role', 'heading');
      heading.setAttribute('aria-level', '2');
      heading.textContent = title;
      section.appendChild(heading);

      var query = input.value.trim();
      function appendHighlighted(node, value) {
        core.highlight(value, query).forEach(function (part) {
          var child = part.match ? document.createElement('mark') : document.createTextNode(part.text);
          if (part.match) child.textContent = part.text;
          node.appendChild(child);
        });
      }

      items.forEach(function (item) {
        var chapter = kind === 'POSTS' || kind === 'PAGES' ? core.sectionFor(item, query) : null;
        var href = resolveUrl(kind === 'POSTS' || kind === 'PAGES' ? item.path : item.permalink);
        if (!href) return;
        if (chapter) href = href.split('#')[0] + '#' + encodeURIComponent(chapter.id);

        var link = document.createElement('a');
        link.className = 'ins-selectable ins-search-item';
        link.href = href;
        link.style.display = 'block';

        var titleNode = document.createElement('header');
        titleNode.className = 'ins-search-item-title';
        var title = kind === 'POSTS' || kind === 'PAGES' ? item.title : item.name;
        appendHighlighted(titleNode, typeof title === 'string' && title ? title : message('UNTITLED', '(未命名)'));
        link.appendChild(titleNode);

        if (chapter) {
          var chapterNode = document.createElement('span');
          chapterNode.className = 'ins-search-chapter';
          appendHighlighted(chapterNode, '章节 · ' + chapter.title);
          link.appendChild(chapterNode);
        }

        if (item.slug) {
          var slug = document.createElement('span');
          slug.className = 'ins-slug';
          slug.textContent = item.slug;
          link.appendChild(slug);
        }

        if ((kind === 'POSTS' || kind === 'PAGES') && item.text) {
          var preview = document.createElement('p');
          preview.className = 'ins-search-preview';
          appendHighlighted(preview, core.snippet(chapter ? item.text.slice(chapter.start, chapter.end) : item.text, query));
          link.appendChild(preview);
        }

        section.appendChild(link);
      });

      return section.childElementCount > 1 ? section : null;
    }

    function render() {
      if (!index) return;
      var query = input.value.trim();
      if (!query) {
        setStatus(message('PROMPT', '输入关键词开始搜索'));
        activeResult = -1;
        return;
      }

      var found = core.search(index, query);
      var translations = config.TRANSLATION || {};
      var sections = [
        ['POSTS', found.posts],
        ['PAGES', found.pages],
        ['CATEGORIES', found.categories],
        ['TAGS', found.tags]
      ];
      results.replaceChildren();
      activeResult = -1;

      sections.forEach(function (entry) {
        var section = makeSection(translations[entry[0]] || entry[0], entry[1], entry[0]);
        if (section) results.appendChild(section);
      });

      if (!results.querySelector('.ins-search-item')) {
        setStatus(message('NO_RESULTS', '没有找到相关内容，请换个关键词。'));
      }
    }

    function loadIndex() {
      if (index) return Promise.resolve(index);
      if (request) return request;

      if (typeof window.fetch !== 'function') {
        setStatus(message('LOAD_ERROR', '搜索暂时无法加载，请重试。'), true);
        return Promise.resolve(null);
      }

      setStatus(message('LOADING', '正在加载搜索内容…'));
      request = window.fetch(config.CONTENT_URL || '/content.json').then(function (response) {
        if (!response || !response.ok) {
          throw new Error('Search index request failed');
        }
        return response.json();
      }).then(function (data) {
        if (!data || !Array.isArray(data.posts) || !Array.isArray(data.pages)) {
          throw new Error('Search index has an unexpected format');
        }
        index = data;
        request = null;
        render();
        return index;
      }).catch(function () {
        request = null;
        setStatus(message('LOAD_ERROR', '搜索内容加载失败，请检查网络后重试。'), true);
        return null;
      });

      return request;
    }

    function open(source) {
      if (!dialog.classList.contains('show')) {
        returnFocus = source || document.activeElement;
        dialog.classList.add('show');
        document.body.classList.add('ins-search-open');
        dialog.setAttribute('aria-hidden', 'false');
      }
      input.focus();
      loadIndex();
    }

    function close(restore) {
      if (!dialog.classList.contains('show')) return;
      dialog.classList.remove('show');
      document.body.classList.remove('ins-search-open');
      dialog.setAttribute('aria-hidden', 'true');
      activeResult = -1;

      if (restore && returnFocus && returnFocus !== document.body && typeof returnFocus.focus === 'function') {
        suppressTriggerFocus = true;
        returnFocus.focus();
        suppressTriggerFocus = false;
      }
    }

    function resultLinks() {
      return Array.prototype.slice.call(results.querySelectorAll('.ins-search-item'));
    }

    function moveActiveResult(direction) {
      var links = resultLinks();
      if (!links.length) return;

      if (activeResult === -1) {
        activeResult = direction > 0 ? 0 : links.length - 1;
      } else {
        activeResult = (activeResult + direction + links.length) % links.length;
      }

      links.forEach(function (link, index) {
        var active = index === activeResult;
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      });
      if (typeof links[activeResult].scrollIntoView === 'function') {
        links[activeResult].scrollIntoView({ block: 'nearest' });
      }
    }

    function focusableElements() {
      return Array.prototype.slice.call(dialog.querySelectorAll(
        '.ins-search-input, .ins-close, .ins-search-item, .ins-search-retry'
      )).filter(function (element) {
        return !element.disabled && element.getAttribute('aria-hidden') !== 'true';
      });
    }

    document.addEventListener('focusin', function (event) {
      var trigger = event.target.closest && event.target.closest('.search-form-input, .search-form-submit');
      if (trigger && !suppressTriggerFocus) open(trigger);
    });

    document.addEventListener('click', function (event) {
      var trigger = event.target.closest && event.target.closest('.search-form-input, .search-form-submit');
      if (trigger) open(trigger);
    });

    document.addEventListener('submit', function (event) {
      if (event.target.querySelector && event.target.querySelector('.search-form-input')) {
        event.preventDefault();
        open(event.target.querySelector('.search-form-input'));
      }
    });

    input.addEventListener('input', render);
    if (closeButton) closeButton.addEventListener('click', function () { close(true); });
    if (mask) mask.addEventListener('click', function () { close(true); });

    results.addEventListener('click', function (event) {
      var retry = event.target.closest && event.target.closest('.ins-search-retry');
      if (retry) loadIndex();
    });

    document.addEventListener('keydown', function (event) {
      if (!dialog.classList.contains('show')) return;

      if (event.key === 'Escape' || event.keyCode === 27) {
        event.preventDefault();
        close(true);
        return;
      }

      var navigatingResults = event.target === input || event.target.classList.contains('ins-search-item');
      if (navigatingResults && (event.key === 'ArrowDown' || event.keyCode === 40)) {
        event.preventDefault();
        moveActiveResult(1);
        return;
      }

      if (navigatingResults && (event.key === 'ArrowUp' || event.keyCode === 38)) {
        event.preventDefault();
        moveActiveResult(-1);
        return;
      }

      if (event.target === input && (event.key === 'Enter' || event.keyCode === 13)) {
        var links = resultLinks();
        if (links.length && activeResult >= 0) {
          event.preventDefault();
          links[activeResult].click();
        }
        return;
      }

      if (event.key === 'Tab' || event.keyCode === 9) {
        var focusable = focusableElements();
        if (!focusable.length) {
          event.preventDefault();
          input.focus();
          return;
        }
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    });

    if (window.location.hash === '#ins-search') open(document.activeElement);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})(window, document);
