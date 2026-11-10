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

    // Editing and browsing are database operations and work without Spotify login.
    const list = (kind, query) => repository[`find${kind[0].toUpperCase() + kind.slice(1)}`](service.listOptions(kind, query));
    assert.equal((await list('tracks', {q: 'Band'})).length, 2);
    assert.equal((await list('albums', {q: 'Person'})).length, 1);
    assert.equal((await list('tracks', {source: 'spotify'})).length, 2);
    assert.equal((await list('tracks', {source: 'local'})).length, 2);
    assert.equal((await list('artists', {type: 'group'})).length, 1);
    assert.equal((await list('tracks', {q: "' OR '1'='1"})).length, 0);
    await service.saveManual('tracks', {name: '100%_! literal'});
    assert.equal((await list('tracks', {q: '%_!'})).length, 1);
    const longest = await list('tracks', {sort: 'duration'});
    assert.equal(longest[0].duration_ms, 185000);
    const newest = await list('tracks', {sort: 'newest'});
    assert.ok(newest[0].id > newest.at(-1).id);
    const formPost = (path, body) => request(path, {method: 'POST', body: new URLSearchParams(body)});
    const detailIds = {track: tracks[0].id, album: savedAlbum.id, artist: band.id};
    for (const [kind, id] of Object.entries(detailIds)) {
        const detail = await (await request(`/${kind}/${id}`)).text();
        assert.ok(detail.includes(`/${kind}/${id}/edit`));
        assert.ok(detail.includes(`/${kind}/${id}/delete`));
        assert.ok(detail.includes('btn-primary')); assert.ok(detail.includes('btn-danger'));
        assert.equal((await request(`/${kind}/${id}/edit`)).status, 200);
        // The schema still protects direct deletes; the application explicitly unlinks in a transaction.
        await assert.rejects(pool.execute(`DELETE FROM ${kind}s WHERE id = ?`, [id]), error => error.code === 'ER_ROW_IS_REFERENCED_2');
        const badEdit = await formPost(`/${kind}/${id}/edit`, {name: ''});
        assert.equal(badEdit.status, 400); assert.ok((await badEdit.text()).includes('alert-danger'));
        assert.equal((await request(`/${kind}/999999/edit`)).status, 404);
        assert.equal((await formPost(`/${kind}/999999/delete`, {})).status, 404);
        assert.equal((await formPost(`/${kind}/bad/edit`, {name:'Bad'})).status, 400);
    }
    const editTrack = await formPost(`/track/${tracks[0].id}/edit`, {name: 'Edited <song>', duration_ms: '200000', album_id: String(savedAlbum.id), spotify_id: trackId, spotify_uri: uri, image_url: ''});
    assert.equal(editTrack.status, 303);
    const editedPage = await (await request(editTrack.headers.get('location'))).text();
    assert.ok(editedPage.includes('alert-primary')); assert.ok(editedPage.includes('Edited &lt;song&gt;'));
    const editedTrack = await repository.findTrack(tracks[0].id);
    assert.equal(editedTrack.duration_ms, 200000); assert.equal(editedTrack.artists.length, 1);
    assert.equal((await formPost(`/track/${tracks[0].id}/edit`, {name:'Invalid album', album_id:'999999'})).status, 400);
    assert.equal((await repository.findTrack(tracks[0].id)).name, 'Edited <song>');
    const collision = await formPost(`/track/${tracks[0].id}/edit`, {name:'Duplicate', spotify_id: nextTrack.id, spotify_uri: nextTrack.uri});
    assert.equal(collision.status, 409); assert.ok((await collision.text()).includes('already used'));
    assert.equal((await formPost(`/album/${savedAlbum.id}/edit`, {name:'Album edited', release_date:'2026-02-30'})).status, 400);
    assert.equal((await formPost(`/album/${savedAlbum.id}/edit`, {name:'Album edited', release_date:'2026-11', spotify_id:albumId, image_url:'/cover.jpg'})).status, 303);
    assert.equal((await repository.findAlbum(savedAlbum.id)).getTracks().length, 2);
    const wrongType = await formPost(`/artist/${band.id}/edit`, {name:'Band edited', artist_type:'person', spotify_id:artistId});
    assert.equal(wrongType.status, 400); assert.ok((await wrongType.text()).includes('memberships'));
    assert.equal((await formPost(`/artist/${band.id}/edit`, {name:'Band edited', artist_type:'group', spotify_id:artistId})).status, 303);
    assert.equal((await repository.findArtist(band.id)).getMembers().length, 1);
    for (const [table, kind] of [['tracks','track'], ['albums','album'], ['artists','artist']]) {
        const {id} = await service.saveManual(table, {name:'Unreferenced '+kind});
        const deleted = await formPost(`/${kind}/${id}/delete`, {});
        assert.equal(deleted.status, 303); assert.equal(deleted.headers.get('location'), `/${table}?notice=deleted`);
        assert.ok((await (await request(deleted.headers.get('location'))).text()).includes('alert-primary'));
        assert.equal((await request(`/${kind}/${id}`)).status, 404);
    }
    for (const kind of ['tracks','albums','artists']) {
        const response = await request(`/${kind}?q=nothing-matches&sort=name_desc&source=local`);
        assert.equal(response.status, 200);
        const html = await response.text(); assert.ok(html.includes('No '+kind+' match')); assert.ok(html.includes('value="nothing-matches"'));
    }

    // Browser creation forms, including all optional fields and relationship selection.
    for (const kind of ['tracks', 'albums', 'artists']) {
        assert.ok((await (await request(`/${kind}`)).text()).includes(`/${kind}/new`));
        const form = await request(`/${kind}/new`);
        assert.equal(form.status, 200);
        assert.ok((await form.text()).includes('Name is required. All other fields are optional.'));
        const invalid = await formPost(`/${kind}/new`, {name: '', image_url: '/keep-this.jpg'});
        assert.equal(invalid.status, 400);
        const html = await invalid.text(); assert.ok(html.includes('alert-danger')); assert.ok(html.includes('/keep-this.jpg'));
    }
    async function create(kind, fields) {
        const response = await formPost(`/${kind}/new`, fields);
        assert.equal(response.status, 303, await response.clone().text());
        const url = response.headers.get('location');
        assert.ok(url.endsWith('notice=created'));
        assert.ok((await (await request(url)).text()).includes('alert-primary'));
        return Number(url.match(/\/(\d+)\?/)[1]);
    }
    const newPerson = await create('artists', {name:'New person', artist_type:'person'});
    const newGroup = await create('artists', {name:'New group', artist_type:'group', member_ids:String(newPerson)});
    assert.equal((await repository.findArtist(newGroup)).getMembers()[0].id, newPerson);
    const newAlbum = await create('albums', {name:'New album', release_date:'2026', artist_ids:String(newGroup)});
    const newTrack = await create('tracks', [['name','New linked song'], ['album_id',String(newAlbum)], ['artist_ids',String(newPerson)], ['artist_ids',String(newGroup)], ['duration_ms','0'], ['spotify_id',''], ['image_url','']]);
    assert.deepEqual((await repository.findTrack(newTrack)).artists.map(a=>a.id), [newPerson,newGroup]);
    const secondTrack = await create('tracks', {name:'Keep this song', album_id:String(newAlbum), artist_ids:String(newGroup)});
    const keptAlbum = await create('albums', {name:'Keep this album', artist_ids:String(newGroup)});
    const simpleArtist = await create('artists', {name:'Name only artist'});
    assert.equal((await repository.findArtist(simpleArtist)).artist_type, 'unknown');
    const badLink = await formPost('/tracks/new', {name:'Must roll back create', artist_ids:'999999'});
    assert.equal(badLink.status, 400);
    assert.ok((await badLink.text()).includes('no longer exists'));
    const [[noPartial]] = await pool.execute('SELECT COUNT(*) AS count FROM tracks WHERE name = ?', ['Must roll back create']);
    assert.equal(noPartial.count, 0);
    const duplicateCreate = await formPost('/tracks/new', {name:'Must not replace song', spotify_id:trackId, spotify_uri:uri});
    assert.equal(duplicateCreate.status, 409);
    assert.equal((await repository.findTrack(tracks[0].id)).name, 'Edited <song>');
    const wrongMembership = await formPost('/artists/new', {name:'Wrong membership', artist_type:'unknown', group_ids:String(newGroup)});
    assert.equal(wrongMembership.status, 400);

    // Linked deletes remove only relationships and the requested record, retaining peers.
    assert.equal((await formPost(`/track/${newTrack}/delete`, {})).status, 303);
    assert.equal(await repository.findTrack(newTrack), null);
    assert.ok(await repository.findAlbum(newAlbum)); assert.ok(await repository.findArtist(newPerson));
    const [[trackLinks]] = await pool.execute('SELECT COUNT(*) AS count FROM track_artists WHERE track_id = ?', [newTrack]);
    assert.equal(trackLinks.count, 0);
    assert.equal((await formPost(`/album/${newAlbum}/delete`, {})).status, 303);
    assert.equal(await repository.findAlbum(newAlbum), null);
    assert.equal((await repository.findTrack(secondTrack)).album_id, null);
    assert.ok(await repository.findArtist(newGroup));
    assert.equal((await formPost(`/artist/${newPerson}/delete`, {})).status, 303);
    assert.equal((await repository.findArtist(newGroup)).getMembers().length, 0);
    assert.equal((await formPost(`/artist/${newGroup}/delete`, {})).status, 303);
    assert.ok(await repository.findTrack(secondTrack)); assert.ok(await repository.findAlbum(keptAlbum));
    assert.equal((await repository.findTrack(secondTrack)).artists.length, 0);
    assert.equal((await repository.findAlbum(keptAlbum)).artists.length, 0);
    // Deleting a group also leaves people intact.
    const otherGroup = await create('artists', {name:'Other group', artist_type:'group', member_ids:String(person.id)});
    assert.equal((await formPost(`/artist/${otherGroup}/delete`, {})).status, 303);
    assert.ok(await repository.findArtist(person.id));
});
