class Artist {
    constructor(row) {
        this.id = row.id;
        this.name = row.name;
        this.artist_type = row.artist_type || 'unknown';
        this.image_url = row.image_url ?? null;
        this.spotify_id = row.spotify_id ?? null;
        this.tracks = [];
        this.albums = [];
    }

    getTracks() { return [...this.tracks]; }
    getAlbums() { return [...this.albums]; }
}

module.exports = Artist;
