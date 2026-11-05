// Run only against a fresh, disposable MySQL database initialized with db.sql.
const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const LibraryRepository = require('../lib/repositories/LibraryRepository');
const LibraryService = require('../lib/services/LibraryService');
const {Track, Album, PersonArtist, GroupArtist} = require('../lib/models');

test('class architecture preserves SQL relationships and HTTP routes', {
    skip: process.env.TEST_DB_DISPOSABLE !== 'true' || !process.env.TEST_DB_PORT
}, async t => {
    const pool = mysql.createPool({
        host: '127.0.0.1', port: Number(process.env.TEST_DB_PORT), user: 'root',
        password: process.env.TEST_DB_PASSWORD, database: 'music'
    });
    t.after(() => pool.end());
    const [[existing]] = await pool.execute('SELECT COUNT(*) AS count FROM tracks');
    assert.equal(existing.count, 0, 'Use a fresh disposable test database.');
    const repository = new LibraryRepository(pool);
    const service = new LibraryService(repository, {});
    const albumId = '1'.repeat(22), artistId = '2'.repeat(22), trackId = '3'.repeat(22);
    const uri = 'spotify:track:' + trackId;
    const album = {id: albumId, name: 'Album <test>', release_date: '2026', images: [{url: '/cover.jpg'}], artists: [{id: artistId, name: 'Band'}]};
    const track = {id: trackId, uri, name: 'Song <test>', duration_ms: 185000, artists: album.artists, album};
    const nextTrack = {...track, id: '4'.repeat(22), uri: 'spotify:track:' + '4'.repeat(22)};
    let access = null, refresh = null, failPlayback = false, albumPages = 0;
    const api = {
        getAccessToken: () => access, getRefreshToken: () => refresh,
        setAccessToken: value => { access = value; }, setRefreshToken: value => { refresh = value; },
        resetAccessToken: () => { access = null; }, resetRefreshToken: () => { refresh = null; },
        createAuthorizeURL: () => 'https://accounts.spotify.com/authorize?client_id=test',
        authorizationCodeGrant: async () => ({body: {access_token: 'test', refresh_token: 'test-refresh', expires_in: 3600}}),
        getTrack: async () => ({body: track}),
        getAlbum: async () => ({body: {...album, tracks: {items: [track], next: 'more'}}}),
        getAlbumTracks: async (id, options) => { assert.equal(options.offset, 1); albumPages++; return {body: {items: [nextTrack], next: null}}; },
        searchTracks: async () => ({body: {tracks: {items: [track]}}}),
        play: async ({uris}) => { assert.deepEqual(uris, [uri]); if (failPlayback) throw {statusCode: 404}; },
        pause: async () => { if (failPlayback) throw {statusCode: 404}; }
    };
    const {createApp} = require('../app');
    const app = createApp({pool, api});
    const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    t.after(async () => { app.locals.spotifyClient.logout(); await new Promise(resolve => server.close(resolve)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = (path, options) => fetch(base + path, {redirect: 'manual', ...options});
    const post = (path, body) => request(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});

    for (const path of ['/', '/tracks', '/albums', '/artists']) assert.equal((await request(path)).status, 200);
    assert.equal((await request('/search?q=test')).status, 401);
    assert.equal((await request('/page?uri=' + encodeURIComponent(uri))).status, 401);
    assert.equal((await request('/callback')).headers.get('location'), '/?login=missing_code');
    assert.equal((await request('/callback?error=denied')).headers.get('location'), '/?login=denied');
    assert.equal((await request('/callback?code=test')).headers.get('location'), '/?login=success');
    assert.equal((await request('/search?q=test')).status, 200);
    assert.equal((await request('/page?uri=' + encodeURIComponent(uri))).status, 200);
    const login = await request('/login?reauthorize=1');
    assert.equal(new URL(login.headers.get('location')).searchParams.get('show_dialog'), 'true');

    const saveTrack = () => request('/save-spotify', {method: 'POST', body: new URLSearchParams({uri, target: 'track'})});
    assert.equal((await saveTrack()).status, 303);
    assert.ok((await saveTrack()).headers.get('location').endsWith('saved=track'));
    let tracks = await repository.findTracks();
    assert.equal(tracks.length, 1); assert.ok(tracks[0] instanceof Track);
    const loadedTrack = await repository.findTrack(tracks[0].id);
    assert.ok(loadedTrack.album instanceof Album);
    assert.equal(loadedTrack.getDisplayImage(), '/cover.jpg');
    assert.equal(loadedTrack.getFormattedDuration(), '3:05');
    const band = await service.saveManual('artists', {name: 'Band', spotify_id: artistId, artist_type: 'group'});
    const personResponse = await post('/add-artist', {name: 'Person', artist_type: 'person', group_ids: [band.id]});
    assert.equal(personResponse.status, 201);
    const person = await personResponse.json();
    assert.equal((await post('/add-membership', {group_id: band.id, member_id: person.id})).status, 201);
    assert.equal((await post('/add-membership', {group_id: person.id, member_id: band.id})).status, 400);
    const loadedBand = await repository.findArtist(band.id);
    assert.ok(loadedBand instanceof GroupArtist); assert.ok(loadedBand.getMembers()[0] instanceof PersonArtist);
    assert.equal((await repository.findArtist(person.id)).getGroups()[0].id, band.id);
    const manualAlbum = await post('/add-album', {name: 'Manual album', artist_ids: [person.id]});
    assert.equal(manualAlbum.status, 201);
    const manualAlbumId = (await manualAlbum.json()).id;
    assert.equal((await post('/add-track', {name: 'Standalone', duration_ms: 0})).status, 201);
    assert.equal((await post('/add-track', {name: 'Manual song', album_id: manualAlbumId, artist_ids: [person.id]})).status, 201);
    assert.equal((await post('/add-track', {name: 'Rollback', artist_ids: [999999]})).status, 400);
    const [[rolledBack]] = await pool.execute('SELECT COUNT(*) AS count FROM tracks WHERE name = ?', ['Rollback']);
    assert.equal(rolledBack.count, 0);
    const saveAlbum = await request('/save-spotify', {method: 'POST', body: new URLSearchParams({uri, target: 'album'})});
    assert.ok(saveAlbum.headers.get('location').endsWith('saved=album')); assert.equal(albumPages, 1);
    assert.equal((await repository.findArtist(band.id)).artist_type, 'group');
    const [savedAlbum] = (await repository.findAlbums()).filter(item => item.spotify_id === albumId);
    assert.equal((await repository.findAlbum(savedAlbum.id)).getTracks().length, 2);
    for (const path of ['/tracks', '/albums', '/artists', `/track/${tracks[0].id}`, `/album/${savedAlbum.id}`, `/artist/${band.id}`, `/artist/${person.id}`]) {
        const response = await request(path); assert.equal(response.status, 200, path);
        const html = await response.text(); assert.ok(html.includes('Music Room')); assert.ok(!html.includes('Song <test>'));
    }
    for (const type of ['track', 'album', 'artist']) {
        assert.equal((await request(`/${type}/999999`)).status, 404);
        assert.equal((await request(`/${type}/invalid`)).status, 400);
    }
    for (const action of ['play', 'pause']) {
        assert.equal((await request(`/${action}?uri=${encodeURIComponent(uri)}`)).headers.get('location'), '/page?uri=' + encodeURIComponent(uri));
        failPlayback = true;
        assert.ok((await request(`/${action}?uri=${encodeURIComponent(uri)}`)).headers.get('location').endsWith(`${action}_failed`));
        failPlayback = false;
    }
    assert.equal((await request('/logout')).status, 200);
    assert.equal(access, null); assert.equal(refresh, null);
    assert.ok((await saveTrack()).headers.get('location').endsWith('saved=login'));
});
