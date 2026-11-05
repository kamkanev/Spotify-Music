class HomeController {
    index(req, res) {
        const indexData = {title: 'Music App', message: 'Welcome to my EJS page for testing!', status: null};
        const loginStatuses = {
            success: {message: 'Successfully connected to Spotify.', type: 'success'},
            denied: {message: 'Spotify login was cancelled or denied. Please try again.', type: 'error'},
            missing_code: {message: 'Missing Spotify authorization code. Please log in again.', type: 'error'},
            failed: {message: 'Could not connect to Spotify. Please try logging in again.', type: 'error'}
        };
        const status = typeof req.query.login === 'string' && Object.hasOwn(loginStatuses, req.query.login)
            ? loginStatuses[req.query.login] : null;
        res.render("index", {...indexData, status});
    }
}

module.exports = HomeController;
