const {isTrackUri} = require('../validation');

class SpotifyController {
    constructor(spotifyClient) { this.spotifyClient = spotifyClient; }

    async login(req, res) {
        const scopes = ['user-read-private', 'user-read-email', 'user-read-playback-state', 'user-modify-playback-state',
           'user-read-currently-playing', 'user-read-recently-played', 'user-top-read', 'playlist-read-private',
            'playlist-read-collaborative'];
        const authorizeURL = new URL(this.spotifyClient.createAuthorizeURL(scopes, req.query.reauthorize === '1'));
        res.redirect(authorizeURL.toString());
    }

    async search(req, res) {
        const {q} = req.query;
        const sendData = {
            error: null,
            trackArray: []
        };
        if (typeof q !== 'string' || !q.trim()) {
            sendData.error = 'Provide a search term';
            return res.status(400).render('uri', sendData);
        }
        if (!this.spotifyClient.isAuthenticated()) {
            sendData.error = 'Please log in at /login before searching.';
            return res.status(401).render('uri', sendData);
        }
        try {
            const data = await this.spotifyClient.searchTracks(q.trim());
            sendData.trackArray = data.tracks.items;
            if (!sendData.trackArray.length) {
                sendData.error = 'No tracks found.';
                return res.status(404).render('uri', sendData);
            }
            
            return res.render('uri', sendData);
        } catch (err) {
            const status = err.statusCode || 502;
            if (status === 401) {
                this.spotifyClient.resetAccessToken();
                sendData.error = 'Spotify login expired. Please log in again at /login.';
                return res.status(401).render('uri', sendData);
            }
            if (status === 403) {
                console.error('Spotify search rejected: HTTP 403');
                sendData.error = 'Spotify denied access (HTTP 403). In the Spotify Developer Dashboard, open the app matching your SPOTIFY_CLIENT_ID, add the Spotify account you sign in with under Settings > Users Management, and confirm the app owner has active Spotify Premium. Then sign in again at /login. Changing the search term will not fix this access error.';
                return res.status(403).render('uri', sendData);
            }
            let body = err.body;
            if (typeof body === 'string') {
                try { body = JSON.parse(body); } catch { /* Plain-text Spotify response. */ }
            }
            const detail = body?.error?.message || body?.error_description || body?.message || body?.error || body;
            const message = typeof detail === 'string' ? detail
                : detail && Object.keys(detail).length ? JSON.stringify(detail)
                : err.message && err.message !== '[object Object]' ? err.message : 'No error details returned';
            console.error('Spotify search failed:', status, message);
            sendData.error = `Error searching tracks (HTTP ${status}): ${message}`;
            return res.status(status >= 400 && status <= 599 ? status : 502).render('uri', sendData);
        }
    }

    async play(req, res) { return this.playback('play', req, res); }
    async pause(req, res) { return this.playback('pause', req, res); }

    async playback(action, req, res) {
        const {uri} = req.query;
        if (!isTrackUri(uri)) return res.status(400).send('Provide a valid Spotify track URI.');
        const returnUrl = `/page?uri=${encodeURIComponent(uri)}`;
        try {
            if (action === 'play') await this.spotifyClient.play(uri);
            else await this.spotifyClient.pause();
            return res.redirect(returnUrl);
        } catch (error) {
            console.error('Playback failed:', error.statusCode || error.message);
            return res.redirect(`${returnUrl}&playback=${action}_failed`);
        }
    }

    async showTrack(req, res) {
        const {uri} = req.query;
        const sendData = {error: null, track: null, trackUri: null, saveStatus: null};
        if (req.query.saved === 'track') sendData.saveStatus = 'Track, album, and credited artists saved to your library.';
        if (req.query.saved === 'album') sendData.saveStatus = 'Album, its tracks, and credited artists saved to your library.';
        if (req.query.saved === 'failed') sendData.error = 'Could not save to your library. Please try again.';
        if (req.query.saved === 'login') sendData.error = 'Please log in to Spotify before saving.';
        if (req.query.playback === 'play_failed') {
            sendData.error = 'Could not start playback. Open Spotify on a device and try again.';
        } else if (req.query.playback === 'pause_failed') {
            sendData.error = 'Could not pause playback. Open Spotify on a device and try again.';
        }
        if (!isTrackUri(uri)) {
            sendData.error = 'Provide a valid Spotify track URI.';
            return res.status(400).render('page', sendData);
        }
        if (!this.spotifyClient.isAuthenticated()) {
            sendData.error = 'Please log in before opening track details.';
            return res.status(401).render('page', sendData);
        }
        try {
            const data = await this.spotifyClient.getTrack(uri.split(':')[2]);
            sendData.track = data;
            sendData.trackUri = data.uri;
            return res.render('page', sendData);
        } catch (err) {
            const status = Number.isInteger(err.statusCode) && err.statusCode >= 400 && err.statusCode <= 599
                ? err.statusCode : 502;
            if (status === 401) this.spotifyClient.resetAccessToken();
            sendData.error = status === 401 ? 'Spotify login expired. Please log in again.'
                : status === 404 ? 'Track not found.'
                : `Could not load track details from Spotify (HTTP ${status}).`;
            console.error('Spotify track details failed:', status);
            return res.status(status).render('page', sendData);
        }
    }

    async callback(req, res) {
        if (req.query.error) return res.redirect('/?login=denied');
        const {code} = req.query;
        if (typeof code !== 'string' || !code) return res.redirect('/?login=missing_code');
        try {
            await this.spotifyClient.authorize(code);
            return res.redirect('/?login=success');
        } catch (error) {
            console.error('Spotify login failed:', error.statusCode || error.message);
            return res.redirect('/?login=failed');
        }
    }

    logout(req, res) {
        this.spotifyClient.logout();
        res.type('text').send('Local Spotify tokens cleared. This does not sign you out of spotify.com. Sign in again at /login?reauthorize=1.');
    }
}

module.exports = SpotifyController;
