//SERVER SETUP
const https = require('https');
const express = require('express');
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const requiredEnv = ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REDIRECT_URI'];
const missingEnv = requiredEnv.filter(name => !process.env[name]?.trim());
if (missingEnv.length) {
  throw new Error(`Missing required environment variables: ${missingEnv.join(', ')}. Set them in .env or your environment.`);
}

const db = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'music_app',
    password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD,
    database: process.env.DB_NAME || 'music',
    waitForConnections: true,
    connectionLimit: 10
});

const SpotifyWebApi = require('spotify-web-api-node');
const LibraryRepository = require('./lib/repositories/LibraryRepository');
const LibraryService = require('./lib/services/LibraryService');
const SpotifyClient = require('./lib/services/SpotifyClient');
const LibraryController = require('./lib/controllers/LibraryController');
const SpotifyController = require('./lib/controllers/SpotifyController');
const HomeController = require('./lib/controllers/HomeController');
const createRouter = require('./lib/routes');

// Inject dependencies once; request handlers share the pool and Spotify client.
function createApp({pool = db, api = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI
})} = {}) {
    const app = express();
    const repository = new LibraryRepository(pool);
    const spotifyClient = new SpotifyClient(api);
    const service = new LibraryService(repository, spotifyClient);
    const controllers = {
        homeController: new HomeController(),
        libraryController: new LibraryController(repository, service, spotifyClient),
        spotifyController: new SpotifyController(spotifyClient)
    };

    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));
    app.use('/bootstrap', express.static(path.join(__dirname, 'node_modules/bootstrap/dist')));
    app.use('/css', express.static(path.join(__dirname, 'views/css')));
    app.use(express.json());
    app.use(express.urlencoded({extended: false}));
    app.use(createRouter(controllers));
    app.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        console.error('Request failed:', error.code || error.message);
        const badRequest = error.status === 400;
        res.status(badRequest ? 400 : 500).render('library-error', {
            title: badRequest ? 'Invalid request' : 'Something went wrong',
            error: badRequest ? 'Please check your request and try again.' : 'Please try again later.'
        });
    });
    app.locals.spotifyClient = spotifyClient;
    return app;
}

if (require.main === module) {
    const app = createApp();
    const port = Number(process.env.PORT || 5050);
    const signOptions = {
        key: fs.readFileSync(process.env.TLS_KEY_PATH || path.join(__dirname, 'create-cert-key.pem')),
        cert: fs.readFileSync(process.env.TLS_CERT_PATH || path.join(__dirname, 'create-cert.pem'))
    };
    https.createServer(signOptions, app).listen(port, () => {
        console.log(`HTTPS server is running at https://127.0.0.1:${port}`);
    });
}

module.exports = {createApp};
