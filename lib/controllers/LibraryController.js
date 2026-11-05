const {recordId, isTrackUri} = require('../validation');

class LibraryController {
    constructor(repository, service, spotifyClient) {
        this.repository = repository;
        this.service = service;
        this.spotifyClient = spotifyClient;
    }

    async listTracks(req, res) {
        res.render('tracks', {title: 'Your tracks', tracks: await this.repository.findTracks()});
    }

    async listAlbums(req, res) {
        res.render('albums', {title: 'Your albums', albums: await this.repository.findAlbums()});
    }

    async listArtists(req, res) {
        res.render('artists', {title: 'Your artists', artists: await this.repository.findArtists()});
    }

    missing(res, label) {
        return res.status(404).render('library-error', {title: `${label} not found`, error: `This ${label.toLowerCase()} is not in your library.`});
    }

    async showTrack(req, res) {
        const track = await this.repository.findTrack(recordId(req.params.id));
        if (!track) return this.missing(res, 'Track');
        res.render('track', {title: track.name, track});
    }

    async showAlbum(req, res) {
        const album = await this.repository.findAlbum(recordId(req.params.id));
        if (!album) return this.missing(res, 'Album');
        res.render('album', {title: album.name, album, tracks: album.getTracks()});
    }

    async showArtist(req, res) {
        const artist = await this.repository.findArtist(recordId(req.params.id));
        if (!artist) return this.missing(res, 'Artist');
        res.render('artist', {
            title: artist.name, artist, tracks: artist.getTracks(), albums: artist.getAlbums(),
            members: artist.getMembers?.() || [], groups: artist.getGroups?.() || []
        });
    }

    readError(error, req, res) {
        const invalid = error.statusCode === 400;
        if (!invalid) console.error('Library read failed:', error.code || error.message);
        res.status(invalid ? 400 : 500).render('library-error', {
            title: invalid ? 'Invalid ID' : 'Library unavailable',
            error: invalid ? error.message : 'Could not load your library. Please try again.'
        });
    }

    writeError(error, res) {
        console.error('Library save failed:', error.code || error.message);
        const invalidReference = error.code === 'ER_NO_REFERENCED_ROW_2';
        const status = error.statusCode === 400 || invalidReference ? 400 : 500;
        return res.status(status).json({error: status === 500 ? 'Could not save to your library.'
            : invalidReference ? 'Referenced album or artist does not exist.' : error.message});
    }

    async addAlbum(req, res) { return this.addManual('albums', req, res); }
    async addTrack(req, res) { return this.addManual('tracks', req, res); }
    async addArtist(req, res) { return this.addManual('artists', req, res); }

    async addManual(kind, req, res) {
        try {
            const result = await this.service.saveManual(kind, req.body);
            return res.status(201).json(result);
        } catch (error) { return this.writeError(error, res); }
    }

    async addMembership(req, res) {
        try {
            const result = await this.service.addMembership(req.body?.group_id, req.body?.member_id);
            return res.status(201).json(result);
        } catch (error) { return this.writeError(error, res); }
    }

    async save(req, res) {
        const {uri, target} = req.body || {};
        if (!isTrackUri(uri) || !['track', 'album'].includes(target)) {
            return res.status(400).send('Provide a valid track URI and a track or album target.');
        }
        const returnUrl = `/page?uri=${encodeURIComponent(uri)}`;
        if (!this.spotifyClient.isAuthenticated()) return res.redirect(303, `${returnUrl}&saved=login`);
        try {
            if (target === 'track') await this.service.saveTrack(uri);
            else await this.service.saveAlbum(uri);
            return res.redirect(303, `${returnUrl}&saved=${target}`);
        } catch (error) {
            console.error('Spotify library import failed:', error.code || error.statusCode || error.message);
            if (error.statusCode === 401) this.spotifyClient.resetAccessToken();
            return res.redirect(303, `${returnUrl}&saved=${error.statusCode === 401 ? 'login' : 'failed'}`);
        }
    }
}

module.exports = LibraryController;
