const ValidationError = require('../errors/ValidationError');
const {text, ids, isTrackUri} = require('../validation');

class LibraryService {
    constructor(repository, spotifyClient) {
        this.repository = repository;
        this.spotifyClient = spotifyClient;
    }

    async saveTrack(uri) { return this.saveSpotify(uri, 'track'); }
    async saveAlbum(uri) { return this.saveSpotify(uri, 'album'); }

    listOptions(kind, query = {}) {
        const sorts = {tracks: ['name', 'name_desc', 'newest', 'duration'], albums: ['name', 'name_desc', 'newest', 'release'], artists: ['name', 'name_desc', 'newest']};
        return {
            q: typeof query.q === 'string' ? query.q.trim().slice(0, 255) : '',
            sort: sorts[kind].includes(query.sort) ? query.sort : 'name',
            source: ['spotify', 'local'].includes(query.source) ? query.source : 'all',
            type: kind === 'artists' && ['person', 'group', 'unknown'].includes(query.type) ? query.type : 'all'
        };
    }

    recordData(kind, body = {}) {
        if (!['tracks', 'albums', 'artists'].includes(kind) || !body || typeof body !== 'object' || Array.isArray(body)) {
            throw new ValidationError('Provide valid record data.');
        }
        const optional = (field, max = 255) => body[field] === '' || body[field] == null ? null : text(body[field], field, max);
        const integer = (field, minimum) => {
            if (body[field] === '' || body[field] == null) return null;
            const raw = body[field];
            if ((typeof raw !== 'string' && typeof raw !== 'number') || !/^\d+$/.test(String(raw))) throw new ValidationError(`Invalid ${field}.`);
            const number = Number(raw);
            if (!Number.isSafeInteger(number) || number < minimum || number > 2147483647) throw new ValidationError(`Invalid ${field}.`);
            return number;
        };
        const data = {name: text(body.name, 'name', 255, true), image_url: optional('image_url', 2048), spotify_id: optional('spotify_id')};
        if (data.image_url && !/^https?:\/\/[^\s]+$/i.test(data.image_url) && !/^\/(?!\/)[^\s]*$/.test(data.image_url)) {
            throw new ValidationError('Image must be an http(s) URL or a local path starting with /.');
        }
        if (data.spotify_id && !/^[A-Za-z0-9]{22}$/.test(data.spotify_id)) throw new ValidationError('Spotify ID must contain 22 letters or digits.');
        if (kind === 'tracks') {
            data.duration_ms = integer('duration_ms', 0);
            data.album_id = integer('album_id', 1);
            data.spotify_uri = optional('spotify_uri');
            if (data.spotify_uri && !isTrackUri(data.spotify_uri)) throw new ValidationError('Invalid Spotify track URI.');
            if (data.spotify_id && data.spotify_uri && data.spotify_uri !== `spotify:track:${data.spotify_id}`) throw new ValidationError('Spotify ID and URI must refer to the same track.');
        } else if (kind === 'albums') {
            data.release_date = optional('release_date', 10);
            if (data.release_date) {
                if (!/^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/.test(data.release_date)) throw new ValidationError('Use YYYY, YYYY-MM, or YYYY-MM-DD for release date.');
                const parts = data.release_date.split('-').map(Number);
                if (parts[0] < 1 || (parts.length === 3 && new Date(`${data.release_date}T00:00:00Z`).getUTCDate() !== parts[2])) throw new ValidationError('Invalid release date.');
            }
        } else {
            data.artist_type = body.artist_type || 'unknown';
            if (!['person', 'group', 'unknown'].includes(data.artist_type)) throw new ValidationError('Invalid artist type.');
        }
        return data;
    }

    async updateRecord(kind, id, body = {}) {
        return this.repository.updateRecord(kind, id, this.recordData(kind, body));
    }

    async createRecord(kind, body = {}) {
        const data = this.recordData(kind, body);
        const selectedIds = field => {
            const raw = body[field] == null ? [] : Array.isArray(body[field]) ? body[field] : [body[field]];
            return ids(raw.filter(value => value !== '').map(value => {
                if (!['number', 'string'].includes(typeof value) || !/^[1-9]\d*$/.test(String(value))) throw new ValidationError(`Invalid ${field}.`);
                return Number(value);
            }), field);
        };
        const artistIds = kind === 'artists' ? [] : selectedIds('artist_ids');
        const groupIds = kind === 'artists' ? selectedIds('group_ids') : [];
        const memberIds = kind === 'artists' ? selectedIds('member_ids') : [];
        if (groupIds.length && data.artist_type !== 'person') throw new ValidationError('Choose Person to join a group.');
        if (memberIds.length && data.artist_type !== 'group') throw new ValidationError('Choose Group to add members.');
        return this.repository.saveManual(kind, data, {artistIds, groupIds, memberIds, updateArtistType: false, createOnly: true});
    }

    async deleteRecord(kind, id) {
        if (!['tracks', 'albums', 'artists'].includes(kind)) throw new ValidationError('Invalid library record type.');
        return this.repository.deleteRecord(kind, id);
    }

    async saveSpotify(uri, target) {
        if (!isTrackUri(uri) || !['track', 'album'].includes(target)) {
            throw new ValidationError('Provide a valid track URI and a track or album target.');
        }
        const track = await this.spotifyClient.getTrack(uri.split(':')[2]);
        const album = await this.spotifyClient.getAlbum(track.album.id);
        const tracks = target === 'track' ? [track] : [...album.tracks.items];
        if (target === 'album') {
            let next = album.tracks.next;
            let offset = tracks.length;
            while (next) {
                const page = await this.spotifyClient.getAlbumTracks(album.id, {limit: 50, offset});
                if (!page.items.length) throw new Error('Incomplete album track response.');
                tracks.push(...page.items);
                offset += page.items.length;
                next = page.next;
            }
        }
        return this.repository.saveSpotify(album, tracks);
    }

    async addMembership(groupId, memberId) {
        const [group] = ids([groupId], 'group_id');
        const [member] = ids([memberId], 'member_id');
        await this.repository.addMembership(group, member);
        return {group_id: group, member_id: member};
    }

    async saveManual(kind, body = {}) {
        if (!['artists', 'albums', 'tracks'].includes(kind)) throw new ValidationError('Invalid library record type.');
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
        return this.repository.saveManual(kind, data, {
            artistIds, groupIds, memberIds, updateArtistType: body.artist_type !== undefined
        });
    }
}

module.exports = LibraryService;
