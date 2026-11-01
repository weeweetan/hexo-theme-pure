(function (root, factory) {
  var api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.InsightSearchCore = api;
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  function text(value) {
    return typeof value === 'string' ? value : '';
  }

  function tokenize(query) {
    var value = text(query).trim();
    return value ? value.split(/\s+/u).map(function (term) {
      return term.toLocaleUpperCase();
    }) : [];
  }

  function fieldsFor(item, fields) {
    return fields.map(function (field) {
      return text(item && item[field]).toLocaleUpperCase();
    });
  }

  function matches(item, fields, terms) {
    var values = fieldsFor(item, fields);
    return terms.length > 0 && terms.every(function (term) {
      return values.some(function (value) {
        return value.indexOf(term) !== -1;
      });
    });
  }

  function countOccurrences(value, term) {
    var count = 0;
    var offset = 0;
    var found;

    while ((found = value.indexOf(term, offset)) !== -1) {
      count += 1;
      offset = found + term.length;
    }

    return count;
  }

  function weight(item, fields, terms, fieldWeights) {
    var values = fieldsFor(item, fields);
    return terms.reduce(function (total, term) {
      return total + values.reduce(function (score, value, index) {
        return score + countOccurrences(value, term) * fieldWeights[index];
      }, 0);
    }, 0);
  }

  function uniqueTaxonomies(entries, key) {
    var values = Object.create(null);
    entries.forEach(function (entry) {
      var terms = entry && Array.isArray(entry[key]) ? entry[key] : [];
      terms.forEach(function (value) {
        if (value && typeof value.name === 'string' && !values[value.name]) {
          values[value.name] = value;
        }
      });
    });
    return Object.keys(values).map(function (name) {
      return values[name];
    });
  }

  function ranked(items, queryTerms, fields, fieldWeights, limit) {
    return items.filter(function (item) {
      return matches(item, fields, queryTerms);
    }).map(function (item, index) {
      return {
        item: item,
        index: index,
        score: weight(item, fields, queryTerms, fieldWeights)
      };
    }).sort(function (left, right) {
      return right.score - left.score || left.index - right.index;
    }).slice(0, limit).map(function (entry) {
      return entry.item;
    });
  }

  function search(index, query, limit) {
    var data = index || {};
    var terms = tokenize(query);
    var maxResults = Number.isInteger(limit) && limit > 0 ? limit : 5;
    var posts = Array.isArray(data.posts) ? data.posts : [];
    var pages = Array.isArray(data.pages) ? data.pages : [];
    var entries = pages.concat(posts);

    return {
      posts: ranked(posts, terms, ['title', 'text'], [3, 1], maxResults),
      pages: ranked(pages, terms, ['title', 'text'], [3, 1], maxResults),
      categories: ranked(uniqueTaxonomies(entries, 'categories'), terms, ['name', 'slug'], [1, 1], maxResults),
      tags: ranked(uniqueTaxonomies(entries, 'tags'), terms, ['name', 'slug'], [1, 1], maxResults)
    };
  }

  function snippet(value, query, size) {
    var source = text(value).replace(/\s+/g, ' ').trim();
    var length = size || 160;
    var upper = source.toLocaleUpperCase();
    var positions = tokenize(query).map(function (term) { return upper.indexOf(term); }).filter(function (at) { return at >= 0; });
    var first = positions.length ? Math.min.apply(Math, positions) : 0;
    var start = Math.max(0, first - Math.floor(length / 3));
    start = Math.min(start, Math.max(0, source.length - length));
    return (start ? '…' : '') + source.slice(start, start + length) + (start + length < source.length ? '…' : '');
  }

  // Return text runs, never HTML: search terms and article text are untrusted.
  function highlight(value, query) {
    var source = text(value);
    var terms = tokenize(query).sort(function (a, b) { return b.length - a.length; });
    var upper = source.toLocaleUpperCase();
    var parts = [];
    var cursor = 0;
    while (cursor < source.length) {
      var next = -1;
      var matched = '';
      terms.forEach(function (term) {
        var at = upper.indexOf(term, cursor);
        if (at >= 0 && (next < 0 || at < next)) { next = at; matched = term; }
      });
      if (next < 0) { parts.push({ text: source.slice(cursor), match: false }); break; }
      if (next > cursor) parts.push({ text: source.slice(cursor, next), match: false });
      parts.push({ text: source.slice(next, next + matched.length), match: true });
      cursor = next + matched.length;
    }
    return parts;
  }

  function sectionFor(item, query) {
    var terms = tokenize(query);
    var body = text(item.text);
    // A title-only query should lead to the article introduction.
    if (!terms.length || terms.every(function (term) { return text(item.title).toLocaleUpperCase().includes(term); })) return null;
    var candidates = (Array.isArray(item.sections) ? item.sections : []).filter(function (section) {
      return section && typeof section.id === 'string' && section.id && Number.isInteger(section.start) &&
        Number.isInteger(section.end) && section.start >= 0 && section.end > section.start && section.end <= body.length;
    }).map(function (section) {
      var value = { title: text(item.title) + ' ' + text(section.title), text: body.slice(section.start, section.end) };
      return { section: section, value: value, score: weight({ title: section.title, text: value.text }, ['title', 'text'], terms, [8, 1]) };
    }).filter(function (candidate) {
      return matches(candidate.value, ['title', 'text'], terms);
    }).sort(function (a, b) { return b.score - a.score; });
    return candidates.length ? candidates[0].section : null;
  }

  return {
    tokenize: tokenize,
    search: search,
    snippet: snippet,
    highlight: highlight,
    sectionFor: sectionFor
  };
});
