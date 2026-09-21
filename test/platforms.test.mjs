// 各プラットフォームの取得で、チャンネルが見つからなくても（停止・名前の変更・書き間違い）、ほかのチャンネルの取得が続くことを確かめる。
// 実際の API は呼ばず、fetch を差し替えて決まった応答を返す
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as twitch from '../scripts/platforms/twitch.mjs';
import * as youtube from '../scripts/platforms/youtube.mjs';
import * as kick from '../scripts/platforms/kick.mjs';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** URL に応じた JSON を返す fetch に差し替える。handler(url) が undefined を返した URL はテストの失敗にする */
function stubFetch(handler) {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const body = handler(url);
    assert.ok(body !== undefined, `想定していない呼び出し: ${url}`);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

const env = { TWITCH_CLIENT_ID: 'id', TWITCH_CLIENT_SECRET: 'secret', YOUTUBE_API_KEY: 'key', KICK_CLIENT_ID: 'id', KICK_CLIENT_SECRET: 'secret' };
const twitchUser = (id, login) => ({ id, login, display_name: login.toUpperCase(), profile_image_url: `https://img/${login}.png` });

test('Twitch: 見つからないチャンネル（停止など）は飛ばして知らせ、ほかのチャンネルは取得する', async () => {
  stubFetch((url) => {
    if (url.pathname === '/oauth2/token') return { access_token: 't' };
    if (url.pathname === '/helix/users') return { data: url.searchParams.getAll('login').includes('alive') ? [twitchUser('1', 'alive')] : [] };
    if (url.pathname === '/helix/streams') return { data: [{ id: 's1', user_id: '1', user_login: 'alive', started_at: '2026-09-21T10:00:00Z', title: 'T', game_name: 'G', thumbnail_url: '' }] };
    if (url.pathname === '/helix/videos') return { data: [] };
  });
  const reports = [];
  const out = await twitch.fetchAll(['alive', 'banned'], env, { report: (m) => reports.push(m) });
  assert.deepEqual([...out.keys()], ['alive']);
  assert.equal(out.get('alive').live.stream_id, 's1');
  assert.equal(reports.length, 1);
  assert.match(reports[0], /banned が見つかりません/);
});

test('YouTube: 見つからないチャンネルは飛ばして知らせ、ほかのチャンネルは取得する', async () => {
  const channel = (id, handle) => ({ id, snippet: { title: handle, customUrl: handle, thumbnails: {} }, contentDetails: { relatedPlaylists: { uploads: `UU${id}` } } });
  stubFetch((url) => {
    if (url.pathname.endsWith('/channels')) return { items: url.searchParams.get('forHandle') === '@ok' ? [channel('UC1', '@ok')] : [] };
    if (url.pathname.endsWith('/playlistItems')) return { items: [] };
  });
  const reports = [];
  const out = await youtube.fetchAll(['@ok', '@gone'], env, { report: (m) => reports.push(m) });
  assert.deepEqual([...out.keys()], ['@ok']);
  assert.equal(reports.length, 1);
  assert.match(reports[0], /@gone が見つかりません/);
});

test('Kick: 見つからないチャンネルは飛ばして知らせ、ほかのチャンネルは取得する', async () => {
  const channel = (id, slug, live) => ({ broadcaster_user_id: id, slug, stream_title: 'T', category: { name: 'G' }, stream: { is_live: live, start_time: '2026-09-21T10:00:00Z', thumbnail: '' } });
  stubFetch((url) => {
    if (url.pathname === '/oauth/token') return { access_token: 't' };
    if (url.pathname === '/public/v1/channels') return { data: [channel(1, 'ok', true)] };
  });
  const reports = [];
  const out = await kick.fetchAll(['ok', 'gone'], env, { report: (m) => reports.push(m) });
  assert.deepEqual([...out.keys()], ['ok']);
  assert.ok(out.get('ok').live);
  assert.equal(reports.length, 1);
  assert.match(reports[0], /gone が見つかりません/);
});
