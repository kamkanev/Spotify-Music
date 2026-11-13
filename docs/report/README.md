# Доклад

- `Report.pdf` — готовият доклад.
- `main.typ` — текстът и оформлението в Typst.
- `Images/` — изображения и диаграми.
- `references.bib` — библиографски източници.

За локално създаване на PDF инсталирайте [Typst CLI](https://typst.app/open-source/)
и изпълнете от основната директория на проекта:

```sh
cd docs/report
typst compile main.typ Report.pdf
```

За автоматично обновяване при промени:

```sh
typst watch main.typ Report.pdf
```

При първото компилиране е необходим интернет за изтегляне на шаблона
`latexlike-report:1.0.0`. Командите обновяват съществуващия `Report.pdf`.

Без локална инсталация: качете съдържанието на папката в
[Typst Online](https://typst.app/), отворете `main.typ` и експортирайте PDF.
