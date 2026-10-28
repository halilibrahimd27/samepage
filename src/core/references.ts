/**
 * Headings of a reference list in the supported languages ("References", "Kaynakça",
 * "Literaturverzeichnis", "Bibliografía", "Список литературы", "Použitá literatura" …).
 */
export const REFERENCES_HEADING = new RegExp(
  `^\\s*(\\d+[.)]?\\s*)?(${[
    'kaynak(ça|lar)',
    'literatür',
    'references',
    'bibliography',
    'works cited',
    'literatur(e|verzeichnis)?',
    'quellen(verzeichnis)?',
    'bibliogra(phy|phie|fía|fia|fie|fija|fiya)',
    'références( bibliographiques)?',
    'referencias( bibliográficas)?',
    'referências( bibliográficas)?',
    'riferimenti( bibliografici)?',
    'literatura',
    'použitá literatura',
    'seznam (použité )?literatury',
    'piśmiennictwo',
    'referenties',
    'literatuur(lijst)?',
    'bronnen',
    'литература',
    'список (использованной )?литературы',
    'библиография',
    'література',
    'список (використаних )?джерел',
    'βιβλιογραφία',
    'irodalom(jegyzék)?',
    'referințe',
    'källor',
    'referenser',
  ].join('|')})\\s*:?\\s*$`,
  'iu',
);

/** A figure or table label and its number ("Figure 3", "Abb. 2", "Tabla 1.2", "Рис. 4" …). */
const CAPTION_START = new RegExp(
  `^(${[
    'şekil',
    'tablo',
    'resim',
    'grafik',
    'figure',
    'fig\\.',
    'table',
    'tab\\.',
    'listing',
    'algorithm',
    'algoritma',
    'liste',
    'abb\\.',
    'abbildung',
    'tabelle',
    'tableau',
    'figura',
    'tabla',
    'cuadro',
    'gráfico',
    'tabela',
    'quadro',
    'rysunek',
    'rys\\.',
    'obrázek',
    'obr\\.',
    'tabulka',
    'graf',
    'figuur',
    'afbeelding',
    'tabel',
    'рис\\.',
    'рисунок',
    'таблица',
    'таблиця',
    'листинг',
    'σχήμα',
    'πίνακας',
  ].join('|')})\\s*\\d+(?:[.,]\\d+)*(?!\\d|[.,]\\d)`,
  'iu',
);
/** What follows the number in a sentence that refers to the figure: "'de", ",", "shows". */
const REFERENCE_AFTER = /^(?:\s*['’]\p{L}|\s*,|\s+\p{Ll}{2})/u;

/**
 * Figure and table captions ("Figure 3: …", "Table 1 Characteristics …"), not the sentences
 * that refer to them ("Tablo 1'de görüldüğü üzere", "Şekil 1, …", "Table 2 shows …").
 */
export const CAPTION = {
  test(text: string): boolean {
    const m = CAPTION_START.exec(text);
    return !!m && !REFERENCE_AFTER.test(text.slice(m[0].length));
  },
};
