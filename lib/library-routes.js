module.exports = function registerLibraryRoutes(app, db) {
    async function rows(sql, values = []) {
        const [result] = await db.execute(sql, values);
        return result;
    }

    async function credits(items, table, column) {
        if (!items.length) return items;
        const ids = items.map(item => item.id);
        const artists = await rows(
            `SELECT c.${column} AS owner_id, a.id, a.name FROM ${table} c JOIN artists a ON a.id = c.artist_id WHERE c.${column} IN (${ids.map(() => '?').join(',')}) ORDER BY c.artist_order, a.id`, ids
        );
        const grouped = new Map();
        for (const artist of artists) {
            if (!grouped.has(artist.owner_id)) grouped.set(artist.owner_id, []);
            grouped.get(artist.owner_id).push(artist);
        }
        return items.map(item => ({...item, artists: grouped.get(item.id) || []}));
    }

    const trackSelect = `SELECT t.*, al.name AS album_name,
        COALESCE(NULLIF(t.image_url, ''), al.image_url) AS cover_url
        FROM tracks t LEFT JOIN albums al ON al.id = t.album_id`;

    function route(path, work) {
        app.get(path, async (req, res) => {
            if (req.params.id && (!/^[1-9]\d*$/.test(req.params.id) || Number(req.params.id) > 2147483647)) {
                return res.status(400).render('library-error', {title: 'Invalid ID', error: 'Use a valid library record ID.'});
            }
            try {
                await work(req, res);
            } catch (error) {
                console.error('Library read failed:', error.code || error.message);
                return res.status(500).render('library-error', {title: 'Library unavailable', error: 'Could not load your library. Please try again.'});
            }
        });
    }

    function missing(res, label) {
        return res.status(404).render('library-error', {title: `${label} not found`, error: `This ${label.toLowerCase()} is not in your library.`});
    }

    route('/tracks', async (req, res) => {
        const tracks = await credits(await rows(`${trackSelect} ORDER BY t.name, t.id`), 'track_artists', 'track_id');
        res.render('tracks', {title: 'Your tracks', tracks});
    });

    route('/albums', async (req, res) => {
        const albums = await credits(await rows('SELECT * FROM albums ORDER BY name, id'), 'album_artists', 'album_id');
        res.render('albums', {title: 'Your albums', albums});
    });

    route('/artists', async (req, res) => {
        const artists = await rows('SELECT * FROM artists ORDER BY name, id');
        res.render('artists', {title: 'Your artists', artists});
    });

    route('/track/:id', async (req, res) => {
        const [track] = await credits(await rows(`${trackSelect} WHERE t.id = ?`, [req.params.id]), 'track_artists', 'track_id');
        if (!track) return missing(res, 'Track');
        res.render('track', {title: track.name, track});
    });

    route('/album/:id', async (req, res) => {
        const [album] = await credits(await rows('SELECT * FROM albums WHERE id = ?', [req.params.id]), 'album_artists', 'album_id');
        if (!album) return missing(res, 'Album');
        const tracks = await credits(await rows(`${trackSelect} WHERE t.album_id = ? ORDER BY t.id`, [req.params.id]), 'track_artists', 'track_id');
        res.render('album', {title: album.name, album, tracks});
    });

    route('/artist/:id', async (req, res) => {
        const [artist] = await rows('SELECT * FROM artists WHERE id = ?', [req.params.id]);
        if (!artist) return missing(res, 'Artist');
        const tracks = await credits(await rows(`${trackSelect} JOIN track_artists ta ON ta.track_id = t.id WHERE ta.artist_id = ? ORDER BY t.name, t.id`, [req.params.id]), 'track_artists', 'track_id');
        const albums = await credits(await rows('SELECT al.* FROM albums al JOIN album_artists aa ON aa.album_id = al.id WHERE aa.artist_id = ? ORDER BY al.name, al.id', [req.params.id]), 'album_artists', 'album_id');
        const members = await rows('SELECT a.* FROM artists a JOIN artist_memberships m ON m.member_id = a.id WHERE m.group_id = ? ORDER BY a.name, a.id', [req.params.id]);
        const groups = await rows('SELECT a.* FROM artists a JOIN artist_memberships m ON m.group_id = a.id WHERE m.member_id = ? ORDER BY a.name, a.id', [req.params.id]);
        res.render('artist', {title: artist.name, artist, tracks, albums, members, groups});
    });
};
