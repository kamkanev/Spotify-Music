CREATE DATABASE IF NOT EXISTS music;

use music;

create table albums (

	id int primary key auto_increment,
    name varchar(255) not null,
    release_date varchar(10),
    image_url varchar(2048),
    
    spotify_id varchar(255) unique

);

CREATE TABLE tracks (
	id int primary key auto_increment,
    name varchar(255) not null,
    duration_ms int,
    image_url varchar(2048),
    
    spotify_id varchar(255) unique,
    spotify_uri varchar(255) unique,
    album_id int,
    
    constraint fk_albums_tracks foreign key (album_id) references albums(id)
    
);

create table artists (

	id int primary key auto_increment,
    name varchar(255) not null,
    artist_type varchar(25),
    image_url varchar(2048),
    
    spotify_id varchar(255) unique,
    
    constraint chk_artist_type check(artist_type IN('person', 'group', 'unknown'))

);

create table track_artists (
	track_id int not null,
    artist_id int not null,
    artist_order int not null default 0,
    
    primary key (track_id, artist_id),
    
    foreign key (track_id) references tracks(id),
    foreign key (artist_id) references artists(id)
);

create table album_artists (
	album_id int not null,
    artist_id int not null,
    artist_order int not null default 0,
    
    primary key (album_id, artist_id),
    
    foreign key (album_id) references albums(id),
    foreign key (artist_id) references artists(id)
);

create table artist_memberships (

	group_id int not null,
    member_id int not null,
    
    primary key (group_id, member_id),
    
    foreign key (group_id) references artists(id),
    foreign key (member_id) references artists(id),
    
    constraint chk_diff_artists check (group_id <> member_id)

);

