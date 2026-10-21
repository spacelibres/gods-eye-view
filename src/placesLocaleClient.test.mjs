import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlaceSearchService } from '../src/tools/places.js';
import { createHttpGeospatialProvider } from '../src/search/http.js';

/**
 * Both client paths that reach the Places proxy must name the UI language, so
 * the server can forward it as Google's languageCode.
 */

function captureFetch() {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => ({ places: [], results: [] }),
      text: async () => '{"places":[]}',
    };
  };
  return { calls, fetchImpl };
}

test('the tool service sends the active locale on nearby and text search', async () => {
  const { calls, fetchImpl } = captureFetch();
  const service = createPlaceSearchService({
    fetchImpl,
    getLocale: () => 'zh-CN',
  });

  await service.nearby({ latitude: 39.9, longitude: 116.4, radiusM: 500 });
  await service.search('天安门', { latitude: 39.9, longitude: 116.4, radiusM: 500 });

  assert.equal(calls.length, 2);
  for (const url of calls) {
    assert.equal(new URL(url, 'http://x').searchParams.get('lang'), 'zh-CN');
  }
});

test('the tool service omits lang when no locale is supplied', async () => {
  for (const getLocale of [undefined, () => null, () => '', () => '   ']) {
    const { calls, fetchImpl } = captureFetch();
    const service = createPlaceSearchService({ fetchImpl, getLocale });
    await service.nearby({ latitude: 0, longitude: 0, radiusM: 500 });
    assert.equal(new URL(calls[0], 'http://x').searchParams.has('lang'), false);
  }
});

test('the geospatial provider sends the active locale', async () => {
  const { calls, fetchImpl } = captureFetch();
  const provider = createHttpGeospatialProvider({
    fetchImpl,
    getLocale: () => 'ja',
  });

  await provider.nearby({ latitude: 35.6, longitude: 139.7, radiusM: 500 });
  await provider.textSearch('東京', { latitude: 35.6, longitude: 139.7 });
  await provider.reverseGeocode(35.6, 139.7);

  assert.equal(calls.length, 3);
  for (const url of calls) {
    assert.equal(new URL(url, 'http://x').searchParams.get('lang'), 'ja');
  }
});

test('the geospatial provider leaves lang out without a locale', async () => {
  const { calls, fetchImpl } = captureFetch();
  const provider = createHttpGeospatialProvider({ fetchImpl });
  await provider.nearby({ latitude: 0, longitude: 0, radiusM: 500 });
  assert.equal(new URL(calls[0], 'http://x').searchParams.has('lang'), false);
});
