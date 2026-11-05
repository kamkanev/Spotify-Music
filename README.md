# Spotify Music

The Express app uses model, repository, service, and controller classes. See
[the architecture guide](docs/architecture.md) and
[the UML class diagram](docs/class-diagram.svg) for the implemented structure.

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
