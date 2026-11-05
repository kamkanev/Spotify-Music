const Artist = require('./Artist');

class PersonArtist extends Artist {
    constructor(row) {
        super({...row, artist_type: 'person'});
        this.groups = [];
    }

    getGroups() { return [...this.groups]; }
}

module.exports = PersonArtist;
