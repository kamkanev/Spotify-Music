const ValidationError = require('../errors/ValidationError');
const {text, ids, isTrackUri} = require('../validation');

class LibraryService {
    constructor(repository, spotifyClient) {
        this.repository = repository;
        this.spotifyClient = spotifyClient;
    }

    async saveTrack(uri) { return this.saveSpotify(uri, 'track'); }
    async saveAlbum(uri) { return this.saveSpotify(uri, 'album'); }

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
