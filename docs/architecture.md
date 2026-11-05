# Class structure

The application still uses Express and EJS. The SQL schema, URLs, form field
names, rendered page names, and save redirects are preserved.

```text
app.js                         Configuration and dependency construction
lib/routes/index.js            Express routes mapped to controller methods
lib/controllers/               HTTP input, responses, templates, redirects
lib/services/                  Validation, Spotify import workflow, login lifecycle
lib/repositories/              Parameterized SQL, transactions, model construction
lib/models/                    Track, Album, Artist, PersonArtist, GroupArtist
lib/errors/                    ValidationError
lib/validation.js              Shared value validation functions
```

## A database read

```text
GET /track/5
  -> LibraryController.showTrack(req, res)
  -> LibraryRepository.findTrack(5)
  -> parameterized MySQL queries
  -> Track instance, linked Album, and credited Artist instances
  -> res.render('track', {title, track})
```

`Track.getFormattedDuration()` and `Track.getDisplayImage()` are called by the
EJS views. Models keep the existing snake_case fields so links and templates
continue to work. `Album.getTracks()`, `Artist.getAlbums()`, and similar methods
return the relationships loaded by the repository; they do not issue SQL or
lazy-load data. List methods load the fields and credits needed by list views;
detail methods load the corresponding related records.

## A save

```text
POST /save-spotify
  -> LibraryController.save(req, res)
  -> LibraryService.saveTrack(uri) or saveAlbum(uri)
  -> SpotifyClient fetches the track, album, and any additional album pages
  -> LibraryRepository.saveSpotify(album, tracks)
  -> one transaction saves rows and credit relationships
  -> controller redirects to /page?uri=...&saved=track (or album)
```

The JSON `/add-track`, `/add-album`, `/add-artist`, and `/add-membership` endpoints
use the same service and repository. `LibraryService` validates manual input;
the repository manages SQL and checks persistent membership constraints inside
transactions. Existing Spotify records are reused, preserving manually assigned
artist types. `SpotifyClient` wraps the external SDK and owns login tokens and
the refresh timer; `SpotifyController` handles login, search, playback, and the
Spotify details page. Login tokens are still shared in process memory, as before.

## Inheritance and relationships

- `PersonArtist extends Artist` and adds `groups` and `getGroups()`.
- `GroupArtist extends Artist` and adds `members`, `getMembers()`, and `addMember()`.
- The `createArtist()` factory selects the subclass from the database's
  `artist_type`. `unknown` stays a base `Artist`; imports never guess whether
  an artist is a person or a band.
- An album aggregates zero or more tracks. A track has zero or one album.
- Artists have many-to-many credit associations with tracks and albums, backed
  by `track_artists` and `album_artists`, preserving `artist_order`.
- A group aggregates people. People can belong to multiple groups, backed by
  `artist_memberships`. In-memory `addMember()` updates both sides and rejects
  self-membership or non-person members. Use the service to persist membership.

These are associations and aggregations, not compositions: a song or person can
exist independently of an album or group. No composition is added just to include
that UML symbol. Link tables remain persistence details rather than extra domain
classes. `ValidationError` extends JavaScript's built-in `Error`.

## UML files

- `class-diagram.svg`: standalone class diagram for viewing or submission.
- `class-diagram.mmd`: editable Mermaid source for diagram applications.
- `class-diagram.dot`: Graphviz source used to render the SVG.
- `generate-class-diagram.js`: reads the implemented class method signatures and
  generates the diagram sources. Attribute declarations and relationship labels
  are maintained in this generator. Inherited fields/methods appear on the base
  class. A `?` marks nullable attributes; arrows include relationship multiplicity.

To regenerate (Graphviz must be installed):

```sh
node docs/generate-class-diagram.js
dot -Tsvg docs/class-diagram.dot -o docs/class-diagram.svg
```

`app.js` constructs and shares the dependencies. Its `createApp({pool, api})`
factory allows tests to inject an isolated database pool and a fake Spotify SDK.
Running `node app.js` or `npm start` starts the server normally.

## Checks

```sh
npm test
```

The integration test exercises real HTTP requests and MySQL. It must use a fresh,
disposable database initialized with `db.sql`. Set `TEST_DB_DISPOSABLE=true`,
`TEST_DB_PORT` to that container's published localhost port, and
`TEST_DB_PASSWORD` to its root password, then run:

```sh
npm run test:integration
```

Without the explicit test settings the integration test is skipped. It creates
test records; never point it at your application's database.
