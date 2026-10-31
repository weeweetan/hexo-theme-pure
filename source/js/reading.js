(function (window, document) {
  'use strict';

  function closest(element, selector) {
    if (!element) return null;
    if (element.closest) return element.closest(selector);
    while (element && element.nodeType === 1) {
      if (element.matches ? element.matches(selector) : false) return element;
      element = element.parentElement;
    }
    return null;
  }

  function focusWithoutScroll(element) {
    if (!element || typeof element.focus !== 'function') return;
    try {
      element.focus({ preventScroll: true });
    } catch (error) {
      element.focus();
    }
  }

  function initialize() {
    var body = document.body;
    var article = document.querySelector('.article');
    var content = article && article.querySelector('.article-entry');
    if (!body || !article || !content) return;

    var toc = document.querySelector('[data-reading-toc]');
    var tocToggle = document.querySelector('[data-reading-toc-toggle]');
    var tocCloseButtons = toc ? toc.querySelectorAll('[data-reading-toc-close]') : [];
    var backdrop = document.querySelector('.reading-toc-backdrop');
    var mobileQuery = window.matchMedia ? window.matchMedia('(max-width: 767px)') : null;
    var savedTocFocus = null;
    var inertBackgroundState = [];
    var codePanelCount = 0;

    function isMobile() {
      return mobileQuery ? mobileQuery.matches : window.innerWidth <= 767;
    }

    function tocIsOpen() {
      return !!(toc && toc.classList.contains('is-mobile-open'));
    }

    function setBackgroundInert(inert) {
      if (inert) {
        if (inertBackgroundState.length) return;
        var targets = Array.prototype.slice.call(document.querySelectorAll('body > .header, body > .main, body > .footer'));
        inertBackgroundState = targets.map(function (element) {
          var wasInert = element.hasAttribute('inert');
          element.setAttribute('inert', '');
          return { element: element, wasInert: wasInert };
        });
        return;
      }
      inertBackgroundState.forEach(function (state) {
        if (state.wasInert) state.element.setAttribute('inert', '');
        else state.element.removeAttribute('inert');
      });
      inertBackgroundState = [];
    }

    function setTocA11yState(open) {
      if (!toc) return;
      if (isMobile()) {
        toc.setAttribute('role', 'dialog');
        toc.setAttribute('aria-hidden', open ? 'false' : 'true');
        if (open) toc.setAttribute('aria-modal', 'true');
        else toc.removeAttribute('aria-modal');
      } else {
        toc.setAttribute('role', 'complementary');
        toc.setAttribute('aria-hidden', 'false');
        toc.removeAttribute('aria-modal');
      }
      if (tocToggle) tocToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function syncTocViewport() {
      if (!toc) return;
      if (!isMobile() && tocIsOpen()) {
        closeToc(false);
      }
      setTocA11yState(tocIsOpen());
    }

    function tocFocusableElements() {
      if (!toc) return [];
      return Array.prototype.slice.call(toc.querySelectorAll(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter(function (element) {
        return !element.hidden && element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length > 0;
      });
    }

    function openToc(trigger) {
      if (!toc || !isMobile() || body.classList.contains('ins-search-open')) return;
      if (tocIsOpen()) return;
      savedTocFocus = trigger || document.activeElement || tocToggle;
      toc.classList.add('is-mobile-open');
      body.classList.add('reading-toc-open');
      setBackgroundInert(true);
      if (backdrop) backdrop.hidden = false;
      setTocA11yState(true);
      var first = toc.querySelector('.reading-toc-close') || toc.querySelector('a[href]');
      focusWithoutScroll(first);
    }

    function closeToc(returnFocus) {
      if (!toc || !tocIsOpen()) return;
      toc.classList.remove('is-mobile-open');
      body.classList.remove('reading-toc-open');
      setBackgroundInert(false);
      if (backdrop) backdrop.hidden = true;
      setTocA11yState(false);
      if (returnFocus && !body.classList.contains('ins-search-open')) {
        focusWithoutScroll(savedTocFocus && savedTocFocus.isConnected ? savedTocFocus : tocToggle);
      }
      savedTocFocus = null;
    }

    function findTocDestination(link) {
      var href = link && link.getAttribute('href');
      if (!href || href.charAt(0) !== '#') return null;
      var id;
      try {
        id = decodeURIComponent(href.slice(1));
      } catch (error) {
        id = href.slice(1);
      }
      var target = document.getElementById(id);
      if (target && target.tagName === 'A' && target.nextElementSibling && /^H[1-6]$/.test(target.nextElementSibling.tagName)) {
        return target.nextElementSibling;
      }
      return target;
    }

    function handleTocClick(event) {
      var link = closest(event.target, 'a[href^="#"]');
      if (!link || !toc || !toc.contains(link) || !isMobile() || !tocIsOpen()) return;
      var destination = findTocDestination(link);
      closeToc(false);
      if (!destination) return;
      if (/^H[1-6]$/.test(destination.tagName) && !destination.hasAttribute('tabindex')) {
        destination.setAttribute('tabindex', '-1');
      }
      window.requestAnimationFrame(function () {
        focusWithoutScroll(destination);
      });
    }

    if (toc) {
      syncTocViewport();
      if (mobileQuery && mobileQuery.addEventListener) mobileQuery.addEventListener('change', syncTocViewport);
      else if (mobileQuery && mobileQuery.addListener) mobileQuery.addListener(syncTocViewport);

      if (tocToggle) tocToggle.addEventListener('click', function () {
        if (tocIsOpen()) closeToc(true);
        else openToc(tocToggle);
      });
      Array.prototype.forEach.call(tocCloseButtons, function (button) {
        button.addEventListener('click', function () { closeToc(true); });
      });
      if (backdrop) backdrop.addEventListener('click', function () { closeToc(true); });
      toc.addEventListener('click', handleTocClick);

      document.addEventListener('keydown', function (event) {
        if (!tocIsOpen()) return;
        if (event.key === 'Escape' || event.keyCode === 27) {
          event.preventDefault();
          closeToc(true);
          return;
        }
        if (event.key !== 'Tab' && event.keyCode !== 9) return;
        var focusable = tocFocusableElements();
        if (!focusable.length) {
          event.preventDefault();
          focusWithoutScroll(toc);
          return;
        }
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || !toc.contains(document.activeElement))) {
          event.preventDefault();
          focusWithoutScroll(last);
        } else if (!event.shiftKey && (document.activeElement === last || !toc.contains(document.activeElement))) {
          event.preventDefault();
          focusWithoutScroll(first);
        }
      });

      if (window.MutationObserver) {
        new window.MutationObserver(function () {
          if (body.classList.contains('ins-search-open') && tocIsOpen()) closeToc(false);
        }).observe(body, { attributes: true, attributeFilter: ['class'] });
      }
    }

    function markManualIndex() {
      if (!toc) return;
      var headings = content.querySelectorAll('h1, h2, h3, h4, h5, h6');
      var indexHeading = Array.prototype.find.call(headings, function (heading) {
        return heading.textContent.replace(/\s+/g, ' ').trim() === '阅读导航';
      });
      if (!indexHeading) return;
      // The article's own navigation is not a chapter. In desktop view its
      // heading is hidden, so do not leave a TOC link to that hidden target.
      Array.prototype.forEach.call(toc.querySelectorAll('a[href^="#"]'), function (link) {
        if (findTocDestination(link) !== indexHeading) return;
        var item = closest(link, '.toc-item');
        if (item) item.remove();
      });
      content.classList.add('has-reading-sidebar');
      indexHeading.classList.add('reading-index-heading');
      var node = indexHeading.nextElementSibling;
      while (node && !/^H[1-6]$/.test(node.tagName)) {
        node.classList.add('reading-index-content');
        node = node.nextElementSibling;
      }
    }

    function setupTableScrolling() {
      Array.prototype.forEach.call(content.querySelectorAll('table'), function (table) {
        if (closest(table, '.highlight') || closest(table, '.reading-table-wrap')) return;
        var parent = table.parentNode;
        if (!parent) return;
        var wrapper = document.createElement('div');
        wrapper.className = 'reading-table-wrap';
        wrapper.setAttribute('role', 'region');
        wrapper.setAttribute('aria-label', '可横向滚动的数据表格');
        wrapper.setAttribute('tabindex', '0');
        parent.insertBefore(wrapper, table);
        wrapper.appendChild(table);
      });
    }

    function makeCodeButton(label, attribute, ariaLabel) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'reading-code-button';
      button.setAttribute(attribute, '');
      button.setAttribute('aria-label', ariaLabel);
      button.textContent = label;
      return button;
    }

    function extractCodeText(pre) {
      var text = typeof pre.innerText === 'string' ? pre.innerText : pre.textContent;
      return (text || '').replace(/\s+$/, '') + '\n';
    }

    function legacyCopy(text) {
      var field = document.createElement('textarea');
      field.value = text;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.top = '0';
      field.style.left = '-9999px';
      document.body.appendChild(field);
      field.select();
      var copied = false;
      try {
        copied = document.execCommand('copy');
      } catch (error) {
        copied = false;
      }
      document.body.removeChild(field);
      return copied;
    }

    function setupCodeBlocks() {
      var blocks = Array.prototype.slice.call(content.querySelectorAll('.highlight'));
      Array.prototype.forEach.call(content.querySelectorAll('pre'), function (pre) {
        if (!closest(pre, '.highlight')) blocks.push(pre);
      });

      blocks.forEach(function (block) {
        if (block.hasAttribute('data-reading-code-block')) return;
        var isPlainPre = block.tagName === 'PRE';
        var pre = isPlainPre ? block : (block.querySelector('.code pre') || block.querySelector('pre'));
        if (!pre) return;

        if (isPlainPre) {
          var wrapper = document.createElement('div');
          wrapper.className = 'reading-code-block reading-code-plain';
          wrapper.setAttribute('data-reading-code-block', '');
          block.parentNode.insertBefore(wrapper, block);
          wrapper.appendChild(block);
          block = wrapper;
        } else {
          block.classList.add('reading-code-block');
          block.setAttribute('data-reading-code-block', '');
        }

        var tools = document.createElement('div');
        tools.className = 'reading-code-tools';
        var copyButton = makeCodeButton('复制代码', 'data-reading-code-copy', '复制代码');
        var wrapButton = makeCodeButton('换行', 'data-reading-code-wrap', '切换代码自动换行');
        wrapButton.setAttribute('aria-pressed', 'false');
        var status = document.createElement('span');
        status.className = 'reading-copy-status';
        status.setAttribute('data-reading-copy-status', '');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        tools.appendChild(copyButton);
        tools.appendChild(wrapButton);
        tools.appendChild(status);

        var expandButton = null;
        var codePanel = block.querySelector('table') || pre;
        if (pre.scrollHeight > 18 * 24) {
          block.classList.add('is-collapsible', 'is-collapsed');
          expandButton = makeCodeButton('展开代码', 'data-reading-code-expand', '展开或收起长代码');
          expandButton.setAttribute('aria-expanded', 'false');
          if (!codePanel.id) codePanel.id = 'reading-code-panel-' + (++codePanelCount);
          expandButton.setAttribute('aria-controls', codePanel.id);
          tools.insertBefore(expandButton, status);
        }

        block.insertBefore(tools, block.firstChild);
        copyButton.addEventListener('click', function () {
          var text = extractCodeText(pre);
          function showCopyResult(success) {
            status.textContent = success ? '已复制' : '复制失败，请手动选择代码';
            if (status._readingCopyTimer) window.clearTimeout(status._readingCopyTimer);
            status._readingCopyTimer = window.setTimeout(function () {
              status.textContent = '';
              status._readingCopyTimer = null;
            }, 3000);
          }
          if (window.navigator.clipboard && window.navigator.clipboard.writeText) {
            window.navigator.clipboard.writeText(text).then(function () {
              showCopyResult(true);
            }, function () {
              showCopyResult(legacyCopy(text));
            });
          } else {
            showCopyResult(legacyCopy(text));
          }
        });
        wrapButton.addEventListener('click', function () {
          var wrapped = block.classList.toggle('is-wrapped');
          wrapButton.setAttribute('aria-pressed', wrapped ? 'true' : 'false');
        });
        if (expandButton) {
          expandButton.addEventListener('click', function () {
            var expanded = expandButton.getAttribute('aria-expanded') !== 'true';
            block.classList.toggle('is-collapsed', !expanded);
            expandButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            expandButton.textContent = expanded ? '收起代码' : '展开代码';
          });
        }
      });
    }

    function setupTocHighlighting() {
      if (!toc) return;
      var links = Array.prototype.slice.call(toc.querySelectorAll('a[href^="#"]'));
      var headings = [];
      links.forEach(function (link) {
        var destination = findTocDestination(link);
        if (!destination || !content.contains(destination)) return;
        link.setAttribute('data-reading-toc-link', '');
        link.removeAttribute('aria-current');
        if (!headings.some(function (item) { return item.id === destination.id; })) headings.push(destination);
      });
      if (!headings.length) return;

      var scheduled = false;
      function updateCurrent() {
        scheduled = false;
        var threshold = isMobile() ? 74 : 24;
        var current = headings[0];
        headings.forEach(function (heading) {
          if (heading.getBoundingClientRect().top <= threshold) current = heading;
        });
        links.forEach(function (link) {
          var destination = findTocDestination(link);
          var active = destination === current;
          link.classList.toggle('is-current', active);
          if (active) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
          var item = closest(link, '.toc-item');
          if (item) item.classList.toggle('is-current', active);
        });
      }
      function scheduleUpdate() {
        if (scheduled) return;
        scheduled = true;
        window.requestAnimationFrame(updateCurrent);
      }
      window.addEventListener('scroll', scheduleUpdate, { passive: true });
      window.addEventListener('resize', scheduleUpdate, { passive: true });
      if ('IntersectionObserver' in window) {
        var observer = new IntersectionObserver(scheduleUpdate, { rootMargin: '-20% 0px -70% 0px' });
        headings.forEach(function (heading) { observer.observe(heading); });
      }
      updateCurrent();
    }

    function setupReadingControls() {
      var controls = article.querySelector('[data-reading-controls]');
      if (!controls) return;
      var modeButton = controls.querySelector('[data-reading-mode-toggle]');
      var fontStatus = controls.querySelector('[data-reading-font-status]');
      var lineButton = controls.querySelector('[data-reading-line-height]');
      var widthButton = controls.querySelector('[data-reading-width]');
      var fontSize = Math.round(parseFloat(window.getComputedStyle(content).fontSize) || 16);
      var fontCustomized = false;

      function updateFontStatus() {
        if (fontStatus) fontStatus.textContent = fontSize + 'px';
        content.classList.add('reading-font-adjusted');
        content.style.setProperty('--reading-font-size', fontSize + 'px');
      }
      function setMode(enabled) {
        body.classList.toggle('reading-mode', enabled);
        if (modeButton) {
          modeButton.setAttribute('aria-pressed', enabled ? 'true' : 'false');
          modeButton.textContent = enabled ? '退出阅读模式' : '阅读模式';
        }
        if (enabled && !fontCustomized) {
          fontSize = 18;
          updateFontStatus();
        }
      }

      updateFontStatus();
      if (modeButton) modeButton.addEventListener('click', function () {
        setMode(!body.classList.contains('reading-mode'));
      });
      controls.addEventListener('click', function (event) {
        var fontButton = closest(event.target, '[data-reading-font]');
        if (fontButton && controls.contains(fontButton)) {
          fontCustomized = true;
          fontSize = Math.max(14, Math.min(24, fontSize + (fontButton.getAttribute('data-reading-font') === 'up' ? 1 : -1)));
          updateFontStatus();
          return;
        }
        if (lineButton && (event.target === lineButton || lineButton.contains(event.target))) {
          var loose = content.classList.toggle('reading-line-loose');
          lineButton.setAttribute('aria-pressed', loose ? 'true' : 'false');
          return;
        }
        if (widthButton && (event.target === widthButton || widthButton.contains(event.target))) {
          var wide = body.classList.toggle('reading-width-wide');
          widthButton.setAttribute('aria-pressed', wide ? 'true' : 'false');
        }
      });
    }

    markManualIndex();
    setupTableScrolling();
    setupCodeBlocks();
    setupTocHighlighting();
    setupReadingControls();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})(window, document);
