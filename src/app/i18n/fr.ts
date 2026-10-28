import type { MessageKey } from './en';

export const fr: Record<MessageKey, string> = {
  'app.tagline': 'Traduisez vos documents PDF, Word et PowerPoint en conservant leur mise en page.',
  'header.settings': 'Paramètres',
  'header.uiLanguage': 'Langue de l’interface',

  'drop.title': 'Déposez ici un fichier PDF, Word, PowerPoint ou LaTeX',
  'drop.hint':
    'ou choisissez un fichier (ou un projet .samepage à rouvrir). Il est traité dans votre navigateur et n’est jamais envoyé ailleurs.',
  'drop.choose': 'Choisir un fichier',
  'file.change': 'Choisir un autre fichier',
  'file.reading': 'Lecture du document…',
  'file.pages': '{count} pages',
  'settings.autoTranslate': 'Traduire automatiquement avec Google',
  'settings.autoTranslateHint':
    'Désactivé\u202F: vous activez vous-même la traduction de page de votre navigateur et choisissez la langue.',
  'sheet.autoFailed':
    'La traduction automatique n’a pas pu démarrer (Google Translate ne s’est pas chargé). Traduisez avec votre navigateur\u202F:',
  'error.chromeTranslator':
    'Chrome n’a pas pu préparer son traducteur local pour cette paire de langues (Chrome ne la propose peut-être pas, ou le téléchargement du pack de langue s’est bloqué). Choisissez «\u00A0Google Translate\u00A0» ou réessayez plus tard.',
  'file.detected': 'Langue détectée\u202F: {lang}',
  'file.undetected':
    'La langue du document n’a pas pu être détectée. Choisissez la langue source ci-dessous — une langue erronée donne une traduction erronée.',
  'file.scanned':
    'PDF numérisé\u202F: son texte sera reconnu sur votre appareil (OCR) lors de la traduction. La première fois, environ 5 Mo sont téléchargés depuis ce site. Choisissez la langue source.',
  'file.thumbnail': 'Première page de {name}',

  'error.empty': 'Ce fichier est vide.',
  'error.unsupported':
    'Ce fichier n’est ni un document PDF, DOCX ou PPTX, ni une source LaTeX (.tex ou projet .zip), ni un projet samepage.',
  'error.docm':
    'Les fichiers avec macros (.docm, .pptm) ne sont pas pris en charge. Enregistrez le document en .docx ou .pptx et réessayez.',
  'error.tooLarge':
    'Ce fichier est trop volumineux. La limite pour les fichiers {kind} est de {limit}.',
  'error.tooManyPages':
    'Ce PDF compte {count} pages. Jusqu’à {limit} pages peuvent être traitées à la fois.',
  'error.encrypted':
    'Ce PDF est protégé par un mot de passe. Supprimez le mot de passe et réessayez.',
  'error.corrupt': 'Ce fichier n’a pas pu être ouvert. Il est peut-être endommagé.',
  'error.project':
    'Ce fichier de projet samepage n’a pas pu être ouvert. Il est peut-être endommagé ou créé par une version plus récente.',
  'project.opened':
    'Projet rouvert\u202F: la traduction de {engine} s’affiche telle qu’elle a été enregistrée, sans nouvelle traduction.',
  'project.save': 'Enregistrer le projet (.samepage)',
  'project.saveHint':
    'Le document, sa traduction, vos corrections et le glossaire dans un seul fichier. Rouvrez-le ici plus tard, dans n’importe quel navigateur, sans retraduire.',
  'project.glossary': 'Ajouter les {count} termes du glossaire du projet',
  'error.workerCrash': 'Le moteur de traitement a planté.',
  'error.workerTimeout': 'Le moteur de traitement ne répond plus.',
  'error.restart': 'Redémarrer le moteur',
  'error.generic': 'Une erreur s’est produite. Votre fichier n’a été envoyé nulle part.',
  'error.tryAgain': 'Réessayer',

  'config.source': 'Langue source',
  'config.target': 'Langue cible',
  'config.swap': 'Inverser la langue source et la langue cible',
  'config.engine': 'Moteur de traduction',
  'config.sameLanguage': 'La langue source et la langue cible doivent être différentes.',
  'config.translate': 'Traduire',
  'config.translateSoon':
    'La traduction est en cours de développement et arrivera dans une prochaine version.',

  'engine.anthropic.label': 'Claude (Anthropic)',
  'engine.anthropic.description':
    'La meilleure qualité pour les textes académiques, avec vérification de fidélité. Utilise votre propre clé API.',
  'engine.chrome-builtin.label': 'Traducteur intégré à Chrome',
  'engine.chrome-builtin.description':
    'Fonctionne en privé sur votre appareil. Chrome et Edge pour ordinateur uniquement.',
  'engine.openai-compatible.label': 'Serveur LLM local',
  'engine.openai-compatible.description':
    'Ollama, LM Studio ou tout serveur compatible OpenAI sur cet ordinateur.',
  'engine.pseudo.label': 'Pseudo (test)',
  'engine.pseudo.description':
    'Fausse traduction déterministe pour tester les mises en page. Sans réseau.',
  'engine.badge.draft': 'Qualité brouillon',
  'engine.badge.unavailable': 'Indisponible dans ce navigateur',
  'privacy.on-device': 'Sur l’appareil',
  'privacy.third-party-api': 'Texte envoyé à Anthropic',
  'privacy.local-server': 'Texte envoyé à votre serveur local',

  'key.label': 'Clé API Anthropic',
  'key.hint':
    'Conservée en mémoire pour cette session uniquement. Utilisez une clé dédiée avec une limite de dépenses basse.',
  'baseUrl.label': 'URL du serveur',
  'baseUrl.hint':
    'Le serveur doit autoriser ce site via CORS (pour Ollama, définissez OLLAMA_ORIGINS). Seules les adresses localhost sont autorisées.',

  'settings.title': 'Paramètres',
  'settings.close': 'Fermer',
  'settings.localCitations': 'Écrire «\u00A0et al.\u00A0» à la manière de la langue cible',
  'settings.localCitationsHint':
    'Dans les citations\u202F: turc «\u00A0vd.\u00A0», russe et bulgare «\u00A0и др.\u00A0», ukrainien «\u00A0та ін.\u00A0», polonais «\u00A0i in.\u00A0», autres langues «\u00A0et al.\u00A0».',
  'settings.fidelityCheck': 'Vérification du sens',
  'settings.fidelityCheckHint':
    'Signale les paragraphes dont le sens a pu dériver\u202F: négation perdue ou ajoutée, affirmation renforcée ou atténuée (peut, suggère), quantificateur modifié (la plupart → tous). Google et Chrome\u202F: la traduction est retraduite vers la langue source puis comparée (durée à peu près doublée). Claude\u202F: une seconde passe de relecture (ajoute environ 30 à 50\u202F% au coût).',
  'settings.translateReferences': 'Traduire la liste de références',
  'settings.referenceTitles': 'Traduire les titres des références entre crochets (APA 7)',
  'settings.referenceTitlesHint':
    'Les références restent telles que publiées\u202F; les titres dans une autre langue sont suivis de leur traduction\u202F: “Makine çevirisi [Machine translation].”',
  'settings.translateComments': 'Traduire les commentaires DOCX',
  'settings.translateMetadata': 'Traduire le titre du document (métadonnées)',
  'settings.showTestEngine': 'Afficher le moteur de test',

  'worker.ready': 'Moteur de traitement prêt',
  'worker.starting': 'Démarrage du moteur de traitement…',

  'footer.privacy':
    'Votre document ne quitte jamais votre appareil. Seul le texte est envoyé au moteur que vous choisissez.',
  'footer.source': 'Code source (AGPL-3.0)',
  'footer.quality': 'Qualité sur 88 articles réels',
  'quality.title': 'Qualité sur des articles réels',
  'quality.summary':
    '{papers} articles en libre accès dans {languages} langues ({pages} pages)\u00a0: score de mise en page moyen {mean}, {high} articles à 99 ou plus.',
  'quality.method':
    'Traduits avec {engine}, le moteur par défaut, le {date}. Le score de mise en page vaut 100 quand chaque paragraphe reste dans son cadre d’origine à sa taille d’origine\u00a0; des points sont retirés pour le texte réduit, les notes PDF, les originaux conservés et les chevauchements, comme dans le rapport de qualité.',
  'quality.honest':
    'Le score mesure la mise en page, pas la qualité de la traduction\u00a0: c’est le rôle de la vérification du sens et de votre propre lecture. Les articles ne sont pas dans le dépôt\u00a0; leurs scores, si, avec le script qui les produit.',
  'quality.back': 'Revenir à la traduction',
  'quality.language': 'Langue source',
  'quality.field': 'Domaine',
  'quality.papers': 'Articles',
  'quality.pages': 'Pages',
  'quality.mean': 'Score moyen',
  'quality.lowest': 'Plus bas',
  'quality.field.health': 'Médecine et santé',
  'quality.field.engineering': 'Ingénierie',
  'quality.field.computing': 'Informatique',
  'quality.field.economics': 'Économie',
  'quality.field.chemistry': 'Chimie',
  'quality.field.mathematics': 'Mathématiques',
  'quality.field.biology': 'Biologie et agriculture',
  'quality.field.physics': 'Physique',
  'quality.field.social': 'Sciences sociales et éducation',
  'quality.field.law': 'Droit',
  'model.label': 'Modèle',
  'model.quality': 'fidélité maximale',
  'model.balanced': 'équilibré',
  'model.economy': 'économique',
  'key.remember': 'Mémoriser sur cet appareil',
  'key.rememberWarning':
    'La clé est stockée non chiffrée dans ce navigateur. N’utilisez cette option que sur votre propre appareil.',
  'key.forget': 'Oublier la clé',
  'localModel.label': 'Nom du modèle',
  'localModel.hint': 'Tel qu’indiqué par votre serveur, p. ex. qwen2.5:14b.',
  'config.needKey': 'Saisissez d’abord votre clé API Anthropic.',
  'config.needLocalModel': 'Saisissez le nom du modèle de votre serveur local.',
  'settings.clearCache': 'Vider le cache de traduction',
  'settings.cacheCleared': 'Cache de traduction vidé.',
  'settings.playground': 'Ouvrir le bac à sable de texte (outil de développement)',
  'playground.title': 'Bac à sable de texte',
  'playground.description':
    'Collez du texte, traduisez-le avec n’importe quel moteur et examinez les résultats de validation et de fidélité. Séparez les paragraphes par une ligne vide. Balisage\u202F: **gras**, *italique*, $formule$.',
  'playground.back': '← Retour à samepage',
  'playground.input': 'Texte source',
  'playground.sample': 'Charger un exemple académique en turc',
  'playground.numberLocalization': 'Localiser le format des nombres',
  'playground.useCache': 'Utiliser le cache de traduction',
  'playground.translate': 'Traduire',
  'playground.cancel': 'Annuler',
  'playground.progress': '{done} / {total} paragraphes',
  'playground.estimate':
    '≈ {requests} requêtes · ~{input} jetons en entrée et ~{output} en sortie (jetons de réflexion non inclus)',
  'playground.summary':
    '{ok} acceptés · {warnings} avec avertissements · {untranslated} non traduits · {cached} depuis le cache',
  'playground.tagSurvival': 'Conservation des balises (Chrome)\u202F: {survived} / {total}',
  'playground.duration': 'Terminé en {seconds} s',
  'playground.empty': 'Saisissez d’abord du texte.',
  'playground.downloading': 'Téléchargement du modèle de traduction… {percent}\u202F%',
  'result.translation': 'Traduction',
  'result.untranslated': 'Non traduit — source conservée',
  'result.cached': 'Depuis le cache',
  'result.attempts': '{count} tentatives',
  'result.ok': 'Accepté',
  'glossary.title': 'Glossaire',
  'glossary.hint': 'Les termes sont employés tels quels dans chaque traduction, puis vérifiés.',
  'glossary.extract': 'Suggérer des termes à partir du texte',
  'glossary.extracting': 'Recherche de termes…',
  'glossary.import': 'Importer un CSV',
  'glossary.export': 'Exporter en CSV',
  'glossary.exportPack': 'Tout exporter en un lot',
  'glossary.packHint':
    'Un seul fichier avec une colonne par langue pour chaque glossaire de ce navigateur — partagez-le avec votre laboratoire ou votre département\u202F; chacun peut l’importer pour n’importe laquelle de ses paires de langues.',
  'glossary.imported': 'Termes importés\u202F: {count}.',
  'glossary.packImported':
    'Termes importés pour cette paire de langues depuis un lot ({languages})\u202F: {count}.',
  'glossary.add': 'Ajouter un terme',
  'glossary.clear': 'Effacer',
  'glossary.source': 'Terme source',
  'glossary.target': 'Traduction',
  'glossary.note': 'Remarque',
  'glossary.remove': 'Supprimer',
  'glossary.count': '{count} termes',
  'glossary.suggestionCount': '{count} suggérés',
  'glossary.suggested': 'Trouvés dans ce document',
  'glossary.suggestedHint':
    'Les mots en police de code et les noms d’outils sont conservés tels quels\u202F; les termes de spécialité reçoivent leur traduction usuelle. Décochez ce dont vous ne voulez pas.',
  'glossary.keep': 'conservé tel quel',
  'glossary.addSelected': 'Ajouter {count} au glossaire',
  'glossary.reason.code': 'police de code',
  'glossary.reason.tool': 'nom d’outil',
  'glossary.reason.stats': 'statistiques',
  'glossary.reason.medicine': 'médecine',
  'glossary.reason.cs': 'informatique',
  'glossary.reason.engineering': 'ingénierie',
  'glossary.reason.chemistry': 'chimie',
  'jobError.auth': 'La clé API a été refusée.',
  'jobError.network': 'Le service de traduction est injoignable.',
  'jobError.rate-limit': 'Limite de requêtes atteinte. Réessayez dans un instant.',
  'jobError.server': 'Le service de traduction a renvoyé une erreur.',
  'jobError.bad-request': 'La requête a été rejetée.',
  'jobError.unavailable': 'Ce moteur n’est pas disponible.',
  'jobError.cancelled': 'Annulé.',
  'jobError.internal': 'Erreur inattendue.',
  'jobError.rejected': 'Le document a été rejeté par les contrôles de sécurité.',
  'workspace.translating': 'Traduction en cours… {done} / {total} paragraphes',
  'workspace.ocr': 'Reconnaissance du texte (OCR)… page {done} / {total}',
  'workspace.checking': 'Vérification du sens… {done} / {total} paragraphes',
  'workspace.polishing': 'Claude révise les phrases signalées… {done} / {total}',
  'polish.label': 'Faire réviser les phrases signalées par Claude',
  'polish.hint':
    'Les phrases signalées par la vérification du sens sont révisées par Claude avec votre propre clé API Anthropic. Seules ces phrases sont envoyées à Anthropic.',
  'spelling.label': 'Orthographe anglaise',
  'spelling.default': 'Choix du moteur',
  'spelling.american': 'Américaine (color, analyze, modeling)',
  'spelling.british': 'Britannique (colour, analyse, modelling)',
  'mode.label': 'Que traduire',
  'mode.document': 'Document entier',
  'mode.abstract': 'Titre, résumé et mots-clés',
  'abstract.searching': 'Recherche du titre, du résumé et des mots-clés…',
  'abstract.found':
    'Trouvés dans le document. Vérifiez-les et modifiez-les si besoin avant de traduire.',
  'abstract.missing':
    'Aucun résumé n’a été reconnu dans ce document. Collez le titre, le résumé et les mots-clés ci-dessous.',
  'abstract.otherLang': 'Le résumé trouvé est en {lang}, et non dans la langue source.',
  'abstract.alreadyTarget':
    'Le document contient déjà un résumé en {lang}\u202F; comparez-le avec la traduction.',
  'abstract.title': 'Titre',
  'abstract.abstract': 'Résumé',
  'abstract.keywords': 'Mots-clés',
  'abstract.words': '{count} mots',
  'abstract.wordsCompare': '{source} mots dans la source · {target} dans la traduction',
  'abstract.empty': 'Saisissez le résumé (ou un titre ou des mots-clés) à traduire.',
  'abstract.result': 'Traduction ({lang})',
  'abstract.copy': 'Copier',
  'abstract.copyAll': 'Tout copier',
  'abstract.copied': 'Copié',
  'abstract.copyFailed':
    'Le navigateur n’a pas autorisé la copie\u202F; sélectionnez le texte et copiez-le.',
  'statement.title': 'Déclaration d’usage de l’IA pour la revue',
  'statement.hint':
    'La plupart des revues demandent aux auteurs de déclarer la traduction automatique. Collez ce texte dans les remerciements ou la section méthodes et adaptez-le si nécessaire.',
  'abstract.download': 'Télécharger (.txt)',
  'workspace.pdfSoon':
    'La traduction de PDF arrivera dans une prochaine version. La traduction de DOCX fonctionne dès aujourd’hui.',
  'report.title': 'Rapport de qualité',
  'report.summary':
    '{translated} traduits · {warnings} avec avertissements · {untranslated} non traduits · {skipped} ignorés · {cached} depuis le cache',
  'report.repairs': 'Réparations structurelles',
  'report.repair.D1_ROW_HEIGHT':
    'Hauteur de ligne de tableau passée de exacte à minimale pour que le texte ne soit pas coupé',
  'report.repair.D2_TEXTBOX': 'Zone de texte réglée pour s’agrandir avec son texte',
  'report.repair.D3_FRAME': 'Hauteur du cadre passée de exacte à minimale',
  'report.repair.P1_SLIDE_FIT':
    'Texte de la diapositive réduit («\u00A0Réduire le texte au dépassement\u00A0» de PowerPoint) pour que la traduction tienne dans sa forme',
  'report.repair.L1_LANGUAGE':
    'Langue du document basculée vers la langue cible dans babel/polyglossia (césure, «\u00A0Figure\u00A0», dates)',
  'report.repair.L2_ENCODING': 'Fichier non encodé en UTF-8\u202F: conservé tel quel, non traduit',
  'report.repair.D4_LONG_TOKEN':
    'Points de césure invisibles ajoutés à un mot ou une URL longs dans une cellule de largeur fixe',
  'report.attention': 'Requiert votre attention',
  'report.allSegments': 'Tous les paragraphes',
  'report.empty': 'Rien ne requiert votre attention.',
  'report.meaningFilter': 'Vérification du sens',
  'report.technical': 'Détails techniques',
  'meaning.title': 'Vérification du sens',
  'meaning.back': 'Rétrotraduction',
  'meaning.negationLost':
    'une négation a peut-être été perdue — la phrase peut désormais dire le contraire.',
  'meaning.negationAdded':
    'une négation a peut-être été ajoutée — la phrase peut désormais dire le contraire.',
  'meaning.hedgingLost':
    'une atténuation («\u00A0peut\u00A0», «\u00A0suggère\u00A0») a peut-être été perdue — l’affirmation peut sembler plus forte que dans la source.',
  'meaning.hedgingAdded':
    'une atténuation a peut-être été ajoutée — l’affirmation peut sembler plus faible.',
  'meaning.quantifier':
    'un quantificateur a peut-être changé («\u00A0la plupart\u00A0» → «\u00A0tous\u00A0», «\u00A0certains\u00A0» → «\u00A0peu\u00A0»).',
  'issue.POST_EDITED':
    'La vérification du sens a signalé la première traduction\u202F; Claude l’a révisée en tenant compte de la source et du problème relevé.',
  'issue.OCR_LOW_CONFIDENCE':
    'Le scan était difficile à lire ici\u202F; le texte reconnu peut contenir des erreurs.',
  'issue.UNTRANSLATED': 'La traduction était identique à la source.',
  'issue.NUMBER_MISMATCH': 'Un nombre diffère entre la source et la traduction.',
  'issue.CITATION_MISMATCH': 'Une citation diffère entre la source et la traduction.',
  'issue.TAG_MISMATCH': 'Une partie de la mise en forme n’a pas pu être placée dans la traduction.',
  'issue.PLACEHOLDER_MISMATCH': 'Une formule, un lien ou un identifiant a disparu.',
  'issue.WRONG_LANGUAGE': 'La traduction ne semble pas être dans la langue cible.',
  'issue.REVIEW_SUGGESTED': 'Traduit en partie\u202F; vérifiez la formulation.',
  'issue.PARTLY_UNTRANSLATED': 'Une partie est restée dans la langue d’origine.',
  'issue.STYLE_APPROXIMATED':
    'Une partie de la mise en forme en ligne (gras, italique) a été approximée.',
  'issue.GLOSSARY_MISMATCH': 'Un terme du glossaire n’a pas été employé.',
  'issue.KEPT_ORIGINAL': 'Le texte original a été conservé ici.',
  'issue.BELOW_MIN_SIZE': 'Le texte a été réduit en dessous de la taille minimale habituelle.',
  'report.status.translated': 'Traduit',
  'report.status.warning': 'Avertissement',
  'report.status.untranslated': 'Non traduit — original conservé',
  'report.status.skipped': 'Non traduit (liste de références)',
  'download.pptx': 'Télécharger le PPTX traduit',
  'download.latex': 'Télécharger le LaTeX traduit',
  'download.docx': 'Télécharger le DOCX traduit',
  'download.report': 'Télécharger le rapport (JSON)',
  'preview.title': 'Aperçu',
  'preview.original': 'Original',
  'preview.translated': 'Traduit',
  'preview.loading': 'Génération de l’aperçu…',
  'preview.failed': 'L’aperçu n’a pas pu être généré. Le téléchargement n’est pas affecté.',
  'engine.browser.label': 'Google Translate',
  'engine.browser.description':
    'Traduit automatiquement dans la langue choisie — aussi sur téléphone. Utilise le traducteur de site web de Google, chargé uniquement pendant la traduction.',
  'privacy.browser-vendor': 'Texte envoyé à Google',
  'settings.showAdvancedEngines': 'Afficher les moteurs avancés (API Claude, LLM local)',
  'sheet.title': 'Traduire avec votre navigateur',
  'sheet.intro':
    'Votre navigateur traduit les paragraphes ci-dessous\u202F; le reste de la page ne change pas. Laissez cette page ouverte jusqu’à la fin.',
  'sheet.step.chrome-desktop':
    'Cliquez sur l’icône de traduction dans la barre d’adresse. Si {target} n’est pas proposé, ouvrez son menu ⋮ → «\u00A0Choisir une autre langue\u00A0» → {target}.',
  'sheet.step.chrome-android':
    'Ouvrez le menu ⋮ → «\u00A0Traduire…\u00A0». Si la page n’est pas en {target}, ouvrez le menu de la barre de traduction → «\u00A0Plus de langues\u00A0» → {target}.',
  'sheet.step.chrome-ios':
    'Appuyez sur ••• → «\u00A0Traduire\u00A0» (ou sur l’icône de traduction dans la barre d’adresse). Si la page n’est pas en {target}, ouvrez les options de la barre de traduction → «\u00A0Plus de langues\u00A0» → {target}.',
  'sheet.step.edge':
    'Cliquez sur l’icône de traduction dans la barre d’adresse et choisissez {target}.',
  'sheet.step.safari':
    'Appuyez sur le bouton «\u00A0aA\u00A0» dans la barre d’adresse → «\u00A0Traduire en {target}\u00A0».',
  'sheet.step.firefox':
    'Cliquez sur l’icône de traduction dans la barre d’adresse et choisissez {target}.',
  'sheet.step.other':
    'Utilisez la fonction «\u00A0Traduire la page\u00A0» de votre navigateur et choisissez {target}.',
  'sheet.privacy':
    'Votre navigateur envoie ce texte à son service de traduction (Chrome\u202F: Google).',
  'sheet.waiting': 'En attente de la traduction par votre navigateur…',
  'sheet.progress': '{done} / {total} paragraphes traduits',
  'sheet.wrongLanguage':
    'La page semble traduite en {got}. Choisissez {target} dans le menu de traduction de votre navigateur.',
  'sheet.stuck':
    'Rien n’a encore été traduit. Par défaut, les navigateurs traduisent vers leur propre langue — choisissez {target} dans le menu de traduction.',
  'sheet.stuckChrome':
    'Sur cet ordinateur, le moteur «\u00A0Traducteur intégré à Chrome\u00A0» fonctionne automatiquement\u202F: annulez et choisissez-le ci-dessus.',
  'review.compare': 'Comparer avec la rétrotraduction',
  'review.compareHint':
    'La rétrotraduction est la traduction retraduite vers la langue source. Les mots signalés diffèrent de la source\u202F; une reformulation est normale, mais vérifiez les nombres (en rouge), les négations et les atténuations.',
  'review.source': 'Source',
  'review.translation': 'Traduction',
  'review.back': 'Rétrotraduction',
  'review.edit': 'Modifier',
  'review.save': 'Enregistrer',
  'review.cancel': 'Annuler',
  'review.manual': 'Modifié par vous',
  'review.hint':
    'Le texte en pointillés conserve sa mise en forme\u202F; les cases grises sont des formules, des repères ou des liens et restent en place.',
  'review.pending': '{count} modifications pas encore appliquées',
  'review.apply': 'Appliquer les modifications et reconstruire le document',
  'review.applying': 'Reconstruction…',
  'download.bilingual': 'Télécharger la relecture bilingue (DOCX)',
  'bilingual.title': 'Relecture bilingue — {name}',
  'bilingual.notes': 'Notes',
  'download.pdf': 'Télécharger le PDF traduit',
  'download.dual': 'Télécharger le PDF en vis-à-vis',
  'download.word': 'Télécharger au format Word (modifiable)',
  'download.wordHint':
    'La traduction avec les styles Word\u202F: titres, paragraphes, tableaux et notes de bas de page en texte, figures et formules hors texte en images. Les en-têtes courants et les numéros de page sont omis.',
  'pdfReport.summary':
    '{translated} traduits · {warnings} avec avertissements · {untranslated} non traduits · {keptOriginal} conservés dans la langue d’origine · {scaled} légèrement réduits',
  'pdfReport.status.translated': 'Traduit',
  'pdfReport.status.warning': 'Avertissement',
  'pdfReport.status.untranslated': 'Non traduit — original conservé',
  'pdfReport.status.kept-original': 'Ne tenait pas — original conservé',
  'pdfReport.scale': 'réduit à {percent}\u202F%',
  'pdfReport.pages': 'page {pages}',
  'pdf.note':
    'La réparation de mise en page PDF est encore en cours d’amélioration\u202F: les paragraphes qui ne tiennent pas sont légèrement réduits ou conservés dans la langue d’origine, et chacun de ces cas est listé ci-dessous.',
  'preview.pageOf': 'Page {page} sur {total}',
  'preview.previous': 'Page précédente',
  'preview.next': 'Page suivante',
  'pdfReport.score': 'Score de mise en page {score}/100',
  'pdfReport.status.green': 'Bon',
  'pdfReport.status.yellow': 'À vérifier',
  'pdfReport.status.red': 'À revoir',
  'pdfReport.pageScore': 'p. {page}\u202F: {score}',
  'pdfReport.overflowNotes':
    '{count} notes de débordement ont été ajoutées sur des pages supplémentaires à la fin.',
  'pdfReport.fallback.relaxed-min': 'Réduit en dessous de la taille minimale normale',
  'pdfReport.fallback.annotation': 'Libellé original conservé\u202F; traduction dans une note PDF',
  'pdfReport.fallback.overflow-note':
    'Une partie du texte a été déplacée vers les notes de débordement',
  'pdfReport.fallback.keep-original': 'Texte original conservé',
  'pdf.pageRange': 'Plage de pages à traduire',
  'pdf.pageFrom': 'De la page',
  'pdf.pageTo': 'à la page',
  'pdfReport.ocr':
    'Texte reconnu à partir du scan (OCR) sur {pages} pages, confiance moyenne de {confidence}\u202F%. Les erreurs de reconnaissance subsistent dans la traduction\u202F: vérifiez les noms et les nombres.',
  'pdfReport.sanitized': 'Contenu actif supprimé de la sortie\u202F: {items}',
};
