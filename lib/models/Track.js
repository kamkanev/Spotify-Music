class Track {
    constructor(row) {
        this.id = row.id;
        this.name = row.name;
        this.duration_ms = row.duration_ms ?? null;
        this.image_url = row.image_url ?? null;
        this.spotify_id = row.spotify_id ?? null;
        this.spotify_uri = row.spotify_uri ?? null;
        this.album_id = row.album_id ?? null;
        this.album_name = row.album_name ?? null;
        this.cover_url = row.cover_url ?? this.image_url;
        this.album = null;
        this.artists = [];
    }

    setAlbum(album) {
        this.album = album;
        this.album_id = album?.id ?? null;
        this.album_name = album?.name ?? null;
        this.cover_url = this.image_url || album?.image_url || null;
        return this;
    }

    getDisplayImage() {
        return this.image_url || this.album?.image_url || this.cover_url || null;
    }

    getFormattedDuration() {
        if (this.duration_ms == null) return 'Unknown';
        const minutes = Math.floor(this.duration_ms / 60000);
        const seconds = Math.floor(this.duration_ms / 1000) % 60;
        return `${minutes}:${String(seconds).padStart(2, '0')}`;
    }

    getArtists() { return [...this.artists]; }
}

module.exports = Track;
