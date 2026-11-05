class SpotifyClient {
    constructor(api) {
        this.api = api;
        this.refreshTimer = null;
    }

    isAuthenticated() { return Boolean(this.api.getAccessToken()); }
    resetAccessToken() { this.api.resetAccessToken(); }

    createAuthorizeURL(scopes, reauthorize = false) {
        const url = new URL(this.api.createAuthorizeURL(scopes));
        if (reauthorize) url.searchParams.set('show_dialog', 'true');
        return url.toString();
    }

    async authorize(code) {
        const {body} = await this.api.authorizationCodeGrant(code);
        this.api.setAccessToken(body.access_token);
        this.api.setRefreshToken(body.refresh_token);
        clearInterval(this.refreshTimer);
        this.refreshTimer = setInterval(async () => {
            try {
                const refreshed = await this.api.refreshAccessToken();
                // A refresh finishing after logout or another login must not restore old credentials.
                if (this.api.getRefreshToken() === body.refresh_token) {
                    this.api.setAccessToken(refreshed.body.access_token);
                }
            } catch (error) {
                console.error('Spotify refresh failed:', error.statusCode || error.message);
            }
        }, (body.expires_in / 2) * 1000);
        this.refreshTimer.unref();
    }

    logout() {
        clearInterval(this.refreshTimer);
        this.refreshTimer = null;
        this.api.resetAccessToken();
        this.api.resetRefreshToken();
    }

    async searchTracks(query) { return (await this.api.searchTracks(query, {limit: 10})).body; }
    async getTrack(id) { return (await this.api.getTrack(id)).body; }
    async getAlbum(id) { return (await this.api.getAlbum(id)).body; }
    async getAlbumTracks(id, options) { return (await this.api.getAlbumTracks(id, options)).body; }
    async play(uri) { await this.api.play({uris: [uri]}); }
    async pause() { await this.api.pause(); }
}

module.exports = SpotifyClient;
