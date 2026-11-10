const {recordId, isTrackUri} = require('../validation');

class LibraryController {
    constructor(repository, service, spotifyClient) {
        this.repository = repository;
        this.service = service;
        this.spotifyClient = spotifyClient;
    }

    async listTracks(req, res) {
        const filters = this.service.listOptions('tracks', req.query);
        res.render('tracks', {title: 'Your tracks', tracks: await this.repository.findTracks(filters), filters, notice: this.notice(req)});
    }

    async listAlbums(req, res) {
        const filters = this.service.listOptions('albums', req.query);
        res.render('albums', {title: 'Your albums', albums: await this.repository.findAlbums(filters), filters, notice: this.notice(req)});
    }

    async listArtists(req, res) {
        const filters = this.service.listOptions('artists', req.query);
        res.render('artists', {title: 'Your artists', artists: await this.repository.findArtists(filters), filters, notice: this.notice(req)});
    }

    missing(res, label) {
        return res.status(404).render('library-error', {title: `${label} not found`, error: `This ${label.toLowerCase()} is not in your library.`});
    }

    async showTrack(req, res) {
        const track = await this.repository.findTrack(recordId(req.params.id));
        if (!track) return this.missing(res, 'Track');
        res.render('track', {title: track.name, track, notice: this.notice(req)});
    }

    async showAlbum(req, res) {
        const album = await this.repository.findAlbum(recordId(req.params.id));
        if (!album) return this.missing(res, 'Album');
        res.render('album', {title: album.name, album, tracks: album.getTracks(), notice: this.notice(req)});
    }

    async showArtist(req, res) {
        const artist = await this.repository.findArtist(recordId(req.params.id));
        if (!artist) return this.missing(res, 'Artist');
        res.render('artist', {
            title: artist.name, artist, tracks: artist.getTracks(), albums: artist.getAlbums(),
            members: artist.getMembers?.() || [], groups: artist.getGroups?.() || [], notice: this.notice(req)
        });
    }

    notice(req) {
        const messages = {
            created: {type: 'primary', message: 'Record added successfully.'},
            updated: {type: 'primary', message: 'Changes saved successfully.'},
            deleted: {type: 'primary', message: 'Record deleted successfully.'},
            linked: {type: 'danger', message: 'Could not remove all references to this record. Nothing was deleted.'},
            delete_failed: {type: 'danger', message: 'Could not delete this record. Please try again.'}
        };
        const key = req.query?.notice;
        return typeof key === 'string' && Object.hasOwn(messages, key) ? messages[key] : null;
    }

    async loadRecord(kind, id) {
        const methods = {tracks: 'findTrack', albums: 'findAlbum', artists: 'findArtist'};
        return this.repository[methods[kind]](id);
    }

    async newRecord(kind, req, res, error = null, status = 200) {
        const albums = kind === 'tracks' ? await this.repository.findAlbums() : [];
        const artists = await this.repository.findArtists();
        return res.status(status).render('new-record', {
            title: `Add ${kind.slice(0, -1)}`, kind, values: error ? req.body || {} : {}, albums, artists, error
        });
    }

    async createRecord(kind, req, res) {
        try {
            const {id} = await this.service.createRecord(kind, req.body);
            return res.redirect(303, `/${kind.slice(0, -1)}/${id}?notice=created`);
        } catch (error) {
            let message = 'Could not add this record. Please try again.';
            let status = 500;
            if (error.statusCode === 400) { message = error.message; status = 400; }
            else if (error.code === 'ER_DUP_ENTRY') { message = 'That Spotify ID or URI is already used. Open the existing record instead.'; status = 409; }
            else if (error.code === 'ER_NO_REFERENCED_ROW_2') { message = 'A selected album or artist no longer exists. Please select again.'; status = 400; }
            else console.error('Library creation failed:', error.code || error.message);
            return this.newRecord(kind, req, res, message, status);
        }
    }

    async editRecord(kind, req, res, error = null, status = 200) {
        const id = recordId(req.params.id);
        const record = await this.loadRecord(kind, id);
        if (!record) return this.missing(res, kind.slice(0, -1));
        const values = error ? {...record, ...req.body, id} : record;
        const albums = kind === 'tracks' ? await this.repository.findAlbums() : [];
        return res.status(status).render('edit-record', {title: `Edit ${record.name}`, kind, record, values, albums, error});
    }

    async updateRecord(kind, req, res) {
        const id = recordId(req.params.id);
        try {
            if (!await this.service.updateRecord(kind, id, req.body)) return this.missing(res, kind.slice(0, -1));
            return res.redirect(303, `/${kind.slice(0, -1)}/${id}?notice=updated`);
        } catch (error) {
            let message = 'Could not save changes. Please try again.';
            let status = 500;
            if (error.statusCode === 400) { message = error.message; status = 400; }
            else if (error.code === 'ER_DUP_ENTRY') { message = 'That Spotify ID or URI is already used by another record.'; status = 409; }
            else if (error.code === 'ER_NO_REFERENCED_ROW_2') { message = 'The selected album no longer exists.'; status = 400; }
            else console.error('Library edit failed:', error.code || error.message);
            return this.editRecord(kind, req, res, message, status);
        }
    }

    async deleteRecord(kind, req, res) {
        const id = recordId(req.params.id);
        try {
            if (!await this.service.deleteRecord(kind, id)) return this.missing(res, kind.slice(0, -1));
            return res.redirect(303, `/${kind}?notice=deleted`);
        } catch (error) {
            const linked = error.code === 'ER_ROW_IS_REFERENCED_2' || error.code === 'ER_ROW_IS_REFERENCED';
            if (!linked) console.error('Library deletion failed:', error.code || error.message);
            return res.redirect(303, `/${kind.slice(0, -1)}/${id}?notice=${linked ? 'linked' : 'delete_failed'}`);
        }
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
