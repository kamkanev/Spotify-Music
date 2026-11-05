const Track = require('./Track');
const Album = require('./Album');
const Artist = require('./Artist');
const PersonArtist = require('./PersonArtist');
const GroupArtist = require('./GroupArtist');

function createArtist(row) {
    if (row.artist_type === 'person') return new PersonArtist(row);
    if (row.artist_type === 'group') return new GroupArtist(row);
    return new Artist(row);
}

module.exports = {Track, Album, Artist, PersonArtist, GroupArtist, createArtist};
