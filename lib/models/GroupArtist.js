const Artist = require('./Artist');
const PersonArtist = require('./PersonArtist');
const ValidationError = require('../errors/ValidationError');

class GroupArtist extends Artist {
    constructor(row) {
        super({...row, artist_type: 'group'});
        this.members = [];
    }

    getMembers() { return [...this.members]; }

    addMember(person) {
        if (!(person instanceof PersonArtist) || person.id === this.id) {
            throw new ValidationError('Membership requires a group and a different person artist.');
        }
        if (!this.members.some(member => member.id === person.id)) this.members.push(person);
        if (!person.groups.some(group => group.id === this.id)) person.groups.push(this);
        return this;
    }
}

module.exports = GroupArtist;
