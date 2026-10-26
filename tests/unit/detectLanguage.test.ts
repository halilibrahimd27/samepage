import { describe, expect, it } from 'vitest';
import { detectLanguage } from '../../src/core/detectLanguage';

const samples: Record<string, string> = {
  en: 'In modern software development, the use of external libraries and packages is increasingly prevalent, streamlining the development process and enabling developers to deploy feature-rich systems with little coding. While this reliance on reusing code offers substantial benefits, it also introduces serious risks.',
  tr: 'Bu çalışmada, Türkçe akademik metinlerin makine çevirisinde anlam kaymasının hangi koşullarda ortaya çıktığı incelenmiştir. Bulgular, uzun ve iç içe geçmiş tümcelerde terim tutarlılığının belirgin biçimde azaldığını göstermektedir ve bu durum çeviri kalitesi için önemli bir sorun olarak değerlendirilmiştir.',
  de: 'In der modernen Softwareentwicklung ist die Verwendung externer Bibliotheken und Pakete immer weiter verbreitet. Sie vereinfacht den Entwicklungsprozess und ermöglicht es den Entwicklern, mit wenig Code funktionsreiche Systeme bereitzustellen, die auch für die Forschung wichtig sind.',
  ru: 'В современной разработке программного обеспечения использование внешних библиотек и пакетов становится всё более распространённым, что упрощает процесс разработки и позволяет разработчикам создавать системы с богатыми функциями при минимальном объёме кода, но это также создаёт риски для безопасности.',
};

describe('detectLanguage', () => {
  it.each(Object.entries(samples))('recognises %s', (lang, text) => {
    expect(detectLanguage(text)?.lang).toBe(lang);
  });

  it('returns null when the sample is too short or mixed', () => {
    expect(detectLanguage('Table 1: PyPI')).toBeNull();
    expect(detectLanguage('')).toBeNull();
  });
});
