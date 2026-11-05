// Regenerate the SVG with: node docs/generate-class-diagram.js && dot -Tsvg docs/class-diagram.dot -o docs/class-diagram.svg
const fs = require('node:fs');
const path = require('node:path');
const {Track, Album, Artist, PersonArtist, GroupArtist} = require('../lib/models');
const LibraryRepository = require('../lib/repositories/LibraryRepository');
const LibraryService = require('../lib/services/LibraryService');
const SpotifyClient = require('../lib/services/SpotifyClient');
const HomeController = require('../lib/controllers/HomeController');
const LibraryController = require('../lib/controllers/LibraryController');
const SpotifyController = require('../lib/controllers/SpotifyController');
const ValidationError = require('../lib/errors/ValidationError');

// Attributes use the public property names in the source; nullable values are marked '?'.
const classes = [
    [Track, ['id: Integer', 'name: String', 'duration_ms: Integer?', 'image_url: String?', 'spotify_id: String?', 'spotify_uri: String?', 'album_id: Integer?', 'album_name: String?', 'cover_url: String?', 'album: Album?', 'artists: Artist[]']],
    [Album, ['id: Integer', 'name: String', 'release_date: String?', 'image_url: String?', 'spotify_id: String?', 'artists: Artist[]', 'tracks: Track[]']],
    [Artist, ['id: Integer', 'name: String', 'artist_type: String', 'image_url: String?', 'spotify_id: String?', 'tracks: Track[]', 'albums: Album[]']],
    [PersonArtist, ['groups: GroupArtist[]']],
    [GroupArtist, ['members: PersonArtist[]']],
    [LibraryRepository, ['pool: MySQL Pool']],
    [LibraryService, ['repository: LibraryRepository', 'spotifyClient: SpotifyClient']],
    [SpotifyClient, ['api: SpotifyWebApi', 'refreshTimer: Timeout?']],
    [HomeController, []],
    [LibraryController, ['repository: LibraryRepository', 'service: LibraryService', 'spotifyClient: SpotifyClient']],
    [SpotifyController, ['spotifyClient: SpotifyClient']],
    [ValidationError, ['name: String', 'statusCode: Integer']]
];
const signatures = ctor => Object.getOwnPropertyNames(ctor.prototype)
    .filter(name => name !== 'constructor')
    .map(name => {
        const fn = ctor.prototype[name];
        const args = fn.toString().match(/^[^(]*\(([^)]*)\)/)?.[1].replace(/\s+/g, ' ') || '';
        return `${name}(${args})`;
    });
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
let dot = `digraph Classes {
  graph [rankdir=TB, bgcolor="#f5f7f6", pad="0.4", nodesep="0.5", ranksep="1.1", fontname="Helvetica", label="Music Room - implemented class diagram\nPublic attributes and methods; ? = nullable; inherited members are shown on the base class.", labelloc=t];
  node [shape=plain, fontname="Helvetica"];
  edge [fontname="Helvetica", fontsize=10, color="#476657", penwidth=1.2];
`;
let mermaid = 'classDiagram\n';
for (const [ctor, attributes] of classes) {
    const methods = signatures(ctor);
    const cell = entries => entries.length ? entries.map(text => `+ ${escape(text)}<BR ALIGN="LEFT"/>`).join('') : '&#160;';
    dot += `  ${ctor.name} [label=<<TABLE BORDER="0" CELLBORDER="1" CELLSPACING="0" CELLPADDING="9" COLOR="#9bb3a4"><TR><TD BGCOLOR="#dceee2"><B>${ctor.name}</B></TD></TR><TR><TD BGCOLOR="white" ALIGN="LEFT">${cell(attributes)}</TD></TR><TR><TD BGCOLOR="white" ALIGN="LEFT">${cell(methods)}</TD></TR></TABLE>>];\n`;
    mermaid += `    class ${ctor.name} {\n${attributes.map(a => '        +' + a).join('\n')}\n${methods.map(m => '        +' + m.replaceAll('{', '').replaceAll('}', '')).join('\n')}\n    }\n`;
}
dot += `  Error [label="Error (JavaScript built-in)", shape=box, style=rounded];
  PersonArtist -> Artist [arrowhead=onormal, label="inherits"];
  GroupArtist -> Artist [arrowhead=onormal, label="inherits"];
  ValidationError -> Error [arrowhead=onormal, label="inherits"];
  Album -> Track [dir=both, arrowtail=odiamond, arrowhead=none, taillabel="0..1", headlabel="0..*", label="contains"];
  Artist -> Track [dir=none, taillabel="0..*", headlabel="0..*", label="credited on"];
  Artist -> Album [dir=none, taillabel="0..*", headlabel="0..*", label="credited on"];
  GroupArtist -> PersonArtist [dir=both, arrowtail=odiamond, arrowhead=none, taillabel="0..*", headlabel="0..*", label="members"];
  LibraryController -> LibraryService [arrowhead=vee, taillabel="1", headlabel="1", label="uses"];
  LibraryController -> LibraryRepository [arrowhead=vee, taillabel="1", headlabel="1", label="reads"];
  LibraryController -> SpotifyClient [arrowhead=vee, taillabel="1", headlabel="1", label="checks login"];
  LibraryService -> LibraryRepository [arrowhead=vee, taillabel="1", headlabel="1", label="persists through"];
  LibraryService -> SpotifyClient [arrowhead=vee, taillabel="1", headlabel="1", label="imports through"];
  SpotifyController -> SpotifyClient [arrowhead=vee, taillabel="1", headlabel="1", label="uses"];
  LibraryRepository -> Track [style=dashed, arrowhead=vee, label="creates"];
  LibraryRepository -> Album [style=dashed, arrowhead=vee, label="creates"];
  LibraryRepository -> Artist [style=dashed, arrowhead=vee, label="creates through factory"];
  LibraryService -> ValidationError [style=dashed, arrowhead=vee, label="throws"];
}
`;
mermaid += `    Artist <|-- PersonArtist
    Artist <|-- GroupArtist
    Error <|-- ValidationError
    Album "0..1" o-- "0..*" Track : contains
    Artist "0..*" -- "0..*" Track : credited on
    Artist "0..*" -- "0..*" Album : credited on
    GroupArtist "0..*" o-- "0..*" PersonArtist : members
    LibraryController "1" --> "1" LibraryService : uses
    LibraryController "1" --> "1" LibraryRepository : reads
    LibraryController "1" --> "1" SpotifyClient : checks login
    LibraryService "1" --> "1" LibraryRepository : persists through
    LibraryService "1" --> "1" SpotifyClient : imports through
    SpotifyController "1" --> "1" SpotifyClient : uses
    LibraryRepository ..> Track : creates
    LibraryRepository ..> Album : creates
    LibraryRepository ..> Artist : creates through factory
    LibraryService ..> ValidationError : throws
`;
fs.writeFileSync(path.join(__dirname, 'class-diagram.dot'), dot);
fs.writeFileSync(path.join(__dirname, 'class-diagram.mmd'), mermaid);
