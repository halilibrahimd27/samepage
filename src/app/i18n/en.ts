export const en = {
  'app.tagline': 'Translate PDF and DOCX documents while keeping their layout.',
  'header.settings': 'Settings',
  'header.uiLanguage': 'Interface language',

  'drop.title': 'Drop a PDF or DOCX file here',
  'drop.hint': 'or choose a file. It is processed in your browser and never uploaded.',
  'drop.choose': 'Choose file',
  'file.change': 'Choose another file',
  'file.reading': 'Reading document…',
  'file.pages': '{count} pages',
  'file.thumbnail': 'First page of {name}',

  'error.empty': 'This file is empty.',
  'error.unsupported': 'This file is not a PDF or DOCX document.',
  'error.docm':
    'Macro-enabled Word files (.docm) are not supported. Save the document as .docx and try again.',
  'error.tooLarge': 'This file is too large. The limit for {kind} files is {limit}.',
  'error.tooManyPages': 'This PDF has {count} pages. Up to {limit} pages can be processed at once.',
  'error.encrypted': 'This PDF is password-protected. Remove the password and try again.',
  'error.corrupt': 'This file could not be opened. It may be damaged.',
  'error.workerCrash': 'The processing engine crashed.',
  'error.workerTimeout': 'The processing engine stopped responding.',
  'error.restart': 'Restart engine',
  'error.generic': 'Something went wrong. Your file was not uploaded anywhere.',
  'error.tryAgain': 'Try again',

  'config.source': 'Source language',
  'config.target': 'Target language',
  'config.engine': 'Translation engine',
  'config.sameLanguage': 'Source and target language must be different.',
  'config.translate': 'Translate',
  'config.translateSoon': 'Translation is being built and arrives in an upcoming release.',

  'engine.anthropic.label': 'Claude (Anthropic)',
  'engine.anthropic.description':
    'Best quality for academic text, with a fidelity check. Uses your own API key.',
  'engine.chrome-builtin.label': 'Chrome built-in translator',
  'engine.chrome-builtin.description':
    'Free and private, runs on your device. Desktop Chrome and Edge only.',
  'engine.openai-compatible.label': 'Local LLM server',
  'engine.openai-compatible.description':
    'Ollama, LM Studio or any OpenAI-compatible server on this computer.',
  'engine.pseudo.label': 'Pseudo (test)',
  'engine.pseudo.description': 'Deterministic fake translation for testing layouts. No network.',
  'engine.badge.draft': 'Draft quality',
  'engine.badge.unavailable': 'Not available in this browser',
  'privacy.on-device': 'On-device',
  'privacy.third-party-api': 'Text sent to Anthropic',
  'privacy.local-server': 'Text sent to your local server',

  'key.label': 'Anthropic API key',
  'key.hint': 'Kept in memory for this session only. Use a dedicated key with a low spend limit.',
  'baseUrl.label': 'Server URL',
  'baseUrl.hint':
    'The server must allow this site via CORS (for Ollama, set OLLAMA_ORIGINS). Only localhost addresses are allowed.',

  'settings.title': 'Settings',
  'settings.close': 'Close',
  'settings.fidelityCheck': 'Fidelity check (Claude)',
  'settings.fidelityCheckHint':
    'A second pass compares source and translation and flags possible meaning differences. Adds roughly 30–50% to the cost.',
  'settings.translateReferences': 'Translate the reference list',
  'settings.translateComments': 'Translate DOCX comments',
  'settings.translateMetadata': 'Translate the document title (metadata)',
  'settings.showTestEngine': 'Show the test engine',

  'worker.ready': 'Processing engine ready',
  'worker.starting': 'Starting processing engine…',

  'footer.privacy':
    'Your document never leaves your device. Only text is sent to the engine you choose.',
  'footer.source': 'Source code (AGPL-3.0)',
} as const;

export type MessageKey = keyof typeof en;
