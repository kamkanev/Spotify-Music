const test = require('node:test');
const assert = require('node:assert/strict');
const {Track, Album, Artist, PersonArtist, GroupArtist, createArtist} = require('../lib/models');
const LibraryService = require('../lib/services/LibraryService');
const LibraryRepository = require('../lib/repositories/LibraryRepository');
const SpotifyClient = require('../lib/services/SpotifyClient');
const LibraryController = require('../lib/controllers/LibraryController');

test('track methods preserve image fallback, own artwork, and duration formatting', () => {
    const album = new Album({id: 1, name: 'Album', image_url: '/album.jpg'});
    const track = new Track({id: 2, name: 'Track', duration_ms: 185000}).setAlbum(album);
    assert.equal(track.getDisplayImage(), '/album.jpg');
    assert.equal(track.getFormattedDuration(), '3:05');
    track.image_url = '/track.jpg';
    assert.equal(track.getDisplayImage(), '/track.jpg');
    assert.equal(new Track({name: 'Unknown'}).getFormattedDuration(), 'Unknown');
    assert.equal(new Track({name: 'Zero', duration_ms: 0}).getFormattedDuration(), '0:00');
});

test('artist factory instantiates real subclasses and preserves unknown artists', () => {
    assert.ok(createArtist({id: 1, name: 'Person', artist_type: 'person'}) instanceof PersonArtist);
    assert.ok(createArtist({id: 2, name: 'Group', artist_type: 'group'}) instanceof GroupArtist);
    const unknown = createArtist({id: 3, name: 'Unknown', artist_type: 'unknown'});
    assert.equal(unknown.constructor, Artist);
});

test('group aggregation maintains reciprocal membership without duplicate members', () => {
    const group = new GroupArtist({id: 1, name: 'Band'});
    const person = new PersonArtist({id: 2, name: 'Person'});
    group.addMember(person).addMember(person);
    assert.deepEqual(group.getMembers(), [person]);
    assert.deepEqual(person.getGroups(), [group]);
    assert.throws(() => group.addMember(new Artist({id: 3, name: 'Unknown'})), /Membership/);
    assert.throws(() => group.addMember(new PersonArtist({id: 1, name: 'Same'})), /Membership/);
    group.getMembers().pop();
    assert.equal(group.getMembers().length, 1);
});

test('service validates manual input and forwards ordered internal IDs', async () => {
    let received;
    const service = new LibraryService({saveManual: async (...args) => { received = args; return {id: 4}; }}, {});
    assert.deepEqual(await service.saveManual('tracks', {name: ' Song ', duration_ms: 0, artist_ids: [2, 1, 2]}), {id: 4});
    assert.equal(received[1].name, 'Song');
    assert.deepEqual(received[2].artistIds, [2, 1]);
    for (const body of [{name: ''}, {name: 'Song', artist_ids: ['1']}, {name: 'Song', duration_ms: -1}, null]) {
        await assert.rejects(service.saveManual('tracks', body), error => error.statusCode === 400);
    }
    await assert.rejects(service.saveManual('unknown', {name: 'Song'}));
});

test('album service imports every Spotify page before starting persistence', async () => {
    const first = {id: 'first'};
    const second = {id: 'second'};
    const album = {id: 'album', tracks: {items: [first], next: 'next'}};
    let saved;
    const service = new LibraryService({saveSpotify: async (...args) => { saved = args; }}, {
        getTrack: async () => ({album: {id: 'album'}}),
        getAlbum: async () => album,
        getAlbumTracks: async (id, options) => {
            assert.equal(id, 'album'); assert.equal(options.offset, 1);
            return {items: [second], next: null};
        }
    });
    await service.saveAlbum('spotify:track:6rqhFgbbKwnb9MLmUQDhG6');
    assert.deepEqual(saved, [album, [first, second]]);
    saved = null;
    service.spotifyClient.getAlbumTracks = async () => ({items: [], next: 'next'});
    await assert.rejects(service.saveAlbum('spotify:track:6rqhFgbbKwnb9MLmUQDhG6'), /Incomplete/);
    assert.equal(saved, null);
});

test('repository rolls back failed work and releases its connection', async () => {
    const calls = [];
    const connection = {
        beginTransaction: async () => calls.push('begin'),
        commit: async () => calls.push('commit'),
        rollback: async () => calls.push('rollback'),
        release: () => calls.push('release')
    };
    const repository = new LibraryRepository({getConnection: async () => connection});
    await assert.rejects(repository.transaction(async () => { throw new Error('failure'); }), /failure/);
    assert.deepEqual(calls, ['begin', 'rollback', 'release']);
});

test('SpotifyClient owns the login timer and clears both tokens on logout', async () => {
    let access, refresh;
    const api = {
        authorizationCodeGrant: async () => ({body: {access_token: 'test', refresh_token: 'refresh', expires_in: 3600}}),
        getAccessToken: () => access,
        setAccessToken: value => { access = value; },
        setRefreshToken: value => { refresh = value; },
        resetAccessToken: () => { access = null; },
        resetRefreshToken: () => { refresh = null; },
        createAuthorizeURL: () => 'https://accounts.spotify.com/authorize?client_id=test'
    };
    const client = new SpotifyClient(api);
    assert.equal(new URL(client.createAuthorizeURL([], true)).searchParams.get('show_dialog'), 'true');
    await client.authorize('code');
    assert.ok(client.isAuthenticated());
    assert.ok(client.refreshTimer);
    client.logout();
    assert.equal(client.refreshTimer, null);
    assert.equal(client.isAuthenticated(), false);
    assert.equal(refresh, null);
});

test('controller rejects invalid IDs before querying and handles missing records', async () => {
    let calls = 0;
    const controller = new LibraryController({findTrack: async () => { calls++; return null; }}, {}, {});
    await assert.rejects(controller.showTrack({params: {id: '1 OR 1=1'}}, {}), error => error.statusCode === 400);
    assert.equal(calls, 0);
    let code;
    await controller.showTrack({params: {id: '1'}}, {
        status(value) { code = value; return this; },
        render(view) { assert.equal(view, 'library-error'); }
    });
    assert.equal(code, 404);
});
