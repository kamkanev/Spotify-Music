const express = require('express');

module.exports = function createRouter({homeController, libraryController, spotifyController}) {
    const router = express.Router();
    // Wrappers preserve each controller's `this` and forward unexpected failures.
    const action = (controller, method) => (req, res, next) =>
        Promise.resolve().then(() => controller[method](req, res, next)).catch(next);
    const libraryPage = method => (req, res, next) =>
        Promise.resolve().then(() => libraryController[method](req, res))
            .catch(error => res.headersSent ? next(error) : libraryController.readError(error, req, res));

    router.get('/', action(homeController, 'index'));
    for (const [path, method] of [
        ['/login', 'login'], ['/callback', 'callback'], ['/logout', 'logout'],
        ['/search', 'search'], ['/page', 'showTrack'], ['/play', 'play'], ['/pause', 'pause']
    ]) router.get(path, action(spotifyController, method));

    for (const [path, method] of [
        ['/tracks', 'listTracks'], ['/albums', 'listAlbums'], ['/artists', 'listArtists'],
        ['/track/:id', 'showTrack'], ['/album/:id', 'showAlbum'], ['/artist/:id', 'showArtist']
    ]) router.get(path, libraryPage(method));

    for (const [path, method] of [
        ['/add-track', 'addTrack'], ['/add-album', 'addAlbum'], ['/add-artist', 'addArtist'],
        ['/add-membership', 'addMembership'], ['/save-spotify', 'save']
    ]) router.post(path, action(libraryController, method));

    return router;
};
