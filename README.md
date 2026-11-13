# Spotify Music

The Express app uses model, repository, service, and controller classes. See
[the architecture guide](docs/architecture.md) and
[the UML class diagram](docs/class-diagram.svg) for the implemented structure.
The [ArchiMate business design](docs/business_design/README.md) provides a wide,
colored business/application/technology diagram and an editable Archi model.

Run Node.js and MySQL as two containers managed together by Docker Compose.
This lets the application be rebuilt independently of the database, with database
files preserved in the `mysql_data` Docker volume.

## Start with Docker

1. Keep your existing Spotify settings in `.env`. For a new checkout, copy
   `.env.example` to `.env` and fill in your Spotify credentials.
2. Add `MYSQL_PASSWORD` and `MYSQL_ROOT_PASSWORD` to `.env`, using two different
   passwords. See `.env.example` for the setting names. Choose these before the
   first startup; changing them later does not update existing database users.
3. Stop any local Node.js server using port 5050, then run:

   ```sh
   docker compose up --build -d
   ```

Open http://127.0.0.1:5050. Register
`http://127.0.0.1:5050/callback` in your Spotify app settings.

Compose waits for MySQL to accept connections before starting the application.
MySQL initializes the `music` database from `db.sql` only when its data volume is
empty. Subsequent starts preserve the existing database; editing `db.sql` does
not update existing tables. Apply later schema changes as migrations.

## Database access

The app container receives these environment variables for future database code:

| Variable | Value |
| --- | --- |
| `DB_HOST` | `db` (the MySQL service name, rather than localhost) |
| `DB_PORT` | `3306` |
| `DB_NAME` | `music` |
| `DB_USER` | `music_app` |
| `DB_PASSWORD` | Your `MYSQL_PASSWORD` value |

The Node.js app uses `mysql2` and these settings to connect to MySQL. MySQL is
available on the internal Compose network; its port is not published to the host.

## Saving music

### Edit, delete, and browse your library

Saved track, album, and artist detail pages have **Edit** (blue) and **Delete**
(red) controls. The edit form updates the existing row by internal database ID;
the ID is never changed. Optional fields can be cleared, and track edits can
select an album or no album. Artist credits and group links are preserved.
An artist's type cannot change in a way that conflicts with existing membership.
These changes affect this application's database, not Spotify's catalogue.

Edits use `GET /track/:id/edit` and `POST /track/:id/edit` (likewise `/album`
and `/artist`). Successful edits return to the detail page with a blue alert.
Invalid inputs, duplicate Spotify identifiers, and missing referenced albums show
a red alert and retain the submitted form values.

Deletes use `POST /track/:id/delete` (likewise `/album` and `/artist`). A transaction
removes links before deleting the requested record, with foreign-key checks still
enabled:

- Track deletion removes its `track_artists` rows; the album and artists remain.
- Album deletion clears its tracks' `album_id` and removes its `album_artists`
  rows; the tracks and artists remain.
- Artist deletion removes its track/album credits and memberships, whether it is
  the group or the member. Tracks, albums, and other artists remain.

Any failure rolls back the whole operation and shows a red alert. Successful
deletion returns to the list with a blue alert. No database migration is required.

The **+ Add** button on each list opens `/tracks/new`, `/albums/new`, or
`/artists/new`. Submit the form with POST to the same URL. Only the name is
required. Blank optional fields become SQL `NULL`; artist type defaults to
`unknown`. Track forms can select an existing album and credited artists, and
album forms can select credited artists. Artist forms can select existing groups
for a person, or existing people as group members. These links are saved in the
same transaction as the new record. Duplicate Spotify IDs/URIs are rejected
rather than overwriting an existing record. A successful create redirects to the
corresponding list with a blue alert; form errors are red and keep entered values.
Spotify login and Spotify IDs are not required for manual creation.

Each list has its own database search form, separate from Spotify search:

- `/tracks?q=...` searches track, album, and credited artist names.
- `/albums?q=...` searches album and credited artist names.
- `/artists?q=...` searches artist names.
- `sort=name`, `name_desc`, or `newest` work on all lists. Tracks also support
  `duration` (longest first); albums support `release` (latest release first).
- `source=spotify` or `local` filters by presence or absence of a Spotify ID.
- Artist lists also accept `type=person`, `group`, or `unknown`.

Searches, sorting, and filters can be combined, and Reset clears them. Search
terms use SQL parameters and treat `%` and `_` literally. Sort columns come from
a fixed allowlist rather than request text. `newest` means most recently added
by internal ID, not release date.

Browse saved MySQL records at `/tracks`, `/albums`, and `/artists`. Each list
links to individual pages at `/track/:id`, `/album/:id`, and `/artist/:id`, using
internal database IDs. These pages work without Spotify login and include links
between saved records. Artist pages show recorded group memberships and credits;
album pages show the tracks currently saved for that album. The `/albums` route
now renders HTML rather than its former JSON response. Spotify search and the
`/page?uri=...` playback page remain available separately.

On a Spotify track details page, **Save track** stores the track, its album, the
track's credited artists, and the album's credited artists. **Save album and
tracks** imports the album and all of its tracks, including additional result
pages. These buttons save to this application's MySQL library, not your Spotify
account. Repeated imports reuse records with the same Spotify IDs and preserve
existing metadata. Each save is one transaction, including relationship rows.

Artist credits are stored separately in `track_artists` and `album_artists`, with
their original order. Spotify imports use `artist_type = 'unknown'` because the
artist response does not provide person/group classification or band membership.
Artist images are stored when supplied; simplified album/track artist objects
typically do not include images.

Manual endpoints accept JSON (`Content-Type: application/json`):

- `POST /add-artist`: `name`, optional `artist_type` (`person`, `group`, `unknown`),
  `spotify_id`, `image_url`, `group_ids`, `member_ids`.
- `POST /add-album`: `name`, optional `release_date`, `spotify_id`, `image_url`,
  `artist_ids`.
- `POST /add-track`: `name`, optional `duration_ms`, `album_id`, `spotify_id`,
  `spotify_uri`, `image_url`, `artist_ids`.
- `POST /add-membership`: `group_id` and `member_id`.

All relationship IDs are **internal integer database IDs**. Arrays such as
`artist_ids` must contain JSON numbers, not strings. Artists and albums must
already exist when referencing their IDs through manual endpoints. Tracks may
omit an album. For example:

```json
{
  "name": "Example track",
  "duration_ms": 180000,
  "album_id": 1,
  "artist_ids": [2, 3]
}
```

To create a person and link them to an existing group with ID 4:

```json
{
  "name": "Example musician",
  "artist_type": "person",
  "group_ids": [4]
}
```

To classify an imported artist, post their existing `spotify_id`, `name`, and
explicit `artist_type` to `/add-artist`. To link existing artists, post
`{"group_id": 4, "member_id": 5}` to `/add-membership`. The group must be
classified as `group` and the member as `person`; self-memberships are rejected.
Group membership is maintained manually and is not inferred from shared credits.

To open a MySQL terminal (enter `MYSQL_PASSWORD` when prompted):

```sh
docker compose exec db mysql -u music_app -p music
```

## Common commands

```sh
docker compose logs -f
docker compose ps
docker compose down
```

`docker compose down` keeps the database volume. `docker compose down --volumes`
deletes the database data; use it only when intentionally resetting the database.

After application or template changes, run `docker compose up --build -d` again.
Spotify login tokens are currently held in application memory, so log in again
after restarting the app container. Spotify credentials are supplied at runtime
and are excluded from the application image.
