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

  return {
    tokenize: tokenize,
    search: search
  };
});
