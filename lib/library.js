class ValidationError extends Error {
    constructor(message) { super(message); this.statusCode = 400; }
}

function text(value, field, max = 255, required = false) {
    if (value == null && !required) return null;
    if (typeof value !== 'string' || !value.trim() || value.length > max) {
        throw new ValidationError(`Invalid ${field}.`);
    }
    return value.trim();
}

function ids(value, field) {
    if (value == null) return [];
    if (!Array.isArray(value) || value.some(id => !Number.isSafeInteger(id) || id <= 0)) {
        throw new ValidationError(`${field} must be an array of positive integer database IDs.`);
    }
    return [...new Set(value)];
}

async function transaction(db, work) {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const result = await work(connection);
        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

// Only these fixed table/column definitions are interpolated; values use placeholders.
const columns = {
    artists: ['name', 'artist_type', 'image_url', 'spotify_id'],
    albums: ['name', 'release_date', 'image_url', 'spotify_id'],
    tracks: ['name', 'duration_ms', 'image_url', 'spotify_id', 'spotify_uri', 'album_id']
};

async function insert(connection, table, data) {
    const fields = columns[table];
    const values = fields.map(field => data[field] ?? null);
    // Keep existing metadata and manually assigned artist types on repeated imports.
    const [result] = await connection.execute(
        `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')}) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
        values
    );
    return result.insertId;
}

async function linkArtists(connection, table, ownerColumn, ownerId, artistIds) {
    for (const [order, artistId] of artistIds.entries()) {
        await connection.execute(
            `INSERT INTO ${table} (${ownerColumn}, artist_id, artist_order) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE artist_order = VALUES(artist_order)`,
            [ownerId, artistId, order]
        );
    }
}

async function importArtists(connection, artists = []) {
    const result = [];
    for (const artist of artists) {
        result.push(await insert(connection, 'artists', {
            name: text(artist.name, 'artist name', 255, true),
            spotify_id: text(artist.id, 'Spotify artist ID', 255, true),
            artist_type: 'unknown',
            image_url: artist.images?.[0]?.url ?? null
        }));
    }
    return [...new Set(result)];
}

async function importAlbum(connection, album) {
    const id = await insert(connection, 'albums', {
        name: text(album.name, 'album name', 255, true),
        spotify_id: text(album.id, 'Spotify album ID', 255, true),
        release_date: album.release_date,
        image_url: album.images?.[0]?.url ?? null
    });
    await linkArtists(connection, 'album_artists', 'album_id', id, await importArtists(connection, album.artists));
    return id;
}

async function importTrack(connection, track, albumId) {
    const id = await insert(connection, 'tracks', {
        name: text(track.name, 'track name', 255, true),
        duration_ms: track.duration_ms,
        spotify_id: text(track.id, 'Spotify track ID', 255, true),
        spotify_uri: text(track.uri, 'Spotify track URI', 255, true),
        album_id: albumId
    });
    await linkArtists(connection, 'track_artists', 'track_id', id, await importArtists(connection, track.artists));
    return id;
}

async function saveSpotify(db, album, tracks) {
    return transaction(db, async connection => {
        const albumId = await importAlbum(connection, album);
        const trackIds = [];
        for (const track of tracks) trackIds.push(await importTrack(connection, track, albumId));
        return {album_id: albumId, track_ids: trackIds};
    });
}

async function membership(connection, groupId, memberId) {
    if (groupId === memberId) throw new ValidationError('An artist cannot be their own group member.');
    const [rows] = await connection.execute('SELECT id, artist_type FROM artists WHERE id IN (?, ?) ORDER BY id FOR UPDATE', [groupId, memberId]);
    if (rows.length !== 2 || rows.find(row => row.id === groupId)?.artist_type !== 'group'
        || rows.find(row => row.id === memberId)?.artist_type !== 'person') {
        throw new ValidationError('Membership requires an existing group and a person artist.');
    }
    await connection.execute('INSERT INTO artist_memberships (group_id, member_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE member_id = VALUES(member_id)', [groupId, memberId]);
}

async function saveManual(db, kind, body = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('Provide a JSON object.');
    const data = {
        name: text(body.name, 'name', 255, true),
        spotify_id: text(body.spotify_id, 'spotify_id'),
        image_url: text(body.image_url, 'image_url', 2048)
    };
    const artistIds = ids(body.artist_ids, 'artist_ids');
    const groupIds = ids(body.group_ids, 'group_ids');
    const memberIds = ids(body.member_ids, 'member_ids');
    if (kind === 'artists') {
        data.artist_type = body.artist_type ?? 'unknown';
        if (!['person', 'group', 'unknown'].includes(data.artist_type)) throw new ValidationError('Invalid artist_type.');
    } else if (kind === 'albums') {
        data.release_date = text(body.release_date, 'release_date', 10);
        if (data.release_date && !/^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/.test(data.release_date)) throw new ValidationError('Use YYYY, YYYY-MM, or YYYY-MM-DD for release_date.');
    } else {
        data.duration_ms = body.duration_ms ?? null;
        data.album_id = body.album_id ?? null;
        data.spotify_uri = text(body.spotify_uri, 'spotify_uri');
        if (data.duration_ms !== null && (!Number.isInteger(data.duration_ms) || data.duration_ms < 0 || data.duration_ms > 2147483647)) throw new ValidationError('Invalid duration_ms.');
        if (data.album_id !== null && (!Number.isSafeInteger(data.album_id) || data.album_id <= 0)) throw new ValidationError('Invalid album_id.');
    }
    return transaction(db, async connection => {
        const id = await insert(connection, kind, data);
        if (kind === 'tracks') await linkArtists(connection, 'track_artists', 'track_id', id, artistIds);
        if (kind === 'albums') await linkArtists(connection, 'album_artists', 'album_id', id, artistIds);
        if (kind === 'artists') {
            if (body.artist_type !== undefined) {
                const [existingMemberships] = await connection.execute(
                    'SELECT group_id, member_id FROM artist_memberships WHERE group_id = ? OR member_id = ?', [id, id]
                );
                if (existingMemberships.some(row => row.group_id === id && data.artist_type !== 'group'
                    || row.member_id === id && data.artist_type !== 'person')) {
                    throw new ValidationError('Artist type conflicts with existing group memberships.');
                }
                await connection.execute('UPDATE artists SET artist_type = ? WHERE id = ?', [data.artist_type, id]);
            }
            for (const groupId of groupIds) await membership(connection, groupId, id);
            for (const memberId of memberIds) await membership(connection, id, memberId);
        }
        return {id};
    });
}

module.exports = {saveManual, saveSpotify, transaction, membership, ids, ValidationError};
