const ValidationError = require('../errors/ValidationError');
const {text} = require('../validation');
const {Track, Album, createArtist, GroupArtist, PersonArtist} = require('../models');

const columns = {
    artists: ['name', 'artist_type', 'image_url', 'spotify_id'],
    albums: ['name', 'release_date', 'image_url', 'spotify_id'],
    tracks: ['name', 'duration_ms', 'image_url', 'spotify_id', 'spotify_uri', 'album_id']
};


class LibraryRepository {
    constructor(pool) { this.pool = pool; }

    async rows(sql, values = []) {
        const [result] = await this.pool.execute(sql, values);
        return result;
    }

    async credits(items, table, column) {
        if (!items.length) return items;
        const artists = await this.rows(
            `SELECT c.${column} AS owner_id, a.* FROM ${table} c JOIN artists a ON a.id = c.artist_id WHERE c.${column} IN (${items.map(() => '?').join(',')}) ORDER BY c.artist_order, a.id`,
            items.map(item => item.id)
        );
        const grouped = new Map();
        for (const row of artists) {
            if (!grouped.has(row.owner_id)) grouped.set(row.owner_id, []);
            grouped.get(row.owner_id).push(createArtist(row));
        }
        for (const item of items) item.artists = grouped.get(item.id) || [];
        return items;
    }

    async loadTracks(condition = '', values = [], order = 't.name, t.id') {
        const rows = await this.rows(`SELECT t.*, al.name AS album_name,
            COALESCE(NULLIF(t.image_url, ''), al.image_url) AS cover_url
            FROM tracks t LEFT JOIN albums al ON al.id = t.album_id ${condition} ORDER BY ${order}`, values);
        return this.credits(rows.map(row => new Track(row)), 'track_artists', 'track_id');
    }

    browseQuery(kind, options = {}) {
        const aliases = {tracks: 't', albums: 'al', artists: 'a'};
        const alias = aliases[kind];
        const sorts = {
            tracks: {name: 't.name, t.id', name_desc: 't.name DESC, t.id', newest: 't.id DESC', duration: 't.duration_ms DESC, t.id'},
            albums: {name: 'al.name, al.id', name_desc: 'al.name DESC, al.id', newest: 'al.id DESC', release: 'al.release_date DESC, al.id'},
            artists: {name: 'a.name, a.id', name_desc: 'a.name DESC, a.id', newest: 'a.id DESC'}
        };
        const clauses = [], values = [];
        if (options.q) {
            // Treat %, _ and ! as literal search characters.
            const pattern = `%${options.q.replace(/[!%_]/g, '!$&')}%`;
            if (kind === 'tracks') {
                clauses.push("(t.name LIKE ? ESCAPE '!' OR al.name LIKE ? ESCAPE '!' OR EXISTS (SELECT 1 FROM track_artists ta JOIN artists ca ON ca.id = ta.artist_id WHERE ta.track_id = t.id AND ca.name LIKE ? ESCAPE '!'))");
                values.push(pattern, pattern, pattern);
            } else if (kind === 'albums') {
                clauses.push("(al.name LIKE ? ESCAPE '!' OR EXISTS (SELECT 1 FROM album_artists aa JOIN artists ca ON ca.id = aa.artist_id WHERE aa.album_id = al.id AND ca.name LIKE ? ESCAPE '!'))");
                values.push(pattern, pattern);
            } else {
                clauses.push("a.name LIKE ? ESCAPE '!'");
                values.push(pattern);
            }
        }
        if (options.source === 'spotify') clauses.push(`${alias}.spotify_id IS NOT NULL`);
        if (options.source === 'local') clauses.push(`${alias}.spotify_id IS NULL`);
        if (kind === 'artists' && ['person', 'group', 'unknown'].includes(options.type)) {
            clauses.push("COALESCE(a.artist_type, 'unknown') = ?");
            values.push(options.type);
        }
        return {where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values,
            order: Object.hasOwn(sorts[kind], options.sort || 'name') ? sorts[kind][options.sort || 'name'] : sorts[kind].name};
    }

    async findTracks(options = {}) {
        const query = this.browseQuery('tracks', options);
        return this.loadTracks(query.where, query.values, query.order);
    }

    async findAlbums(options = {}) {
        const query = this.browseQuery('albums', options);
        const rows = await this.rows(`SELECT al.* FROM albums al ${query.where} ORDER BY ${query.order}`, query.values);
        return this.credits(rows.map(row => new Album(row)), 'album_artists', 'album_id');
    }

    async findArtists(options = {}) {
        const query = this.browseQuery('artists', options);
        return (await this.rows(`SELECT a.* FROM artists a ${query.where} ORDER BY ${query.order}`, query.values)).map(createArtist);
    }

    async updateRecord(kind, id, data) {
        if (!Object.hasOwn(columns, kind)) throw new ValidationError('Invalid library record type.');
        return this.transaction(async connection => {
            const [existing] = await connection.execute(`SELECT id FROM ${kind} WHERE id = ? FOR UPDATE`, [id]);
            if (!existing.length) return false;
            if (kind === 'artists') {
                const [memberships] = await connection.execute('SELECT group_id, member_id FROM artist_memberships WHERE group_id = ? OR member_id = ?', [id, id]);
                if (memberships.some(row => row.group_id === id && data.artist_type !== 'group'
                    || row.member_id === id && data.artist_type !== 'person')) {
                    throw new ValidationError('Remove group memberships before changing this artist type.');
                }
            }
            const fields = columns[kind];
            await connection.execute(`UPDATE ${kind} SET ${fields.map(field => `${field} = ?`).join(', ')} WHERE id = ?`, [...fields.map(field => data[field] ?? null), id]);
            return true;
        });
    }

    async deleteRecord(kind, id) {
        if (!Object.hasOwn(columns, kind)) throw new ValidationError('Invalid library record type.');
        return this.transaction(async connection => {
            const [rows] = await connection.execute(`SELECT id FROM ${kind} WHERE id = ? FOR UPDATE`, [id]);
            if (!rows.length) return false;
            if (kind === 'tracks') {
                await connection.execute('DELETE FROM track_artists WHERE track_id = ?', [id]);
            } else if (kind === 'albums') {
                await connection.execute('UPDATE tracks SET album_id = NULL WHERE album_id = ?', [id]);
                await connection.execute('DELETE FROM album_artists WHERE album_id = ?', [id]);
            } else {
                await connection.execute('DELETE FROM track_artists WHERE artist_id = ?', [id]);
                await connection.execute('DELETE FROM album_artists WHERE artist_id = ?', [id]);
                await connection.execute('DELETE FROM artist_memberships WHERE group_id = ? OR member_id = ?', [id, id]);
            }
            await connection.execute(`DELETE FROM ${kind} WHERE id = ?`, [id]);
            return true;
        });
    }

    async findTrack(id) {
        const [track] = await this.loadTracks('WHERE t.id = ?', [id]);
        if (track?.album_id) {
            const [row] = await this.rows('SELECT * FROM albums WHERE id = ?', [track.album_id]);
            if (row) {
                const [album] = await this.credits([new Album(row)], 'album_artists', 'album_id');
                track.setAlbum(album);
            }
        }
        return track || null;
    }

    async findAlbum(id) {
        const [row] = await this.rows('SELECT * FROM albums WHERE id = ?', [id]);
        if (!row) return null;
        const [album] = await this.credits([new Album(row)], 'album_artists', 'album_id');
        album.tracks = await this.loadTracks('WHERE t.album_id = ?', [id], 't.id');
        for (const track of album.tracks) track.setAlbum(album);
        return album;
    }

    async findArtist(id) {
        const [row] = await this.rows('SELECT * FROM artists WHERE id = ?', [id]);
        if (!row) return null;
        const artist = createArtist(row);
        artist.tracks = await this.loadTracks('JOIN track_artists ta ON ta.track_id = t.id WHERE ta.artist_id = ?', [id]);
        const albums = await this.rows('SELECT al.* FROM albums al JOIN album_artists aa ON aa.album_id = al.id WHERE aa.artist_id = ? ORDER BY al.name, al.id', [id]);
        artist.albums = await this.credits(albums.map(album => new Album(album)), 'album_artists', 'album_id');
        if (artist instanceof GroupArtist) {
            const members = await this.rows('SELECT a.* FROM artists a JOIN artist_memberships m ON m.member_id = a.id WHERE m.group_id = ? ORDER BY a.name, a.id', [id]);
            for (const member of members) artist.addMember(createArtist(member));
        }
        if (artist instanceof PersonArtist) {
            artist.groups = (await this.rows('SELECT a.* FROM artists a JOIN artist_memberships m ON m.group_id = a.id WHERE m.member_id = ? ORDER BY a.name, a.id', [id])).map(createArtist);
        }
        return artist;
    }

    async addMembership(groupId, memberId) {
        return this.transaction(connection => this.membership(connection, groupId, memberId));
    }

    async transaction(work) {
        const connection = await this.pool.getConnection();
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


    async insert(connection, table, data, reuseExisting = true) {
        const fields = columns[table];
        const values = fields.map(field => data[field] ?? null);
        // Keep existing metadata and manually assigned artist types on repeated imports.
        const [result] = await connection.execute(
            `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})${reuseExisting ? ' ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)' : ''}`,
            values
        );
        return result.insertId;
    }

    async linkArtists(connection, table, ownerColumn, ownerId, artistIds) {
        for (const [order, artistId] of artistIds.entries()) {
            await connection.execute(
                `INSERT INTO ${table} (${ownerColumn}, artist_id, artist_order) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE artist_order = VALUES(artist_order)`,
                [ownerId, artistId, order]
            );
        }
    }

    async importArtists(connection, artists = []) {
        const result = [];
        for (const artist of artists) {
            result.push(await this.insert(connection, 'artists', {
                name: text(artist.name, 'artist name', 255, true),
                spotify_id: text(artist.id, 'Spotify artist ID', 255, true),
                artist_type: 'unknown',
                image_url: artist.images?.[0]?.url ?? null
            }));
        }
        return [...new Set(result)];
    }

    async importAlbum(connection, album) {
        const id = await this.insert(connection, 'albums', {
            name: text(album.name, 'album name', 255, true),
            spotify_id: text(album.id, 'Spotify album ID', 255, true),
            release_date: album.release_date,
            image_url: album.images?.[0]?.url ?? null
        });
        await this.linkArtists(connection, 'album_artists', 'album_id', id, await this.importArtists(connection, album.artists));
        return id;
    }

    async importTrack(connection, track, albumId) {
        const id = await this.insert(connection, 'tracks', {
            name: text(track.name, 'track name', 255, true),
            duration_ms: track.duration_ms,
            spotify_id: text(track.id, 'Spotify track ID', 255, true),
            spotify_uri: text(track.uri, 'Spotify track URI', 255, true),
            album_id: albumId
        });
        await this.linkArtists(connection, 'track_artists', 'track_id', id, await this.importArtists(connection, track.artists));
        return id;
    }

    async saveSpotify(album, tracks) {
        return this.transaction(async connection => {
            const albumId = await this.importAlbum(connection, album);
            const trackIds = [];
            for (const track of tracks) trackIds.push(await this.importTrack(connection, track, albumId));
            return {album_id: albumId, track_ids: trackIds};
        });
    }

    async membership(connection, groupId, memberId) {
        if (groupId === memberId) throw new ValidationError('An artist cannot be their own group member.');
        const [rows] = await connection.execute('SELECT id, artist_type FROM artists WHERE id IN (?, ?) ORDER BY id FOR UPDATE', [groupId, memberId]);
        if (rows.length !== 2 || rows.find(row => row.id === groupId)?.artist_type !== 'group'
            || rows.find(row => row.id === memberId)?.artist_type !== 'person') {
            throw new ValidationError('Membership requires an existing group and a person artist.');
        }
        await connection.execute('INSERT INTO artist_memberships (group_id, member_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE member_id = VALUES(member_id)', [groupId, memberId]);
    }

    async saveManual(kind, data, {artistIds, groupIds, memberIds, updateArtistType, createOnly = false}) {
        return this.transaction(async connection => {
            const id = await this.insert(connection, kind, data, !createOnly);
            if (kind === 'tracks') await this.linkArtists(connection, 'track_artists', 'track_id', id, artistIds);
            if (kind === 'albums') await this.linkArtists(connection, 'album_artists', 'album_id', id, artistIds);
            if (kind === 'artists') {
                if (updateArtistType) {
                    const [existingMemberships] = await connection.execute(
                        'SELECT group_id, member_id FROM artist_memberships WHERE group_id = ? OR member_id = ?', [id, id]
                    );
                    if (existingMemberships.some(row => row.group_id === id && data.artist_type !== 'group'
                        || row.member_id === id && data.artist_type !== 'person')) {
                        throw new ValidationError('Artist type conflicts with existing group memberships.');
                    }
                    await connection.execute('UPDATE artists SET artist_type = ? WHERE id = ?', [data.artist_type, id]);
                }
                for (const groupId of groupIds) await this.membership(connection, groupId, id);
                for (const memberId of memberIds) await this.membership(connection, id, memberId);
            }
            return {id};
        });
    }
}

module.exports = LibraryRepository;
