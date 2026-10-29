import type { MessageKey } from './en';

export const de: Record<MessageKey, string> = {
  'app.tagline':
    'Übersetzen Sie PDF-, Word- und PowerPoint-Dokumente und behalten Sie dabei das Layout bei.',
  'header.settings': 'Einstellungen',
  'header.uiLanguage': 'Oberflächensprache',

  'drop.title': 'PDF-, Word-, PowerPoint- oder LaTeX-Datei hier ablegen',
  'drop.hint':
    'oder eine Datei (bzw. ein .samepage-Projekt zum erneuten Öffnen) auswählen. Sie wird in Ihrem Browser verarbeitet und nie hochgeladen.',
  'drop.choose': 'Datei auswählen',
  'file.change': 'Andere Datei auswählen',
  'file.reading': 'Dokument wird gelesen…',
  'file.pages': '{count} Seiten',
  'settings.autoTranslate': 'Automatisch mit Google übersetzen',
  'settings.autoTranslateHint':
    'Aus: Sie aktivieren die seiteneigene Übersetzung Ihres Browsers und wählen die Sprache selbst.',
  'sheet.autoFailed':
    'Die automatische Übersetzung konnte nicht gestartet werden (Google Translate wurde nicht geladen). Übersetzen Sie stattdessen mit Ihrem Browser:',
  'error.chromeTranslator':
    'Chrome konnte den geräteinternen Übersetzer für dieses Sprachpaar nicht vorbereiten (Chrome bietet es eventuell nicht an, oder der Sprachdownload ist hängen geblieben). Wählen Sie „Google Translate“ oder versuchen Sie es später erneut.',
  'file.detected': 'Erkannte Sprache: {lang}',
  'file.undetected':
    'Die Sprache des Dokuments konnte nicht erkannt werden. Bitte wählen Sie unten die Ausgangssprache – eine falsche Auswahl führt zu einer falschen Übersetzung.',
  'file.scanned':
    'Gescanntes PDF: Der Text wird beim Übersetzen auf Ihrem Gerät erkannt (OCR). Beim ersten Mal werden etwa 5 MB von dieser Website heruntergeladen. Wählen Sie die Ausgangssprache.',
  'file.thumbnail': 'Erste Seite von {name}',

  'error.empty': 'Diese Datei ist leer.',
  'error.unsupported':
    'Diese Datei ist kein PDF-, DOCX- oder PPTX-Dokument, keine LaTeX-Quelle (.tex oder Projekt-.zip) und kein samepage-Projekt.',
  'error.docm':
    'Dateien mit Makros (.docm, .pptm) werden nicht unterstützt. Speichern Sie das Dokument als .docx oder .pptx und versuchen Sie es erneut.',
  'error.tooLarge': 'Diese Datei ist zu groß. Das Limit für {kind}-Dateien beträgt {limit}.',
  'error.tooManyPages':
    'Dieses PDF hat {count} Seiten. Es können höchstens {limit} Seiten auf einmal verarbeitet werden.',
  'error.encrypted':
    'Dieses PDF ist passwortgeschützt. Entfernen Sie das Passwort und versuchen Sie es erneut.',
  'error.corrupt': 'Diese Datei konnte nicht geöffnet werden. Sie ist möglicherweise beschädigt.',
  'error.project':
    'Diese samepage-Projektdatei konnte nicht geöffnet werden. Sie ist möglicherweise beschädigt oder stammt aus einer neueren Version.',
  'project.opened':
    'Projekt erneut geöffnet: Die Übersetzung von {engine} wird so angezeigt, wie sie gespeichert wurde, ohne erneut zu übersetzen.',
  'project.save': 'Projekt speichern (.samepage)',
  'project.saveHint':
    'Das Dokument, seine Übersetzung, Ihre Korrekturen und das Glossar in einer Datei. Öffnen Sie sie später in jedem Browser, ohne erneut zu übersetzen.',
  'project.glossary': 'Die {count} Glossarbegriffe des Projekts hinzufügen',
  'error.workerCrash': 'Die Verarbeitungs-Engine ist abgestürzt.',
  'error.workerTimeout': 'Die Verarbeitungs-Engine reagiert nicht mehr.',
  'error.restart': 'Engine neu starten',
  'error.generic': 'Etwas ist schiefgelaufen. Ihre Datei wurde nirgendwohin hochgeladen.',
  'error.tryAgain': 'Erneut versuchen',

  'config.source': 'Ausgangssprache',
  'config.target': 'Zielsprache',
  'config.swap': 'Ausgangs- und Zielsprache tauschen',
  'config.engine': 'Übersetzungs-Engine',
  'config.sameLanguage': 'Ausgangs- und Zielsprache müssen verschieden sein.',
  'config.translate': 'Übersetzen',
  'config.translateSoon':
    'Die Übersetzung wird gerade entwickelt und erscheint in einer kommenden Version.',

  'engine.anthropic.label': 'Claude (Anthropic)',
  'engine.anthropic.description':
    'Beste Qualität für wissenschaftliche Texte, mit Treueprüfung. Verwendet Ihren eigenen API-Schlüssel.',
  'engine.chrome-builtin.label': 'Integrierter Chrome-Übersetzer',
  'engine.chrome-builtin.description': 'Läuft privat auf Ihrem Gerät. Nur Desktop-Chrome und Edge.',
  'engine.openai-compatible.label': 'Lokaler LLM-Server',
  'engine.openai-compatible.description':
    'Ollama, LM Studio oder ein anderer OpenAI-kompatibler Server auf diesem Computer.',
  'engine.pseudo.label': 'Pseudo (Test)',
  'engine.pseudo.description':
    'Deterministische Scheinübersetzung zum Testen von Layouts. Kein Netzwerk.',
  'engine.badge.draft': 'Entwurfsqualität',
  'engine.badge.unavailable': 'In diesem Browser nicht verfügbar',
  'privacy.on-device': 'Auf dem Gerät',
  'privacy.third-party-api': 'Text wird an Anthropic gesendet',
  'privacy.local-server': 'Text wird an Ihren lokalen Server gesendet',

  'key.label': 'Anthropic-API-Schlüssel',
  'key.hint':
    'Wird nur für diese Sitzung im Arbeitsspeicher gehalten. Verwenden Sie einen eigenen Schlüssel mit niedrigem Ausgabenlimit.',
  'baseUrl.label': 'Server-URL',
  'baseUrl.hint':
    'Der Server muss diese Website per CORS zulassen (bei Ollama OLLAMA_ORIGINS setzen). Nur localhost-Adressen sind erlaubt.',

  'settings.title': 'Einstellungen',
  'settings.close': 'Schließen',
  'settings.localCitations': '„et al.“ nach den Konventionen der Zielsprache schreiben',
  'settings.localCitationsHint':
    'In Zitaten: Türkisch „vd.“, Russisch und Bulgarisch „и др.“, Ukrainisch „та ін.“, Polnisch „i in.“, andere Sprachen „et al.“.',
  'settings.fidelityCheck': 'Bedeutungsprüfung',
  'settings.fidelityCheckHint':
    'Markiert Absätze, deren Bedeutung sich verschoben haben könnte: eine verlorene oder hinzugefügte Verneinung, eine abgeschwächte oder verstärkte Aussage (may, suggests), ein veränderter Quantor (most → all). Google und Chrome: Die Übersetzung wird rückübersetzt und verglichen (dauert etwa doppelt so lang). Claude: ein zweiter Prüfdurchlauf (erhöht die Kosten um etwa 30–50 %).',
  'settings.translateReferences': 'Literaturverzeichnis übersetzen',
  'settings.referenceTitles': 'Titel im Literaturverzeichnis in Klammern übersetzen (APA 7)',
  'settings.referenceTitlesHint':
    'Literaturangaben bleiben wie veröffentlicht; Titel in einer anderen Sprache erhalten dahinter ihre Übersetzung: „Makine çevirisi [Machine translation].“',
  'settings.translateComments': 'DOCX-Kommentare übersetzen',
  'settings.translateMetadata': 'Dokumenttitel (Metadaten) übersetzen',
  'settings.showTestEngine': 'Test-Engine anzeigen',

  'worker.ready': 'Verarbeitungs-Engine bereit',
  'worker.starting': 'Verarbeitungs-Engine wird gestartet…',

  'footer.privacy':
    'Ihr Dokument verlässt nie Ihr Gerät. Nur Text wird an die von Ihnen gewählte Engine gesendet.',
  'footer.source': 'Quellcode (AGPL-3.0)',
  'footer.quality': 'Qualität an 88 echten Artikeln',
  'quality.title': 'Qualität an echten Artikeln',
  'quality.summary':
    '{papers} Open-Access-Artikel in {languages} Sprachen ({pages} Seiten): durchschnittliche Layoutbewertung {mean}, {high} Artikel bei 99 oder höher.',
  'quality.method':
    'Übersetzt mit {engine}, der Standard-Engine, am {date}. Die Layoutbewertung ist 100, wenn jeder Absatz in seinem ursprünglichen Rahmen in Originalgröße steht; Abzüge gibt es für verkleinerten Text, PDF-Notizen, beibehaltene Originale und Überlappungen, wie im Qualitätsbericht.',
  'quality.honest':
    'Die Bewertung misst das Layout, nicht die Übersetzungsqualität: Dafür sind die Bedeutungsprüfung und Ihre eigene Lektüre da. Die Artikel sind nicht im Repository; ihre Bewertungen sind es, zusammen mit dem Skript, das sie erzeugt.',
  'quality.back': 'Zurück zum Übersetzen',
  'quality.language': 'Ausgangssprache',
  'quality.field': 'Fachgebiet',
  'quality.papers': 'Artikel',
  'quality.pages': 'Seiten',
  'quality.mean': 'Mittelwert',
  'quality.lowest': 'Niedrigster',
  'quality.field.health': 'Medizin und Gesundheit',
  'quality.field.engineering': 'Ingenieurwesen',
  'quality.field.computing': 'Informatik',
  'quality.field.economics': 'Wirtschaft',
  'quality.field.chemistry': 'Chemie',
  'quality.field.mathematics': 'Mathematik',
  'quality.field.biology': 'Biologie und Agrarwissenschaft',
  'quality.field.physics': 'Physik',
  'quality.field.social': 'Sozial- und Bildungswissenschaften',
  'quality.field.law': 'Recht',
  'model.label': 'Modell',
  'model.quality': 'höchste Treue',
  'model.balanced': 'ausgewogen',
  'model.economy': 'sparsam',
  'key.remember': 'Auf diesem Gerät merken',
  'key.rememberWarning':
    'Der Schlüssel wird unverschlüsselt in diesem Browser gespeichert. Nutzen Sie dies nur auf Ihrem eigenen Gerät.',
  'key.forget': 'Schlüssel vergessen',
  'localModel.label': 'Modellname',
  'localModel.hint': 'So, wie Ihr Server ihn auflistet, z. B. qwen2.5:14b.',
  'config.needKey': 'Geben Sie zuerst Ihren Anthropic-API-Schlüssel ein.',
  'config.needLocalModel': 'Geben Sie den Modellnamen Ihres lokalen Servers ein.',
  'settings.clearCache': 'Übersetzungscache leeren',
  'settings.cacheCleared': 'Übersetzungscache geleert.',
  'settings.playground': 'Text-Playground öffnen (Entwicklerwerkzeug)',
  'playground.title': 'Text-Playground',
  'playground.description':
    'Fügen Sie Text ein, übersetzen Sie ihn mit einer beliebigen Engine und prüfen Sie Validierungs- und Treueergebnisse. Absätze durch eine Leerzeile trennen. Auszeichnung: **fett**, *kursiv*, $Formel$.',
  'playground.back': '← Zurück zu samepage',
  'playground.input': 'Ausgangstext',
  'playground.sample': 'Türkisches wissenschaftliches Beispiel laden',
  'playground.numberLocalization': 'Zahlenformate lokalisieren',
  'playground.useCache': 'Übersetzungscache verwenden',
  'playground.translate': 'Übersetzen',
  'playground.cancel': 'Abbrechen',
  'playground.progress': '{done} / {total} Absätze',
  'playground.estimate':
    '≈ {requests} Anfragen · ~{input} Eingabe- und ~{output} Ausgabe-Tokens (Thinking-Tokens nicht eingerechnet)',
  'playground.summary':
    '{ok} akzeptiert · {warnings} mit Warnungen · {untranslated} nicht übersetzt · {cached} aus dem Cache',
  'playground.tagSurvival': 'Tag-Erhalt (Chrome): {survived} / {total}',
  'playground.duration': 'Fertig in {seconds} s',
  'playground.empty': 'Geben Sie zuerst etwas Text ein.',
  'playground.downloading': 'Übersetzungsmodell wird heruntergeladen… {percent} %',
  'result.translation': 'Übersetzung',
  'result.untranslated': 'Nicht übersetzt – Original beibehalten',
  'result.cached': 'Aus dem Cache',
  'result.attempts': '{count} Versuche',
  'result.ok': 'Akzeptiert',
  'glossary.title': 'Glossar',
  'glossary.hint': 'Begriffe werden in jeder Übersetzung exakt verwendet und anschließend geprüft.',
  'glossary.extract': 'Begriffe aus dem Text vorschlagen',
  'glossary.extracting': 'Begriffe werden vorgeschlagen…',
  'glossary.import': 'CSV importieren',
  'glossary.export': 'CSV exportieren',
  'glossary.exportPack': 'Alle als Paket exportieren',
  'glossary.packHint':
    'Eine Datei mit einer Spalte pro Sprache für jedes Glossar in diesem Browser – teilen Sie sie mit Ihrem Labor oder Institut; jeder kann sie für jedes enthaltene Sprachpaar importieren.',
  'glossary.imported': 'Importierte Begriffe: {count}.',
  'glossary.packImported':
    'Für dieses Sprachpaar aus einem Paket ({languages}) importierte Begriffe: {count}.',
  'glossary.add': 'Begriff hinzufügen',
  'glossary.clear': 'Leeren',
  'glossary.source': 'Ausgangsbegriff',
  'glossary.target': 'Übersetzung',
  'glossary.note': 'Anmerkung',
  'glossary.remove': 'Entfernen',
  'glossary.count': '{count} Begriffe',
  'glossary.suggestionCount': '{count} vorgeschlagen',
  'glossary.suggested': 'In diesem Dokument gefunden',
  'glossary.suggestedHint':
    'Wörter in Code-Schrift und Werkzeugnamen bleiben unverändert; Fachbegriffe erhalten ihre übliche Übersetzung. Entfernen Sie das Häkchen bei unerwünschten Einträgen.',
  'glossary.keep': 'unverändert',
  'glossary.addSelected': '{count} zum Glossar hinzufügen',
  'glossary.reason.code': 'Code-Schrift',
  'glossary.reason.tool': 'Werkzeugname',
  'glossary.reason.stats': 'Statistik',
  'glossary.reason.medicine': 'Medizin',
  'glossary.reason.cs': 'Informatik',
  'glossary.reason.engineering': 'Ingenieurwesen',
  'glossary.reason.chemistry': 'Chemie',
  'jobError.auth': 'Der API-Schlüssel wurde abgelehnt.',
  'jobError.network': 'Der Übersetzungsdienst ist nicht erreichbar.',
  'jobError.rate-limit': 'Ratenlimit erreicht. Versuchen Sie es gleich noch einmal.',
  'jobError.server': 'Der Übersetzungsdienst hat einen Fehler gemeldet.',
  'jobError.bad-request': 'Die Anfrage wurde abgelehnt.',
  'jobError.unavailable': 'Diese Engine ist nicht verfügbar.',
  'jobError.cancelled': 'Abgebrochen.',
  'jobError.internal': 'Unerwarteter Fehler.',
  'jobError.rejected': 'Das Dokument wurde von den Sicherheitsprüfungen abgelehnt.',
  'workspace.translating': 'Übersetzung läuft… {done} / {total} Absätze',
  'workspace.ocr': 'Text wird erkannt (OCR)… Seite {done} / {total}',
  'workspace.checking': 'Bedeutung wird geprüft… {done} / {total} Absätze',
  'workspace.polishing': 'Claude überarbeitet markierte Sätze… {done} / {total}',
  'polish.label': 'Markierte Sätze mit Claude überarbeiten',
  'polish.hint':
    'Sätze, die die Bedeutungsprüfung markiert, werden von Claude mit Ihrem eigenen Anthropic-API-Schlüssel überarbeitet. Nur diese Sätze werden an Anthropic gesendet.',
  'spelling.label': 'Englische Rechtschreibung',
  'spelling.default': 'Wahl der Engine',
  'spelling.american': 'Amerikanisch (color, analyze, modeling)',
  'spelling.british': 'Britisch (colour, analyse, modelling)',
  'mode.label': 'Was übersetzt werden soll',
  'mode.document': 'Gesamtes Dokument',
  'mode.abstract': 'Titel, Abstract und Schlüsselwörter',
  'abstract.searching': 'Titel, Abstract und Schlüsselwörter werden gesucht…',
  'abstract.found':
    'Im Dokument gefunden. Prüfen Sie sie und bearbeiten Sie sie bei Bedarf vor dem Übersetzen.',
  'abstract.missing':
    'In diesem Dokument wurde kein Abstract erkannt. Fügen Sie unten Titel, Abstract und Schlüsselwörter ein.',
  'abstract.otherLang':
    'Das gefundene Abstract ist auf {lang} verfasst, nicht in der Ausgangssprache.',
  'abstract.alreadyTarget':
    'Das Dokument enthält bereits ein Abstract auf {lang}; vergleichen Sie es mit der Übersetzung.',
  'abstract.title': 'Titel',
  'abstract.abstract': 'Abstract',
  'abstract.keywords': 'Schlüsselwörter',
  'abstract.words': '{count} Wörter',
  'abstract.wordsCompare': '{source} Wörter im Original · {target} in der Übersetzung',
  'abstract.empty':
    'Geben Sie das Abstract (oder einen Titel bzw. Schlüsselwörter) zum Übersetzen ein.',
  'abstract.result': 'Übersetzung ({lang})',
  'abstract.copy': 'Kopieren',
  'abstract.copyAll': 'Alles kopieren',
  'abstract.copied': 'Kopiert',
  'abstract.copyFailed':
    'Der Browser hat das Kopieren nicht erlaubt; markieren Sie den Text und kopieren Sie ihn manuell.',
  'statement.title': 'KI-Nutzungserklärung für die Fachzeitschrift',
  'statement.hint':
    'Die meisten Fachzeitschriften verlangen von Autorinnen und Autoren die Angabe maschineller Übersetzung. Fügen Sie dies in die Danksagung oder den Methodenteil ein und passen Sie es bei Bedarf an.',
  'abstract.download': 'Herunterladen (.txt)',
  'workspace.pdfSoon':
    'Die PDF-Übersetzung erscheint in einer kommenden Version. Die DOCX-Übersetzung funktioniert bereits.',
  'report.title': 'Qualitätsbericht',
  'report.summary':
    '{translated} übersetzt · {warnings} mit Warnungen · {untranslated} nicht übersetzt · {skipped} übersprungen · {cached} aus dem Cache',
  'report.repairs': 'Strukturelle Korrekturen',
  'report.repair.D1_ROW_HEIGHT':
    'Zeilenhöhe der Tabelle von „genau“ auf „mindestens“ geändert, damit der Text nicht abgeschnitten wird',
  'report.repair.D2_TEXTBOX': 'Textfeld so eingestellt, dass es mit seinem Text wächst',
  'report.repair.D3_FRAME': 'Rahmenhöhe von „genau“ auf „mindestens“ geändert',
  'report.repair.P1_SLIDE_FIT':
    'Folientext verkleinert (PowerPoint „Text bei Überlauf verkleinern“), damit die Übersetzung in ihre Form passt',
  'report.repair.L1_LANGUAGE':
    'Dokumentsprache in babel/polyglossia auf die Zielsprache umgestellt (Silbentrennung, „Abbildung“, Datumsangaben)',
  'report.repair.L2_ENCODING': 'Datei nicht in UTF-8: unverändert beibehalten, nicht übersetzt',
  'report.repair.D4_LONG_TOKEN':
    'Unsichtbare Umbruchstellen in einem langen Wort oder einer URL in einer Zelle mit fester Breite eingefügt',
  'report.attention': 'Erfordert Ihre Aufmerksamkeit',
  'report.allSegments': 'Alle Absätze',
  'report.empty': 'Nichts erfordert Aufmerksamkeit.',
  'report.meaningFilter': 'Bedeutungsprüfung',
  'report.technical': 'Technische Details',
  'meaning.title': 'Bedeutungsprüfung',
  'meaning.back': 'Rückübersetzung',
  'meaning.negationLost':
    'eine Verneinung ist möglicherweise verloren gegangen – der Satz könnte nun das Gegenteil aussagen.',
  'meaning.negationAdded':
    'eine Verneinung wurde möglicherweise hinzugefügt – der Satz könnte nun das Gegenteil aussagen.',
  'meaning.hedgingLost':
    'eine Abschwächung („may“, „suggests“) ist möglicherweise verloren gegangen – die Aussage könnte stärker wirken als im Original.',
  'meaning.hedgingAdded':
    'eine Abschwächung wurde möglicherweise hinzugefügt – die Aussage könnte schwächer wirken.',
  'meaning.quantifier':
    'ein Quantor hat sich möglicherweise geändert („most“ → „all“, „some“ → „few“).',
  'issue.POST_EDITED':
    'Die Bedeutungsprüfung hat die erste Übersetzung markiert; Claude hat sie unter Berücksichtigung des Originals und des Befunds überarbeitet.',
  'issue.PUNCTUATION_CHANGED':
    'Klammern oder Satzabstände haben sich in der Übersetzung verändert; bitte diese Stelle prüfen.',
  'issue.TABLE_NOT_RECOGNISED':
    'Die Tabelle zu dieser Beschriftung wurde nicht erkannt: Ihre Zellen wurden als Fließtext übersetzt. Bitte prüfen.',
  'issue.OCR_LOW_CONFIDENCE':
    'Der Scan war hier schwer lesbar; der erkannte Text kann Fehler enthalten.',
  'issue.UNTRANSLATED': 'Die Übersetzung war mit dem Original identisch.',
  'issue.NUMBER_MISMATCH': 'Eine Zahl weicht zwischen Original und Übersetzung ab.',
  'issue.CITATION_MISMATCH': 'Ein Zitat weicht zwischen Original und Übersetzung ab.',
  'issue.TAG_MISMATCH':
    'Ein Teil der Formatierung konnte in der Übersetzung nicht platziert werden.',
  'issue.PLACEHOLDER_MISMATCH': 'Eine Formel, ein Link oder ein Bezeichner ist verloren gegangen.',
  'issue.WRONG_LANGUAGE': 'Die Übersetzung sieht nicht nach der Zielsprache aus.',
  'issue.REVIEW_SUGGESTED': 'Teilweise übersetzt; bitte prüfen Sie die Formulierung.',
  'issue.PARTLY_UNTRANSLATED': 'Ein Teil blieb in der Originalsprache.',
  'issue.STYLE_APPROXIMATED': 'Ein Teil der Inline-Formatierung (fett, kursiv) wurde angenähert.',
  'issue.GLOSSARY_MISMATCH': 'Ein Glossarbegriff wurde nicht verwendet.',
  'issue.KEPT_ORIGINAL': 'Der Originaltext wurde hier beibehalten.',
  'issue.BELOW_MIN_SIZE': 'Der Text wurde kleiner als die übliche Mindestgröße gesetzt.',
  'report.status.translated': 'Übersetzt',
  'report.status.warning': 'Warnung',
  'report.status.untranslated': 'Nicht übersetzt – Original beibehalten',
  'report.status.skipped': 'Nicht übersetzt (Literaturverzeichnis)',
  'download.pptx': 'Übersetzte PPTX herunterladen',
  'download.latex': 'Übersetztes LaTeX herunterladen',
  'download.docx': 'Übersetzte DOCX herunterladen',
  'download.report': 'Bericht herunterladen (JSON)',
  'preview.title': 'Vorschau',
  'preview.original': 'Original',
  'preview.translated': 'Übersetzt',
  'preview.loading': 'Vorschau wird erstellt…',
  'preview.failed':
    'Die Vorschau konnte nicht erstellt werden. Der Download ist davon nicht betroffen.',
  'engine.browser.label': 'Google Translate',
  'engine.browser.description':
    'Übersetzt automatisch in die gewählte Sprache – auch auf Smartphones. Nutzt den Website-Übersetzer von Google, der nur während des Übersetzens geladen wird.',
  'privacy.browser-vendor': 'Text wird an Google gesendet',
  'settings.showAdvancedEngines': 'Erweiterte Engines anzeigen (Claude-API, lokales LLM)',
  'sheet.title': 'Mit Ihrem Browser übersetzen',
  'sheet.intro':
    'Ihr Browser übersetzt die folgenden Absätze; der Rest der Seite bleibt unverändert. Lassen Sie diese Seite geöffnet, bis der Vorgang abgeschlossen ist.',
  'sheet.step.chrome-desktop':
    'Klicken Sie in der Adressleiste auf das Übersetzungssymbol. Wird {target} nicht angeboten, öffnen Sie das ⋮-Menü → „Andere Sprache wählen“ → {target}.',
  'sheet.step.chrome-android':
    'Öffnen Sie das ⋮-Menü → „Übersetzen…“. Ist die Seite nicht auf {target}, öffnen Sie das Menü der Übersetzungsleiste → „Weitere Sprachen“ → {target}.',
  'sheet.step.chrome-ios':
    'Tippen Sie auf ••• → „Übersetzen“ (oder auf das Übersetzungssymbol in der Adressleiste). Ist die Seite nicht auf {target}, öffnen Sie die Optionen der Übersetzungsleiste → „Weitere Sprachen“ → {target}.',
  'sheet.step.edge':
    'Klicken Sie in der Adressleiste auf das Übersetzungssymbol und wählen Sie {target}.',
  'sheet.step.safari':
    'Tippen Sie in der Adressleiste auf die Schaltfläche „aA“ → „Auf {target} übersetzen“.',
  'sheet.step.firefox':
    'Klicken Sie in der Adressleiste auf das Übersetzungssymbol und wählen Sie {target}.',
  'sheet.step.other':
    'Verwenden Sie die Funktion „Seite übersetzen“ Ihres Browsers und wählen Sie {target}.',
  'sheet.privacy': 'Ihr Browser sendet diesen Text an seinen Übersetzungsdienst (Chrome: Google).',
  'sheet.waiting': 'Warten auf die Übersetzung durch Ihren Browser…',
  'sheet.progress': '{done} / {total} Absätze übersetzt',
  'sheet.wrongLanguage':
    'Die Seite scheint auf {got} übersetzt zu sein. Wählen Sie im Übersetzungsmenü Ihres Browsers {target}.',
  'sheet.stuck':
    'Es wurde noch nichts übersetzt. Browser übersetzen standardmäßig in ihre eigene Sprache – wählen Sie im Übersetzungsmenü {target}.',
  'sheet.stuckChrome':
    'Auf diesem Computer funktioniert die Engine „Integrierter Chrome-Übersetzer“ automatisch: Brechen Sie ab und wählen Sie sie oben aus.',
  'review.compare': 'Mit der Rückübersetzung vergleichen',
  'review.compareHint':
    'Die Rückübersetzung ist die in die Ausgangssprache zurückübersetzte Übersetzung. Markierte Wörter weichen vom Original ab; Umformulierungen sind normal, prüfen Sie jedoch Zahlen (rot), Verneinungen und Abschwächungen.',
  'review.source': 'Original',
  'review.translation': 'Übersetzung',
  'review.back': 'Rückübersetzung',
  'review.edit': 'Bearbeiten',
  'review.save': 'Speichern',
  'review.cancel': 'Abbrechen',
  'review.manual': 'Von Ihnen bearbeitet',
  'review.hint':
    'Gepunkteter Text behält seine Formatierung; graue Kästchen sind Formeln, Markierungen oder Links und bleiben an ihrer Stelle.',
  'review.pending': '{count} Änderungen noch nicht angewendet',
  'review.apply': 'Änderungen anwenden und Dokument neu erstellen',
  'review.applying': 'Wird neu erstellt…',
  'download.bilingual': 'Zweisprachige Prüfversion herunterladen (DOCX)',
  'bilingual.title': 'Zweisprachige Prüfversion – {name}',
  'bilingual.notes': 'Anmerkungen',
  'download.pdf': 'Übersetztes PDF herunterladen',
  'download.dual': 'Nebeneinander-PDF herunterladen',
  'download.word': 'Als Word herunterladen (bearbeitbar)',
  'download.wordHint':
    'Die Übersetzung in Word-Formatvorlagen: Überschriften, Absätze, Tabellen und Fußnoten als Text, Abbildungen und abgesetzte Formeln als Bilder. Kopfzeilen und Seitenzahlen entfallen.',
  'pdfReport.summary':
    '{translated} übersetzt · {warnings} mit Warnungen · {untranslated} nicht übersetzt · {keptOriginal} in der Originalsprache belassen · {scaled} leicht verkleinert',
  'pdfReport.status.translated': 'Übersetzt',
  'pdfReport.status.warning': 'Warnung',
  'pdfReport.status.untranslated': 'Nicht übersetzt – Original beibehalten',
  'pdfReport.status.kept-original': 'Passte nicht – Original beibehalten',
  'pdfReport.scale': 'auf {percent} % verkleinert',
  'pdfReport.pages': 'Seite {pages}',
  'pdf.note':
    'Die Layoutkorrektur für PDF wird noch verbessert: Absätze, die nicht passen, werden leicht verkleinert oder in der Originalsprache belassen; jeder solche Fall ist unten aufgeführt.',
  'preview.pageOf': 'Seite {page} von {total}',
  'preview.previous': 'Vorherige Seite',
  'preview.next': 'Nächste Seite',
  'pdfReport.score': 'Layout-Bewertung {score}/100',
  'pdfReport.status.green': 'Gut',
  'pdfReport.status.yellow': 'Prüfen',
  'pdfReport.status.red': 'Überprüfung nötig',
  'pdfReport.pageScore': 'S. {page}: {score}',
  'pdfReport.overflowNotes':
    '{count} Überlaufhinweise wurden auf zusätzlichen Seiten am Ende eingefügt.',
  'pdfReport.fallback.relaxed-min': 'Unter die normale Mindestgröße verkleinert',
  'pdfReport.fallback.annotation':
    'Originalbeschriftung beibehalten; Übersetzung in einer PDF-Notiz',
  'pdfReport.fallback.overflow-note': 'Ein Teil des Textes in die Überlaufhinweise verschoben',
  'pdfReport.fallback.keep-original': 'Originaltext beibehalten',
  'pdf.pageRange': 'Zu übersetzender Seitenbereich',
  'pdf.pageFrom': 'Von Seite',
  'pdf.pageTo': 'bis Seite',
  'pdfReport.ocr':
    'Text aus dem Scan erkannt (OCR) auf {pages} Seiten, mittlere Konfidenz {confidence} %. Erkennungsfehler bleiben in der Übersetzung erhalten: Prüfen Sie Namen und Zahlen.',
  'pdfReport.sanitized': 'Aktive Inhalte aus der Ausgabe entfernt: {items}',
};
