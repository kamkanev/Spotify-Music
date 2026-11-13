
#import "@preview/latexlike-report:1.0.0": *

#show: latexlike-report.with(
 
 // ======== Cover ============
 //Use content [] or none, except in author.
  author: "Камен Канев - фак. №: 24101026", // must be a string ("")
  title: [Music Room],
  subtitle: [Документация],
  
  participants: [], // In case of several authors (the name in author parameter will go first) Use content [] or none.
  
  affiliation: [UTP],
  year: [2026],
   class: [Компютърни Технологии],
  other: none,

  date: [#datetime.today().display()], // You could use #datetime.today().display() for the date.

  logo : image("Images/logo.png"),

  //==========Theme ===============
  theme-color: rgb("#0f2787"),
  lang: "bg", 
   participants-supplement: "Автор:", //Change it if you change the language
 
            
  //=========Font =================
  title-font: "New Computer Modern",
  font: "New Computer Modern",
  font-size: 13pt,
  font-weight: 400,

  //============ Math =============

  math-font: "New Computer Modern Math",
  math-weight: 400,
  math-ref-supplement: auto, //Use none for no supplement, auto for language based or any other function or string you like
  math-numbering: "(1.1)", // The numbering style you like
  
  // ---- Equate package ---
  // For more information, you can refer to equate documentation
  
  math-number-mode: "label", //Can be "label" or "line" 
  math-sub-numbering: true,  // true or false

  //===========Page style===============
  pagebreak-section: false, //For pagebreak after adding a new level one heading (=)
  show-outline:true, //true or false 
  page-paper:"a4",

  //-----chic header package----
  // customize the left/center/right header and left/center/right footer
  // you can add images, text, the number of the current page, etc, or put none if you don't want some part of the header or footer.
  //some usefull function: chic-page-number(), chic-heading-name()
  
  h-l : [],
  h-r :[#image("Images/logo.png", width: 30%)],
  h-c : none,

  f-l : [],
  f-r : [],
  f-c : chic-page-number(),
  //=======================================
  //For more customitation you can check the documentation. !! Enjoy :D !!
)

  
///////////////////////////Document starts/////////////////////////////
= Абстракт

Music Room е уеб приложение за управление на музикална библиотека от песни,
албуми и изпълнители. То позволява ръчно създаване, редактиране, изтриване,
търсене и филтриране на записи. Интеграцията със Spotify предоставя търсене
във външен каталог, импорт на информация и управление на възпроизвеждането.
Решението използва Node.js, Express, EJS и MySQL и се стартира чрез Docker
Compose. Данните се съхраняват в постоянен том, независимо от жизнения цикъл
на контейнерите.

= Въведение

Целта на проекта е изграждане на приложение, което обединява потребителски
интерфейс, сървърна логика, релационна база данни и външна услуга. Потребителят
може да поддържа собствена колекция и да проследява връзките между песни,
албуми, изпълнители и музикални групи.

Приложението разделя локалната библиотека от каталога на Spotify. Промените
в базата данни засягат собствената колекция, а не съдържанието в Spotify.
Съхраняват се описателни данни и адреси на изображения, без изтегляне на аудио.
Работата с локалните записи не изисква вход в Spotify, след като системата
е конфигурирана и стартирана.

= Технологии

- *Node.js 24 и Express* — изпълнение на сървъра, обработка на HTTP заявки,
  маршрутизация и обработка на грешки.
- *EJS, HTML, CSS и Bootstrap 5* — генериране на страниците на сървъра,
  адаптивно оформление, форми, навигация и известия.
- *MySQL 8.4 и mysql2* — релационно съхранение, пул от връзки,
  параметризирани SQL заявки и транзакции.
- *Spotify Web API* — удостоверяване чрез OAuth 2.0, получаване на информация
  за музика и изпращане на команди за възпроизвеждане и пауза.
- *Docker и Docker Compose* — изграждане на образа на приложението и управление
  на контейнерите, мрежата и постоянния том.
- *Node.js Test Runner* — автоматизирани модулни и интеграционни тестове.

= Структура на проекта

== Компоненти и организация на кода

Решението съдържа два контейнера: `app` за уеб приложението и `db` за MySQL.
Те комуникират по вътрешната мрежа на Docker Compose. Приложението е достъпно
на порт *5050* на локалния компютър; портът на базата не се публикува към него.

Кодът е организиран на слоеве:

- `app.js` — конфигурация, създаване на зависимостите и стартиране на сървъра;
- `lib/routes/` — свързване на URL адресите с методите на контролерите;
- `lib/controllers/` — обработка на заявки, избор на изглед и пренасочване;
- `lib/services/` — валидация, импорт от Spotify и управление на удостоверяването;
- `lib/repositories/` — SQL заявки, транзакции и създаване на моделни обекти;
- `lib/models/` — класовете `Track`, `Album`, `Artist`, `PersonArtist` и `GroupArtist`;
- `views/` — EJS страници, общи шаблони и стилове;
- `test/` — автоматични тестове; `docs/` — описание и диаграми;
- `Dockerfile`, `compose.yaml` и `db.sql` — контейнеризация и схема на базата.

Класовете `PersonArtist` и `GroupArtist` наследяват `Artist`. При заявка за
песен контролерът извиква хранилището, което прочита базата и връща обект
`Track`. След това EJS шаблонът визуализира информацията. Операциите за импорт
преминават и през сервизния слой.

== База данни

Основните таблици са `tracks`, `albums` и `artists`. Свързващите таблици
`track_artists` и `album_artists` позволяват множество изпълнители за песен
или албум. `artist_memberships` описва членството на отделни изпълнители в групи.
Всеки запис има собствен числов идентификатор; *Spotify* идентификаторът е
отделно, незадължително текстово поле.

#figure(
  caption: "Диаграма на базата от дани създадена чрез MySQL",
  image("Images/db-diagram.png",width: 80%)
)

Външните ключове защитават връзките между записите. При изтриване приложението
премахва съответните свързващи записи в транзакция. При изтриване на албум
неговите песни остават в библиотеката, но връзката им с него се премахва.
Неуспешна операция се отменя изцяло.

// По желание качете съответните изображения в Typst Online и включете фигурите:
// #figure(image("class-diagram.svg", width: 100%), caption: [UML клас диаграма.])
// #figure(image("music-room-archimate.png", width: 100%), caption: [ArchiMate модел на системата.])

== Конфигурация

Необходими са Docker с Docker Compose и регистрирано приложение в Spotify
Developer Dashboard. В основната директория се създава файл `.env`:

```text
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:5050/callback
MYSQL_PASSWORD=your_database_password
MYSQL_ROOT_PASSWORD=your_separate_root_password
```

Стойностите се заменят със собствени данни. Адресът за обратно пренасочване
се регистрира и в настройките на *Spotify* приложението. Паролите за MySQL
се избират преди първото стартиране; не е необходимо да съществуват предварително.
Файлът `.env` не се включва в Docker образа и не трябва да се публикува.

Compose задава на приложението `DB_HOST=db`, `DB_PORT=3306`, `DB_NAME=music`
и `DB_USER=music_app`. Проверката за готовност на MySQL предхожда стартирането
на приложението. Схемата от `db.sql` се изпълнява при първоначално създаване
на базата. Промени в този файл не обновяват автоматично вече съществуваща база.

== Стартиране, спиране и наблюдение

Командите се изпълняват от основната директория на проекта. Изграждане
и стартиране във фонов режим:

```sh
docker compose up --build -d
```

Приложението се отваря на `http://127.0.0.1:5050`. Основните страници са
`/tracks`, `/albums` и `/artists`; `/login` стартира удостоверяването в Spotify.
След промяна на кода същата Compose команда изгражда и прилага новия образ.

Проверка на състоянието, проследяване на логовете и текущото потребление
на ресурси:

```sh
docker compose ps
docker compose logs -f
docker stats
```

Спиране и премахване на контейнерите и мрежата:

```sh
docker compose down
```

Томът `mysql_data` се запазва и данните са налични при следващо стартиране.
Добавянето на опцията `--volumes` изтрива и тома с базата, затова се използва
само при умишлено нулиране. Spotify токените се пазят в паметта на сървъра
и след рестарт е необходимо повторно удостоверяване.

= Резултат

Реализирани са списъчни и индивидуални страници за песни, албуми и изпълнители,
форми за добавяне и редактиране и изтриване със запазване на целостта на данните.
Библиотеката поддържа собствено търсене, сортиране и филтриране. Формите
показват сини известия при успех и червени при грешка.

Интеграцията със Spotify позволява записване на песен или албум заедно
с изпълнителите и връзките им. Възпроизвеждането се управлява на устройство
със Spotify; приложението не е самостоятелен аудиоплейър. Предоставени са
също HTTP маршрути с JSON отговори за добавяне на записи и членства.

Налични са 12 модулни теста и интеграционен тест с HTTP заявки към приложението
и реална MySQL база. Те покриват валидация, наследяване, връзки, транзакции,
формите, търсенето и обработката на грешки. Модулните тестове се стартират
локално при инсталиран Node.js:

```sh
npm ci
npm test
```

За интеграционния тест се използва отделна, празна тестова база със схемата
от `db.sql`. След задаване на `TEST_DB_DISPOSABLE=true`, `TEST_DB_PORT` и
`TEST_DB_PASSWORD` се изпълнява `npm run test:integration`. Тестът добавя данни
и не трябва да се насочва към работната база.

= Заключение

Проектът реализира контейнеризирано уеб приложение с постоянна база данни,
разделение на отговорностите в кода и интеграция с външна услуга. *UML* клас
диаграмата описва програмната структура, а *ArchiMate* моделът представя
бизнес, приложния и технологичния слой.

Текущата конфигурация използва една инстанция на уеб приложението и локален
HTTP достъп. Балансьор с две реплики, HTTPS със самоподписан сертификат,
отделна система за мониторинг и втора база данни са възможности за бъдещо
развитие. Преди мащабиране трябва да се реши и споделянето на състоянието
за Spotify удостоверяването между репликите.



// #figure(
//   caption: "Овчарски мат – Шахмат в 4 хода",
//   image("Images/checkmate.png",width: 80%)
// )

// #figure(
//   caption: "Принтиране на победителя",
//   image("Images/winner.png",width: 80%)
// )


// = Заключение

// Проектът демонстрира успешно прилагане на обектно-ориентирано програмиране при създаването на шахматна игра. Реализирани са основните компоненти на системата, включително управление на играта, графичен интерфейс и логика за движение на фигурите.

// В бъдеще проектът може да бъде разширен чрез добавяне на изкуствен интелект, онлайн функционалност или подобрения в потребителския интерфейс.

// Пълният изходен код на проекта е достъпен в GitHub хранилище @chess_engine_git


// #pagebreak()

// #bibliography("references.bib")

/*
= First section

 #lorem(50)

 $ alpha = 5 x x /7  oo > integral_oo^oo  dif x   = -> => >= integral_a^x  oo sum_a_i angle.l alpha|x|a_i angle.r  dif x  $ <eq1>


 #smallcaps[Some unsense math in ]  @eq1



= Unnumbered section <nonumber>

== Unnumbered section in level two <nonumber>

=== Simple list <nonumber>


+ #lorem(4)
  - #lorem(2)
+ #lorem I'm tired





= Related Work
#lorem(200)

#figure(
  table(columns: 2)[A][B][C][D],
  caption: [Tables caption go up, but you can change it \ at the start of the document],
)
#figure(
  caption: "Down for figures",
  image("Images/tum-logo.png",width: 30%)
)<ascas>



#figure(
table(columns: 6, align: center,
  table.cell(colspan: 2 )[Resistencia $X 1$], table.cell(colspan: 2 )[Resistencia $ X 2$], table.cell(colspan: 2,  )[Resistencia $X 3$], 
  [Valor de $ R 2$], [Valor de Resistencia], [Valor de $R 2$], [Valor de Resistencia], [Valor de $R 2$], [Valor de Resistencia], 
  [10], [512], [2010], [101495], [55000], [2777228], 
  [10], [511], [2010], [101495], [55010], [2777733], 
  [10], [511], [2010], [101500], [55003], [2777379], 
  [10], [511], [2010], [101500], [55020], [2778238], 
  [10], [511], [2010], [101500], [55000], [2777228], 
  [10], [511], [2010], [101495], [55000], [2777228], 
  [10], [512], [2010], [101500], [55005], [2777480], 
  [10], [511], [2010], [101500], [54973], [2775864], 
  [10], [511], [2010], [101500], [55007], [2777581], 
  [10], [511], [2010], [101495], [55004], [2777430], 
), caption: [Table cells are not justify])


*/