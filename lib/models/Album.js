class Album {
    constructor(row) {
        this.id = row.id;
        this.name = row.name;
        this.release_date = row.release_date ?? null;
        this.image_url = row.image_url ?? null;
        this.spotify_id = row.spotify_id ?? null;
        this.artists = [];
        this.tracks = [];
    }

    getTracks() { return [...this.tracks]; }
    getArtists() { return [...this.artists]; }
}

module.exports = Album;
