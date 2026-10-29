//SERVER SETUP
const express = require('express');
const path = require('path');
const app = express();
const fs = require('fs');

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const requiredEnv = ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REDIRECT_URI'];
const missingEnv = requiredEnv.filter(name => !process.env[name]?.trim());
if (missingEnv.length) {
  throw new Error(`Missing required environment variables: ${missingEnv.join(', ')}. Set them in .env or your environment.`);
}

//spotify set up
var SpotifyWebApi = require('spotify-web-api-node');
var spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.SPOTIFY_REDIRECT_URI
});
let refreshAccessTokenInterval;


//ejs setup
app.set('view engine', 'ejs');
app.use('/bootstrap', express.static(path.join(__dirname, 'node_modules/bootstrap/dist')));
app.use('/css', express.static(path.join(__dirname, 'views/css')));

const indexData = {
    title: 'Music App',
    message: 'Welcome to my EJS page for testing!',
    status: null
};

app.get("/", (req, res) => {
    const loginStatuses = {
        success: {message: 'Successfully connected to Spotify.', type: 'success'},
        denied: {message: 'Spotify login was cancelled or denied. Please try again.', type: 'error'},
        missing_code: {message: 'Missing Spotify authorization code. Please log in again.', type: 'error'},
        failed: {message: 'Could not connect to Spotify. Please try logging in again.', type: 'error'}
    };
    const status = typeof req.query.login === 'string' && Object.hasOwn(loginStatuses, req.query.login)
        ? loginStatuses[req.query.login] : null;
    res.render("index", {...indexData, status});
});

app.get("/login", (req, res) => {
    const scopes = ['user-read-private', 'user-read-email', 'user-read-playback-state', 'user-modify-playback-state',
       'user-read-currently-playing', 'user-read-recently-played', 'user-top-read', 'playlist-read-private',
        'playlist-read-collaborative'];
    const authorizeURL = new URL(spotifyApi.createAuthorizeURL(scopes));
    if (req.query.reauthorize === '1') {
        authorizeURL.searchParams.set('show_dialog', 'true');
    }
    res.redirect(authorizeURL.toString());
});

app.get("/callback", (req, res) => {

  const error = req.query.error;
  const code = req.query.code;
  const state = req.query.state;

  if (error) {
    console.error('Callback Error:', error);
    return res.redirect('/?login=denied');
  }

  if (typeof code !== 'string' || !code) {
    return res.redirect('/?login=missing_code');
  }

  spotifyApi.authorizationCodeGrant(code).then(tokenData => {
    const access_token = tokenData.body['access_token'];
    const refresh_token = tokenData.body['refresh_token'];
    const expires_in = tokenData.body['expires_in'];

    spotifyApi.setAccessToken(access_token);
    spotifyApi.setRefreshToken(refresh_token);
    
    console.log('Spotify login successful.');
    res.redirect('/?login=success');

    clearInterval(refreshAccessTokenInterval);
    refreshAccessTokenInterval = setInterval(async () => {
      try {
        const data = await spotifyApi.refreshAccessToken();
        const access_token = data.body['access_token'];

        console.log('The access token has been refreshed!');
        // Ignore a refresh that finished after logout or a new login.
        if (spotifyApi.getRefreshToken() === refresh_token) {
          spotifyApi.setAccessToken(access_token);
        }
      } catch (error) {
        console.error('Error refreshing access token:', error);
      }
    }, (expires_in / 2) * 1000);
  }).catch(error => {
    console.error('Error getting Tokens:', error);
    res.redirect('/?login=failed');
  });

});

app.get("/search", async (req, res) => {
    const {q} = req.query;
    const sendData = {
        error: null,
        trackArray: []
    };
    if (typeof q !== 'string' || !q.trim()) {
        sendData.error = 'Provide a search term';
        return res.status(400).render('uri', sendData);
    }
    if (!spotifyApi.getAccessToken()) {
        sendData.error = 'Please log in at /login before searching.';
        return res.status(401).render('uri', sendData);
    }
    try {
        const data = await spotifyApi.searchTracks(q.trim(), {limit: 10});
        sendData.trackArray = data.body.tracks.items;
        if (!sendData.trackArray.length) {
            sendData.error = 'No tracks found.';
            return res.status(404).render('uri', sendData);
        }
        
        return res.render('uri', sendData);
    } catch (err) {
        const status = err.statusCode || 502;
        if (status === 401) {
            spotifyApi.resetAccessToken();
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
});

app.get("/play", (req, res) => {
    const {uri} = req.query;
    spotifyApi.play({uris: [uri]}).then(() => {
        res.send("Playback started");
    }).catch(err => {
        console.error(err);
        res.send("Error starting playback");
    });
});

app.get("/page", async (req, res) => {
    const {uri} = req.query;
    const sendData = {error: null, track: null, trackUri: null};
    if (typeof uri !== 'string' || !/^spotify:track:[A-Za-z0-9]{22}$/.test(uri)) {
        sendData.error = 'Provide a valid Spotify track URI.';
        return res.status(400).render('page', sendData);
    }
    if (!spotifyApi.getAccessToken()) {
        sendData.error = 'Please log in before opening track details.';
        return res.status(401).render('page', sendData);
    }
    try {
        const data = await spotifyApi.getTrack(uri.split(':')[2]);
        sendData.track = data.body;
        sendData.trackUri = data.body.uri;
        return res.render('page', sendData);
    } catch (err) {
        const status = Number.isInteger(err.statusCode) && err.statusCode >= 400 && err.statusCode <= 599
            ? err.statusCode : 502;
        if (status === 401) spotifyApi.resetAccessToken();
        sendData.error = status === 401 ? 'Spotify login expired. Please log in again.'
            : status === 404 ? 'Track not found.'
            : `Could not load track details from Spotify (HTTP ${status}).`;
        console.error('Spotify track details failed:', status);
        return res.status(status).render('page', sendData);
    }
});

app.get("/logout", (req, res) => {
    clearInterval(refreshAccessTokenInterval);
    refreshAccessTokenInterval = undefined;
    spotifyApi.resetAccessToken();
    spotifyApi.resetRefreshToken();
    res.type('text').send('Local Spotify tokens cleared. This does not sign you out of spotify.com. Sign in again at /login?reauthorize=1.');
});


const port = 5050;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
