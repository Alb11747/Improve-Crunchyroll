const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const utilsSource = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'content_scripts', 'website', 'pages', 'utils.js'),
  'utf8',
);

function createHarness(responses) {
  const requests = [];

  class Renderer {
    constructor(tagName) {
      this.tagName = tagName;
      this.attributes = {};
    }

    addClass() {
      return this;
    }

    setAttribute(name, value) {
      this.attributes[name] = value;
      return this;
    }

    appendChildren() {
      return this;
    }
  }

  const context = vm.createContext({
    chrome: {
      runtime: {
        id: 'test-extension',
        sendMessage(runtimeId, message, callback) {
          assert.equal(runtimeId, 'test-extension');
          const search = JSON.parse(message.data.query.match(/Media\(search: (.+), type: ANIME\)/)[1]);
          requests.push(search);
          queueMicrotask(() => callback({ data: { Media: responses.get(search) ?? null } }));
        },
      },
    },
    document: {
      title: 'Watch Test Series - Crunchyroll',
    },
    Renderer,
    SvgRenderer: Renderer,
    window: {},
  });
  vm.runInContext(`${utilsSource}\nthis.animeListButtons = animeListButtons;`, context);

  return {
    requests,
    lookup(options) {
      return new Promise((resolve) => {
        context.animeListButtons(options, ([anilistButton, malButton]) => {
          resolve({
            anilist: anilistButton?.attributes.href,
            mal: malButton?.attributes.href,
          });
        });
      });
    },
  };
}

const seriesTitle = 'Test Series';

test('keeps season-specific results separate from the generic series result', async () => {
  const harness = createHarness(new Map([
    [seriesTitle, { id: 1, idMal: 11 }],
    [`${seriesTitle} Season 2`, { id: 2, idMal: 22 }],
  ]));

  assert.deepEqual(await harness.lookup({ seriesTitle, seasonTitle: 'Season 1' }), {
    anilist: 'https://anilist.co/anime/1',
    mal: 'https://myanimelist.net/anime/11',
  });
  assert.deepEqual(await harness.lookup({ seriesTitle, seasonTitle: 'Season 2' }), {
    anilist: 'https://anilist.co/anime/2',
    mal: 'https://myanimelist.net/anime/22',
  });
  assert.deepEqual(harness.requests, [seriesTitle, `${seriesTitle} Season 2`]);

  await harness.lookup({ seriesTitle, seasonTitle: 'Season 2' });
  assert.deepEqual(harness.requests, [seriesTitle, `${seriesTitle} Season 2`]);
});

test('caches a season miss before using the generic fallback', async () => {
  const seasonTitle = `${seriesTitle} Season 3`;
  const harness = createHarness(new Map([
    [seasonTitle, null],
    [seriesTitle, { id: 1, idMal: 11 }],
  ]));

  const expected = {
    anilist: 'https://anilist.co/anime/1',
    mal: 'https://myanimelist.net/anime/11',
  };
  assert.deepEqual(await harness.lookup({ seriesTitle, seasonTitle: 'Season 3' }), expected);
  assert.deepEqual(await harness.lookup({ seriesTitle, seasonTitle: 'Season 3' }), expected);
  assert.deepEqual(harness.requests, [seasonTitle, seriesTitle]);
});

test('keeps the existing OVA generic-series fallback', async () => {
  const harness = createHarness(new Map([
    [seriesTitle, { id: 1, idMal: 11 }],
  ]));

  await harness.lookup({ seriesTitle, seasonTitle: 'OVAs' });
  assert.deepEqual(harness.requests, [seriesTitle]);
});
