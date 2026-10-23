import type { MessageKey } from './en';

export const tr: Record<MessageKey, string> = {
  'app.tagline': 'PDF ve DOCX belgelerini düzenini koruyarak çevirin.',
  'header.settings': 'Ayarlar',
  'header.uiLanguage': 'Arayüz dili',

  'drop.title': 'PDF veya DOCX dosyasını buraya bırakın',
  'drop.hint': 'ya da bir dosya seçin. Dosya tarayıcınızda işlenir, hiçbir yere yüklenmez.',
  'drop.choose': 'Dosya seç',
  'file.change': 'Başka dosya seç',
  'file.reading': 'Belge okunuyor…',
  'file.pages': '{count} sayfa',
  'file.thumbnail': '{name} belgesinin ilk sayfası',

  'error.empty': 'Bu dosya boş.',
  'error.unsupported': 'Bu dosya bir PDF veya DOCX belgesi değil.',
  'error.docm':
    'Makro içeren Word dosyaları (.docm) desteklenmiyor. Belgeyi .docx olarak kaydedip tekrar deneyin.',
  'error.tooLarge': 'Bu dosya çok büyük. {kind} dosyaları için sınır {limit}.',
  'error.tooManyPages': 'Bu PDF {count} sayfa. Tek seferde en fazla {limit} sayfa işlenebilir.',
  'error.encrypted': 'Bu PDF parola korumalı. Parolayı kaldırıp tekrar deneyin.',
  'error.corrupt': 'Bu dosya açılamadı. Hasarlı olabilir.',
  'error.workerCrash': 'İşleme motoru çöktü.',
  'error.workerTimeout': 'İşleme motoru yanıt vermiyor.',
  'error.restart': 'Motoru yeniden başlat',
  'error.generic': 'Bir şeyler ters gitti. Dosyanız hiçbir yere yüklenmedi.',
  'error.tryAgain': 'Tekrar dene',

  'config.source': 'Kaynak dil',
  'config.target': 'Hedef dil',
  'config.engine': 'Çeviri motoru',
  'config.sameLanguage': 'Kaynak ve hedef dil farklı olmalı.',
  'config.translate': 'Çevir',
  'config.translateSoon': 'Çeviri geliştiriliyor, yakında gelecek bir sürümde eklenecek.',

  'engine.anthropic.label': 'Claude (Anthropic)',
  'engine.anthropic.description':
    'Akademik metin için en iyi kalite, sadakat kontrolüyle. Kendi API anahtarınızı kullanır.',
  'engine.chrome-builtin.label': 'Chrome yerleşik çevirmen',
  'engine.chrome-builtin.description':
    'Ücretsiz ve gizli, cihazınızda çalışır. Yalnızca masaüstü Chrome ve Edge.',
  'engine.openai-compatible.label': 'Yerel LLM sunucusu',
  'engine.openai-compatible.description':
    'Bu bilgisayardaki Ollama, LM Studio veya OpenAI uyumlu herhangi bir sunucu.',
  'engine.pseudo.label': 'Pseudo (test)',
  'engine.pseudo.description': 'Düzen testleri için deterministik sahte çeviri. Ağ kullanmaz.',
  'engine.badge.draft': 'Taslak kalite',
  'engine.badge.unavailable': 'Bu tarayıcıda kullanılamıyor',
  'privacy.on-device': 'Cihazda',
  'privacy.third-party-api': "Metin Anthropic'e gönderilir",
  'privacy.local-server': 'Metin yerel sunucunuza gönderilir',

  'key.label': 'Anthropic API anahtarı',
  'key.hint':
    'Yalnızca bu oturum boyunca bellekte tutulur. Düşük harcama limitli, bu iş için ayrı bir anahtar kullanın.',
  'baseUrl.label': 'Sunucu adresi',
  'baseUrl.hint':
    'Sunucu bu siteye CORS izni vermeli (Ollama için OLLAMA_ORIGINS). Yalnızca localhost adreslerine izin verilir.',

  'settings.title': 'Ayarlar',
  'settings.close': 'Kapat',
  'settings.fidelityCheck': 'Sadakat kontrolü (Claude)',
  'settings.fidelityCheckHint':
    'İkinci bir geçiş kaynak ile çeviriyi karşılaştırır ve olası anlam farklarını işaretler. Maliyete yaklaşık %30–50 ekler.',
  'settings.translateReferences': 'Kaynakçayı çevir',
  'settings.translateComments': 'DOCX yorumlarını çevir',
  'settings.translateMetadata': 'Belge başlığını (meta veri) çevir',
  'settings.showTestEngine': 'Test motorunu göster',

  'worker.ready': 'İşleme motoru hazır',
  'worker.starting': 'İşleme motoru başlatılıyor…',

  'footer.privacy': 'Belgeniz cihazınızdan çıkmaz. Yalnızca metin, seçtiğiniz motora gönderilir.',
  'footer.source': 'Kaynak kod (AGPL-3.0)',
};
