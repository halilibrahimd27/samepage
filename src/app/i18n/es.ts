import type { MessageKey } from './en';

export const es: Record<MessageKey, string> = {
  'app.tagline': 'Traduzca documentos PDF, Word y PowerPoint conservando su diseño.',
  'header.settings': 'Ajustes',
  'header.uiLanguage': 'Idioma de la interfaz',

  'drop.title': 'Suelte aquí un archivo PDF, Word, PowerPoint o LaTeX',
  'drop.hint':
    'o elija un archivo (o un proyecto .samepage para reabrirlo). Se procesa en su navegador y nunca se sube a ningún sitio.',
  'drop.choose': 'Elegir archivo',
  'file.change': 'Elegir otro archivo',
  'file.reading': 'Leyendo el documento…',
  'file.pages': '{count} páginas',
  'settings.autoTranslate': 'Traducir automáticamente con Google',
  'settings.autoTranslateHint':
    'Desactivado: usted activa la traducción de páginas del propio navegador y elige el idioma.',
  'sheet.autoFailed':
    'No se pudo iniciar la traducción automática (Google Translate no se cargó). Traduzca con su navegador:',
  'error.chromeTranslator':
    'Chrome no pudo preparar su traductor local para este par de idiomas (puede que Chrome no lo ofrezca o que la descarga del idioma se haya detenido). Elija «Google Translate» o inténtelo de nuevo más tarde.',
  'file.detected': 'Idioma detectado: {lang}',
  'file.undetected':
    'No se pudo detectar el idioma del documento. Elija abajo el idioma de origen: uno equivocado produce una traducción equivocada.',
  'file.scanned':
    'PDF escaneado: su texto se reconocerá en su dispositivo (OCR) al traducir. La primera vez se descargan unos 5 MB de este sitio. Elija el idioma de origen.',
  'file.thumbnail': 'Primera página de {name}',

  'error.empty': 'Este archivo está vacío.',
  'error.unsupported':
    'Este archivo no es un documento PDF, DOCX o PPTX, ni un código fuente LaTeX (.tex o un .zip de proyecto), ni un proyecto samepage.',
  'error.docm':
    'Los archivos con macros (.docm, .pptm) no son compatibles. Guarde el documento como .docx o .pptx e inténtelo de nuevo.',
  'error.tooLarge': 'Este archivo es demasiado grande. El límite para archivos {kind} es {limit}.',
  'error.tooManyPages':
    'Este PDF tiene {count} páginas. Se pueden procesar hasta {limit} páginas a la vez.',
  'error.encrypted':
    'Este PDF está protegido con contraseña. Quite la contraseña e inténtelo de nuevo.',
  'error.corrupt': 'No se pudo abrir este archivo. Puede estar dañado.',
  'error.project':
    'No se pudo abrir este archivo de proyecto samepage. Puede estar dañado o haberse creado con una versión más reciente.',
  'project.opened':
    'Proyecto reabierto: la traducción de {engine} se muestra tal como se guardó, sin volver a traducir.',
  'project.save': 'Guardar proyecto (.samepage)',
  'project.saveHint':
    'El documento, su traducción, sus correcciones y el glosario en un solo archivo. Ábralo aquí más adelante, en cualquier navegador, sin volver a traducir.',
  'project.glossary': 'Añadir los {count} términos del glosario del proyecto',
  'error.workerCrash': 'El motor de procesamiento se bloqueó.',
  'error.workerTimeout': 'El motor de procesamiento dejó de responder.',
  'error.restart': 'Reiniciar motor',
  'error.generic': 'Algo salió mal. Su archivo no se subió a ningún sitio.',
  'error.tryAgain': 'Reintentar',

  'config.source': 'Idioma de origen',
  'config.target': 'Idioma de destino',
  'config.swap': 'Intercambiar idioma de origen y de destino',
  'config.engine': 'Motor de traducción',
  'config.sameLanguage': 'El idioma de origen y el de destino deben ser distintos.',
  'config.translate': 'Traducir',
  'config.translateSoon': 'La traducción se está desarrollando y llegará en una próxima versión.',

  'engine.anthropic.label': 'Claude (Anthropic)',
  'engine.anthropic.description':
    'La mejor calidad para texto académico, con comprobación de fidelidad. Usa su propia clave de API.',
  'engine.chrome-builtin.label': 'Traductor integrado de Chrome',
  'engine.chrome-builtin.description':
    'Se ejecuta de forma privada en su dispositivo. Solo en Chrome y Edge de escritorio.',
  'engine.openai-compatible.label': 'Servidor LLM local',
  'engine.openai-compatible.description':
    'Ollama, LM Studio o cualquier servidor compatible con OpenAI en este equipo.',
  'engine.pseudo.label': 'Pseudo (prueba)',
  'engine.pseudo.description':
    'Traducción falsa determinista para probar diseños. Sin conexión a la red.',
  'engine.badge.draft': 'Calidad de borrador',
  'engine.badge.unavailable': 'No disponible en este navegador',
  'privacy.on-device': 'En el dispositivo',
  'privacy.third-party-api': 'Texto enviado a Anthropic',
  'privacy.local-server': 'Texto enviado a su servidor local',

  'key.label': 'Clave de API de Anthropic',
  'key.hint':
    'Se conserva en memoria solo durante esta sesión. Use una clave exclusiva con un límite de gasto bajo.',
  'baseUrl.label': 'URL del servidor',
  'baseUrl.hint':
    'El servidor debe permitir este sitio mediante CORS (en Ollama, configure OLLAMA_ORIGINS). Solo se admiten direcciones localhost.',

  'settings.title': 'Ajustes',
  'settings.close': 'Cerrar',
  'settings.localCitations': 'Escribir «et al.» según el idioma de destino',
  'settings.localCitationsHint':
    'En las citas: turco «vd.», ruso y búlgaro «и др.», ucraniano «та ін.», polaco «i in.», otros idiomas «et al.».',
  'settings.fidelityCheck': 'Comprobación del significado',
  'settings.fidelityCheckHint':
    'Marca los párrafos cuyo significado puede haber cambiado: una negación perdida o añadida, una afirmación reforzada o atenuada (puede, sugiere) o un cuantificador alterado (la mayoría → todos). Google y Chrome: la traducción se retrotraduce y se compara (tarda aproximadamente otro tanto). Claude: una segunda pasada de revisión (añade entre un 30 % y un 50 % al coste).',
  'settings.translateReferences': 'Traducir la lista de referencias',
  'settings.referenceTitles': 'Traducir los títulos de las referencias entre corchetes (APA 7)',
  'settings.referenceTitlesHint':
    'Las referencias se mantienen como se publicaron; a los títulos en otro idioma se les añade su traducción a continuación: “Makine çevirisi [Machine translation].”',
  'settings.translateComments': 'Traducir los comentarios de DOCX',
  'settings.translateMetadata': 'Traducir el título del documento (metadatos)',
  'settings.showTestEngine': 'Mostrar el motor de prueba',

  'worker.ready': 'Motor de procesamiento listo',
  'worker.starting': 'Iniciando el motor de procesamiento…',

  'footer.privacy':
    'Su documento nunca sale de su dispositivo. Solo se envía texto al motor que usted elija.',
  'footer.source': 'Código fuente (AGPL-3.0)',
  'footer.quality': 'Calidad en 88 artículos reales',
  'quality.title': 'Calidad en artículos reales',
  'quality.summary':
    '{papers} artículos de acceso abierto en {languages} idiomas ({pages} páginas): puntuación media de maquetación {mean}, {high} artículos con 99 o más.',
  'quality.method':
    'Traducidos con {engine}, el motor predeterminado, el {date}. La puntuación de maquetación es 100 cuando cada párrafo queda en su caja original a su tamaño original; se restan puntos por texto reducido, notas PDF, originales conservados y solapamientos, como en el informe de calidad.',
  'quality.honest':
    'La puntuación mide la maquetación, no la calidad de la traducción: de eso se encargan la comprobación del significado y su propia lectura. Los artículos no están en el repositorio; sus puntuaciones sí, junto con el script que las genera.',
  'quality.back': 'Volver a traducir',
  'quality.language': 'Idioma de origen',
  'quality.field': 'Campo',
  'quality.papers': 'Artículos',
  'quality.pages': 'Páginas',
  'quality.mean': 'Media',
  'quality.lowest': 'Mínima',
  'quality.field.health': 'Medicina y salud',
  'quality.field.engineering': 'Ingeniería',
  'quality.field.computing': 'Informática',
  'quality.field.economics': 'Economía',
  'quality.field.chemistry': 'Química',
  'quality.field.mathematics': 'Matemáticas',
  'quality.field.biology': 'Biología y agricultura',
  'quality.field.physics': 'Física',
  'quality.field.social': 'Ciencias sociales y educación',
  'quality.field.law': 'Derecho',
  'model.label': 'Modelo',
  'model.quality': 'máxima fidelidad',
  'model.balanced': 'equilibrado',
  'model.economy': 'económico',
  'key.remember': 'Recordar en este dispositivo',
  'key.rememberWarning':
    'La clave se guarda sin cifrar en este navegador. Úselo solo en su propio dispositivo.',
  'key.forget': 'Olvidar clave',
  'localModel.label': 'Nombre del modelo',
  'localModel.hint': 'Tal como lo indica su servidor, p. ej. qwen2.5:14b.',
  'config.needKey': 'Introduzca primero su clave de API de Anthropic.',
  'config.needLocalModel': 'Introduzca el nombre del modelo de su servidor local.',
  'settings.clearCache': 'Borrar la caché de traducción',
  'settings.cacheCleared': 'Caché de traducción borrada.',
  'settings.playground': 'Abrir el campo de pruebas de texto (herramienta para desarrolladores)',
  'playground.title': 'Campo de pruebas de texto',
  'playground.description':
    'Pegue texto, tradúzcalo con cualquier motor e inspeccione los resultados de validación y fidelidad. Separe los párrafos con una línea en blanco. Marcado: **negrita**, *cursiva*, $fórmula$.',
  'playground.back': '← Volver a samepage',
  'playground.input': 'Texto de origen',
  'playground.sample': 'Cargar ejemplo académico en turco',
  'playground.numberLocalization': 'Localizar formatos numéricos',
  'playground.useCache': 'Usar la caché de traducción',
  'playground.translate': 'Traducir',
  'playground.cancel': 'Cancelar',
  'playground.progress': '{done} / {total} párrafos',
  'playground.estimate':
    '≈ {requests} solicitudes · ~{input} tokens de entrada y ~{output} de salida (sin contar los tokens de razonamiento)',
  'playground.summary':
    '{ok} aceptados · {warnings} con avisos · {untranslated} sin traducir · {cached} de la caché',
  'playground.tagSurvival': 'Etiquetas conservadas (Chrome): {survived} / {total}',
  'playground.duration': 'Terminado en {seconds} s',
  'playground.empty': 'Introduzca primero algún texto.',
  'playground.downloading': 'Descargando el modelo de traducción… {percent} %',
  'result.translation': 'Traducción',
  'result.untranslated': 'Sin traducir: se conserva el original',
  'result.cached': 'De la caché',
  'result.attempts': '{count} intentos',
  'result.ok': 'Aceptado',
  'glossary.title': 'Glosario',
  'glossary.hint': 'Los términos se usan exactamente en cada traducción y se comprueban después.',
  'glossary.extract': 'Sugerir términos a partir del texto',
  'glossary.extracting': 'Sugiriendo términos…',
  'glossary.import': 'Importar CSV',
  'glossary.export': 'Exportar CSV',
  'glossary.exportPack': 'Exportar todo como paquete',
  'glossary.packHint':
    'Un solo archivo con una columna por idioma para todos los glosarios de este navegador: compártalo con su laboratorio o departamento; cualquiera puede importarlo para cualquiera de sus pares de idiomas.',
  'glossary.imported': 'Términos importados: {count}.',
  'glossary.packImported':
    'Términos importados para este par de idiomas desde un paquete ({languages}): {count}.',
  'glossary.add': 'Añadir término',
  'glossary.clear': 'Vaciar',
  'glossary.source': 'Término de origen',
  'glossary.target': 'Traducción',
  'glossary.note': 'Nota',
  'glossary.remove': 'Quitar',
  'glossary.count': '{count} términos',
  'glossary.suggestionCount': '{count} sugeridos',
  'glossary.suggested': 'Encontrados en este documento',
  'glossary.suggestedHint':
    'Las palabras en fuente de código y los nombres de herramientas se conservan tal cual; los términos de cada disciplina reciben su traducción habitual. Desmarque lo que no desee.',
  'glossary.keep': 'se conserva tal cual',
  'glossary.addSelected': 'Añadir {count} al glosario',
  'glossary.reason.code': 'fuente de código',
  'glossary.reason.tool': 'nombre de herramienta',
  'glossary.reason.stats': 'estadística',
  'glossary.reason.medicine': 'medicina',
  'glossary.reason.cs': 'informática',
  'glossary.reason.engineering': 'ingeniería',
  'glossary.reason.chemistry': 'química',
  'jobError.auth': 'Se rechazó la clave de API.',
  'jobError.network': 'No se pudo contactar con el servicio de traducción.',
  'jobError.rate-limit': 'Se alcanzó el límite de solicitudes. Inténtelo de nuevo en un momento.',
  'jobError.server': 'El servicio de traducción devolvió un error.',
  'jobError.bad-request': 'Se rechazó la solicitud.',
  'jobError.unavailable': 'Este motor no está disponible.',
  'jobError.cancelled': 'Cancelado.',
  'jobError.internal': 'Error inesperado.',
  'jobError.rejected': 'El documento fue rechazado por las comprobaciones de seguridad.',
  'workspace.translating': 'Traduciendo… {done} / {total} párrafos',
  'workspace.ocr': 'Reconociendo texto (OCR)… página {done} / {total}',
  'workspace.checking': 'Comprobando el significado… {done} / {total} párrafos',
  'workspace.polishing': 'Claude está revisando las frases marcadas… {done} / {total}',
  'polish.label': 'Pulir con Claude las frases marcadas',
  'polish.hint':
    'Claude revisa, con su propia clave de API de Anthropic, las frases que marca la comprobación del significado. Solo esas frases se envían a Anthropic.',
  'spelling.label': 'Ortografía del inglés',
  'spelling.default': 'La del motor',
  'spelling.american': 'Americana (color, analyze, modeling)',
  'spelling.british': 'Británica (colour, analyse, modelling)',
  'mode.label': 'Qué traducir',
  'mode.document': 'Documento completo',
  'mode.abstract': 'Título, resumen y palabras clave',
  'abstract.searching': 'Buscando el título, el resumen y las palabras clave…',
  'abstract.found':
    'Encontrados en el documento. Revíselos y edítelos si es necesario antes de traducir.',
  'abstract.missing':
    'No se reconoció ningún resumen en este documento. Pegue abajo el título, el resumen y las palabras clave.',
  'abstract.otherLang': 'El resumen encontrado está en {lang}, no en el idioma de origen.',
  'abstract.alreadyTarget':
    'El documento ya tiene un resumen en {lang}; compárelo con la traducción.',
  'abstract.title': 'Título',
  'abstract.abstract': 'Resumen',
  'abstract.keywords': 'Palabras clave',
  'abstract.words': '{count} palabras',
  'abstract.wordsCompare': '{source} palabras en el original · {target} en la traducción',
  'abstract.empty': 'Introduzca el resumen (o un título o palabras clave) que desea traducir.',
  'abstract.result': 'Traducción ({lang})',
  'abstract.copy': 'Copiar',
  'abstract.copyAll': 'Copiar todo',
  'abstract.copied': 'Copiado',
  'abstract.copyFailed': 'El navegador no permitió copiar; seleccione el texto y cópielo.',
  'statement.title': 'Declaración de uso de IA para la revista',
  'statement.hint':
    'La mayoría de las revistas piden a los autores que declaren el uso de traducción automática. Pegue esto en los agradecimientos o en la sección de métodos y edítelo según sea necesario.',
  'abstract.download': 'Descargar (.txt)',
  'workspace.pdfSoon':
    'La traducción de PDF llegará en una próxima versión. La traducción de DOCX funciona hoy.',
  'report.title': 'Informe de calidad',
  'report.summary':
    '{translated} traducidos · {warnings} con avisos · {untranslated} sin traducir · {skipped} omitidos · {cached} de la caché',
  'report.repairs': 'Reparaciones estructurales',
  'report.repair.D1_ROW_HEIGHT':
    'La altura de fila de la tabla pasó de exacta a mínima para que el texto no se recorte',
  'report.repair.D2_TEXTBOX': 'Cuadro de texto configurado para crecer con su texto',
  'report.repair.D3_FRAME': 'La altura del marco pasó de exacta a mínima',
  'report.repair.P1_SLIDE_FIT':
    'Texto de la diapositiva reducido (“reducir texto en desbordamiento” de PowerPoint) para que la traducción quepa en su forma',
  'report.repair.L1_LANGUAGE':
    'Idioma del documento cambiado al de destino en babel/polyglossia (guionado, “Figure”, fechas)',
  'report.repair.L2_ENCODING': 'Archivo que no está en UTF-8: se conserva tal cual, sin traducir',
  'report.repair.D4_LONG_TOKEN':
    'Se añadieron posibilidades invisibles de salto de línea a una palabra o URL larga en una celda de ancho fijo',
  'report.attention': 'Requiere su atención',
  'report.allSegments': 'Todos los párrafos',
  'report.empty': 'Nada requiere atención.',
  'report.meaningFilter': 'Comprobación del significado',
  'report.technical': 'Detalles técnicos',
  'meaning.title': 'Comprobación del significado',
  'meaning.back': 'Retrotraducción',
  'meaning.negationLost':
    'puede haberse perdido una negación: la frase podría decir ahora lo contrario.',
  'meaning.negationAdded':
    'puede haberse añadido una negación: la frase podría decir ahora lo contrario.',
  'meaning.hedgingLost':
    'puede haberse perdido un atenuante (“puede”, “sugiere”): la afirmación podría parecer más fuerte que en el original.',
  'meaning.hedgingAdded':
    'puede haberse añadido un atenuante: la afirmación podría parecer más débil.',
  'meaning.quantifier':
    'puede haber cambiado un cuantificador (“la mayoría” → “todos”, “algunos” → “pocos”).',
  'issue.POST_EDITED':
    'La comprobación del significado marcó la primera traducción; Claude la revisó teniendo a la vista el original y el hallazgo.',
  'issue.OCR_LOW_CONFIDENCE':
    'El escaneo era difícil de leer aquí; el texto reconocido puede contener errores.',
  'issue.UNTRANSLATED': 'La traducción era idéntica al original.',
  'issue.NUMBER_MISMATCH': 'Un número difiere entre el original y la traducción.',
  'issue.CITATION_MISMATCH': 'Una cita difiere entre el original y la traducción.',
  'issue.TAG_MISMATCH': 'No se pudo colocar parte del formato en la traducción.',
  'issue.PLACEHOLDER_MISMATCH': 'Falta una fórmula, un enlace o un identificador.',
  'issue.WRONG_LANGUAGE': 'La traducción no parece estar en el idioma de destino.',
  'issue.REVIEW_SUGGESTED': 'Traducido solo en parte; revise la redacción.',
  'issue.PARTLY_UNTRANSLATED': 'Una parte se conservó en el idioma original.',
  'issue.STYLE_APPROXIMATED': 'Parte del formato en línea (negrita, cursiva) se aproximó.',
  'issue.GLOSSARY_MISMATCH': 'No se usó un término del glosario.',
  'issue.KEPT_ORIGINAL': 'Aquí se conservó el texto original.',
  'issue.BELOW_MIN_SIZE': 'El texto se compuso en un tamaño menor que el mínimo habitual.',
  'report.status.translated': 'Traducido',
  'report.status.warning': 'Aviso',
  'report.status.untranslated': 'Sin traducir: se conserva el original',
  'report.status.skipped': 'No traducido (lista de referencias)',
  'download.pptx': 'Descargar PPTX traducido',
  'download.latex': 'Descargar LaTeX traducido',
  'download.docx': 'Descargar DOCX traducido',
  'download.report': 'Descargar informe (JSON)',
  'preview.title': 'Vista previa',
  'preview.original': 'Original',
  'preview.translated': 'Traducido',
  'preview.loading': 'Generando la vista previa…',
  'preview.failed': 'No se pudo generar la vista previa. La descarga no se ve afectada.',
  'engine.browser.label': 'Google Translate',
  'engine.browser.description':
    'Traduce automáticamente al idioma que elija, también en teléfonos. Usa el traductor web de Google, que se carga solo mientras traduce.',
  'privacy.browser-vendor': 'Texto enviado a Google',
  'settings.showAdvancedEngines': 'Mostrar motores avanzados (API de Claude, LLM local)',
  'sheet.title': 'Traducir con su navegador',
  'sheet.intro':
    'Su navegador traduce los párrafos de abajo; el resto de la página no cambia. Deje esta página abierta hasta que termine.',
  'sheet.step.chrome-desktop':
    'Haga clic en el icono de traducción de la barra de direcciones. Si no ofrece {target}, abra su menú ⋮ → “Elegir otro idioma” → {target}.',
  'sheet.step.chrome-android':
    'Abra el menú ⋮ → “Traducir…”. Si la página no está en {target}, abra el menú de la barra de traducción → “Más idiomas” → {target}.',
  'sheet.step.chrome-ios':
    'Toque ••• → “Traducir” (o el icono de traducción de la barra de direcciones). Si la página no está en {target}, abra las opciones de la barra de traducción → “Más idiomas” → {target}.',
  'sheet.step.edge':
    'Haga clic en el icono de traducción de la barra de direcciones y elija {target}.',
  'sheet.step.safari': 'Toque el botón “aA” de la barra de direcciones → “Traducir a {target}”.',
  'sheet.step.firefox':
    'Haga clic en el icono de traducción de la barra de direcciones y elija {target}.',
  'sheet.step.other': 'Use la función “Traducir página” de su navegador y elija {target}.',
  'sheet.privacy': 'Su navegador envía este texto a su servicio de traducción (Chrome: Google).',
  'sheet.waiting': 'Esperando a que su navegador traduzca…',
  'sheet.progress': '{done} / {total} párrafos traducidos',
  'sheet.wrongLanguage':
    'Parece que la página se tradujo a {got}. Elija {target} en el menú de traducción de su navegador.',
  'sheet.stuck':
    'Todavía no se ha traducido nada. Los navegadores traducen por defecto a su propio idioma: elija {target} en el menú de traducción.',
  'sheet.stuckChrome':
    'En este equipo el motor “Traductor integrado de Chrome” funciona automáticamente: cancele y elíjalo arriba.',
  'review.compare': 'Comparar con la retrotraducción',
  'review.compareHint':
    'La retrotraducción es la traducción vuelta a traducir al idioma de origen. Las palabras marcadas difieren del original; que cambie la redacción es normal, pero revise los números (en rojo), las negaciones y los atenuantes.',
  'review.source': 'Original',
  'review.translation': 'Traducción',
  'review.back': 'Retrotraducción',
  'review.edit': 'Editar',
  'review.save': 'Guardar',
  'review.cancel': 'Cancelar',
  'review.manual': 'Editado por usted',
  'review.hint':
    'El texto con subrayado punteado conserva su formato; los recuadros grises son fórmulas, marcas o enlaces y permanecen en su sitio.',
  'review.pending': '{count} ediciones sin aplicar',
  'review.apply': 'Aplicar las ediciones y reconstruir el documento',
  'review.applying': 'Reconstruyendo…',
  'download.bilingual': 'Descargar revisión bilingüe (DOCX)',
  'bilingual.title': 'Revisión bilingüe — {name}',
  'bilingual.notes': 'Notas',
  'download.pdf': 'Descargar PDF traducido',
  'download.dual': 'Descargar PDF en paralelo',
  'download.word': 'Descargar como Word (editable)',
  'download.wordHint':
    'La traducción con estilos de Word: títulos, párrafos, tablas y notas al pie como texto; figuras y fórmulas destacadas como imágenes. Se omiten los encabezados de página y la numeración.',
  'pdfReport.summary':
    '{translated} traducidos · {warnings} con avisos · {untranslated} sin traducir · {keptOriginal} conservados en el idioma original · {scaled} ligeramente reducidos',
  'pdfReport.status.translated': 'Traducido',
  'pdfReport.status.warning': 'Aviso',
  'pdfReport.status.untranslated': 'Sin traducir: se conserva el original',
  'pdfReport.status.kept-original': 'No cabía: se conserva el original',
  'pdfReport.scale': 'reducido al {percent} %',
  'pdfReport.pages': 'página {pages}',
  'pdf.note':
    'La reparación del diseño de PDF todavía se está mejorando: los párrafos que no caben se reducen ligeramente o se conservan en el idioma original, y cada caso se enumera a continuación.',
  'preview.pageOf': 'Página {page} de {total}',
  'preview.previous': 'Página anterior',
  'preview.next': 'Página siguiente',
  'pdfReport.score': 'Puntuación de diseño {score}/100',
  'pdfReport.status.green': 'Bien',
  'pdfReport.status.yellow': 'Revisar',
  'pdfReport.status.red': 'Requiere revisión',
  'pdfReport.pageScore': 'p. {page}: {score}',
  'pdfReport.overflowNotes':
    'Se añadieron {count} notas de desbordamiento en páginas adicionales al final.',
  'pdfReport.fallback.relaxed-min': 'Reducido por debajo del tamaño mínimo normal',
  'pdfReport.fallback.annotation': 'Etiqueta original conservada; traducción en una nota del PDF',
  'pdfReport.fallback.overflow-note': 'Parte del texto pasó a las notas de desbordamiento',
  'pdfReport.fallback.keep-original': 'Texto original conservado',
  'pdf.pageRange': 'Páginas que traducir',
  'pdf.pageFrom': 'Desde la página',
  'pdf.pageTo': 'hasta la página',
  'pdfReport.ocr':
    'Texto reconocido del escaneo (OCR) en {pages} páginas, confianza media del {confidence} %. Los errores de reconocimiento permanecen en la traducción: revise nombres y números.',
  'pdfReport.sanitized': 'Contenido activo eliminado de la salida: {items}',
};
