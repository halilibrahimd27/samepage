import { describe, expect, it } from 'vitest';
import { backTranslationFindings, compareMeaning } from '../../src/core/validate/meaning';

const issues = (source: string, back: string, lang: string) =>
  compareMeaning(source, back, lang).map((f) => `${f.severity}: ${f.issue.split(':')[0]}`);

describe('back-translation meaning check', () => {
  it('flags lost negation, hedging and changed quantifiers in English', () => {
    expect(
      issues(
        'These results suggest that the method may improve accuracy in most cases.',
        'These results show that the method improves accuracy in all cases.',
        'en',
      ),
    ).toEqual(['major: hedging lost', 'major: quantifier changed']);
    expect(
      issues(
        'The model did not converge after 100 epochs.',
        'The model converged after 100 epochs.',
        'en',
      ),
    ).toEqual(['major: negation lost']);
  });

  it('catches a hedged finding stated as fact (as Google rendered one)', () => {
    expect(
      issues(
        'The results suggest that the method reliably detects a considerable number of faulty records.',
        'The results reveal that the method reliably detects a significant number of faulty records.',
        'en',
      ),
    ).toEqual(['major: hedging lost']);
  });

  it('accepts paraphrases that keep the meaning', () => {
    expect(
      issues(
        'The model failed to converge within 100 epochs of training.',
        'The model did not converge within 100 epochs of training.',
        'en',
      ),
    ).toEqual([]);
    expect(
      issues(
        'This approach may be applied to all datasets considered here.',
        'This approach can be applied to every dataset considered here.',
        'en',
      ),
    ).toEqual([]);
    // Real cases from papers: a proposal is not a hedge, "a few" is "some", lexical negation.
    expect(
      issues(
        'Several methods such as bandit have been suggested for detecting suspicious packages.',
        'Several methods such as bandit have been proposed for detecting suspicious packages.',
        'en',
      ),
    ).toEqual([]);
    expect(
      issues(
        'Moreover, a few of metadata-related features are explored in this context.',
        'In addition, some metadata-related features were examined in this context.',
        'en',
      ),
    ).toEqual([]);
    expect(
      issues(
        'It is impractical, even infeasible, to manually extract information at this scale.',
        'Manually extracting information at this scale is impractical, even impossible.',
        'en',
      ),
    ).toEqual([]);
    expect(
      issues(
        'The package is missing license type uniformity in the three core positions.',
        'The package does not provide standardization of license types in the three main positions.',
        'en',
      ),
    ).toEqual([]);
    // Too short to judge (headings, table cells).
    expect(issues('Not significant', 'Significant', 'en')).toEqual([]);
  });

  it('reads Turkish negation and hedging suffixes, not names or nouns', () => {
    expect(
      issues(
        'Bu sonuçlar yöntemin doğruluğu artırabileceğini göstermektedir.',
        'Bu sonuçlar yöntemin doğruluğu artırdığını göstermektedir.',
        'tr',
      ),
    ).toEqual(['major: hedging lost']);
    expect(
      issues(
        'Model 100 epoktan sonra bile yakınsamadı.',
        'Model 100 epoktan sonra bile yakınsadı.',
        'tr',
      ),
    ).toEqual(['major: negation lost']);
    expect(
      issues(
        'Yılmaz ve arkadaşları bu denemede yeni bir yöntem önerdi.',
        'Yılmaz ve arkadaşları bu denemede yeni bir yöntem önerdi.',
        'tr',
      ),
    ).toEqual([]);
  });

  it('French: an expletive "ne" and "faute de" or "ignorer" for "ne pas" are no difference', () => {
    expect(
      issues(
        "Ainsi, avant qu'un projet de délibération ne soit proposé au vote du Conseil de Paris, il doit être approuvé par la présidente.",
        "Par conséquent, pour qu'une proposition soit soumise au vote du Conseil de Paris, elle doit être approuvée par la présidente.",
        'fr',
      ),
    ).toEqual([]);
    expect(
      issues(
        'Or, le Conseil de Paris a décidé de ne pas en tenir compte, ce qui ralentirait encore plus la production.',
        "Cependant, le Conseil de Paris a choisi de l'ignorer, ce qui ralentirait davantage la production.",
        'fr',
      ),
    ).toEqual([]);
    expect(
      issues(
        "En effet, dès lors que chaque détail de la dimension qualitative n'est pas surveillé, les rues sont moins importantes.",
        "En effet, faute d'une prise en compte de tous les aspects qualitatifs, les rues sont moins visibles.",
        'fr',
      ),
    ).toEqual([]);
    // "publique ne se limite pas" after "plus" is a negation: no "que", "pas" three words on.
    expect(
      issues(
        'Comme le soulignent de plus en plus de publications, la commémoration publique ne se limite pas au passé.',
        'Comme le montrent de plus en plus de publications, la commémoration publique concerne le passé.',
        'fr',
      ),
    ).toEqual(['major: negation lost']);
    // "ne … pas" after "avant que" is still a negation.
    expect(
      issues(
        'Avant que le projet soit voté, le texte ne doit pas être publié par la commission.',
        'Avant que le projet soit voté, le texte doit être publié par la commission.',
        'fr',
      ),
    ).toEqual(['major: negation lost']);
  });

  it('an English quotation in a French paper is read with English cues', () => {
    expect(
      issues(
        '« Public commemoration is not simply about determining the appropriateness of remembering the past in a certain way; it is also a struggle over where best to locate that memory. »',
        '« La commémoration publique ne se limite pas à déterminer la pertinence d’une manière particulière de se souvenir du passé ; elle constitue également un débat sur la place de cette mémoire. »',
        'fr',
      ),
    ).toEqual([]);
  });

  it('Turkish: a negated verbal noun is a negation, "allows" keeps a possibility', () => {
    expect(
      issues(
        'Katılımcının yeterli düzeyde bilgi vermemesi durumunda alternatif sorular hazırlanmalıdır.',
        'Katılımcı yeterli bilgi vermezse alternatif sorular hazırlanmalıdır.',
        'tr',
      ),
    ).toEqual([]);
    expect(
      issues(
        'Bu aşamada araştırmacı kendi görüşlerine yer vermez.',
        'Bu aşama, araştırmacının kendi görüşlerini dahil etmemesini içerir.',
        'tr',
      ),
    ).toEqual([]);
    expect(
      issues(
        'Çoklu bakış açısıyla daha keskin ölçümler yapılabileceğini bildirmektedir.',
        'Çoklu bakış açılarının daha hassas ölçümlere olanak sağladığını belirtmektedir.',
        'tr',
      ),
    ).toEqual([]);
    expect(
      issues(
        'Küçük gruplardan genelleme yapılması doğru değildir.',
        'Küçük gruplardan genelleme yapmak yanlıştır.',
        'tr',
      ),
    ).toEqual([]);
    expect(
      issues(
        'İncelenen olguya esas oluşturabilecek bir kuramın olmaması durumunda içerik analizi gereklidir.',
        'İncelenen olgunun temelini oluşturabilecek bir teorinin yokluğunda içerik analizi gereklidir.',
        'tr',
      ),
    ).toEqual([]);
    // "tamamen" (completely) is no negation.
    expect(
      issues(
        'Bu çalışmanın bulguları önceki araştırmalarla tamamen tutarlıdır.',
        'Bu çalışmanın bulguları önceki araştırmalarla tamamen tutarlı değildir.',
        'tr',
      ),
    ).toEqual(['major: negation added']);
  });

  it('Turkish: "-ebilmesi için" (in order to) and "-ebilecek" before a noun are no hedges', () => {
    expect(
      issues(
        'Ancak bir araştırmanın geçerli olabilmesi için öncelikle güvenilir olması gereklidir.',
        'Bununla birlikte, bir araştırmanın geçerli olması için öncelikle güvenilir olması gerekir.',
        'tr',
      ),
    ).toEqual([]);
    expect(
      issues(
        'Bu tip sorular, anlaşılmayan bir noktayı onaylamak için sorulabilecek sorulardır.',
        'Bu tür sorular, anlaşılmayan bir noktayı doğrulamak için kullanılır.',
        'tr',
      ),
    ).toEqual([]);
    // A possibility the source states is still one.
    expect(
      issues(
        'Bu sonuç örneklemden kaynaklanıyor olabilir.',
        'Bu sonuç örneklemden kaynaklanıyor.',
        'tr',
      ),
    ).toEqual(['major: hedging lost']);
  });

  it('Turkish: words that only begin like a quantifier, and litotes, are not cues', () => {
    // "tümce" is a sentence, "tamamlanmıştır" is "was completed": no "all" to lose.
    expect(
      issues(
        '18.640 tümce iki uzman tarafından incelenmiş ve çalışma tamamlanmıştır.',
        '18.640 cümle iki uzman tarafından incelendi ve çalışma bitirildi.',
        'tr',
      ),
    ).toEqual([]);
    expect(
      issues(
        'Tüm örneklerde belirgin bir etki görülmüştür.',
        'Örneklerin çoğunda belirgin bir etki görülmüştür.',
        'tr',
      ),
    ).toEqual(['major: quantifier changed']);
    // "azımsanmayacak sıklıkta" (not negligibly often) is "quite often".
    expect(
      issues(
        'Anlam kaymaları azımsanmayacak sıklıkta görülmektedir.',
        'Anlam kaymaları sıklıkla görülmektedir.',
        'tr',
      ),
    ).toEqual([]);
  });

  it('compares long paragraphs sentence by sentence and names the sentence', () => {
    const source =
      'We trained the model on all data. The results suggest that it generalises. It did not overfit.';
    const back =
      'We trained the model on all data. The results show that it generalises. It did not overfit.';
    expect(compareMeaning(source, back, 'en')).toEqual([
      {
        issue: 'hedging lost: the claim may read stronger than in the source',
        severity: 'major',
        sentence: 'The results show that it generalises.',
      },
    ]);
    // A hedge the back-translation adds is paraphrase, not reported.
    expect(
      issues(
        'These goals would have been unattainable without their contributions.',
        'Without their contributions, these goals could not have been achieved.',
        'en',
      ),
    ).toEqual([]);
  });

  it('ignores limits, lexical negation and back-translations left untranslated', () => {
    expect(
      issues(
        'We show that the redundancy of the algorithm tends to zero as the trees grow large.',
        'We show that the redundancy of the algorithm approaches zero as the trees grow.',
        'en',
      ),
    ).toEqual([]);
    expect(
      issues(
        'The Kolmogorov complexity of a string is incomputable, but upper bounds can be found.',
        'The Kolmogorov complexity of a string cannot be calculated, but upper bounds can be found.',
        'en',
      ),
    ).toEqual([]);
    expect(
      issues(
        'Meaning, we can guess whether an edge exists or not from the other edges.',
        'That is, we can predict the existence of an edge from the other edges.',
        'en',
      ),
    ).toEqual([]);
    expect(
      issues(
        'The proposed method not only improves the performance by itself, but also adds benefits.',
        'The proposed method improves the performance on its own and also adds benefits.',
        'en',
      ),
    ).toEqual([]);
    expect(
      issues(
        'We also test the model on a set of benign packages that are also not popular.',
        'We also test the model on a set of unpopular benign packages.',
        'en',
      ),
    ).toEqual([]);
    expect(
      backTranslationFindings(
        [
          {
            id: 'x',
            source: 'The method is not reliable in all of these cases at all.',
            target: '…',
          },
        ],
        ['Bu yöntem bu durumların hepsinde güvenilirdir ve çok iyidir.'],
        'en',
        'tr',
      ),
    ).toEqual([]);
  });

  it('Turkish: capitalised negation, "yok etmek", "yerine" and ability are understood', () => {
    expect(
      issues(
        'Sığmayan modeller için dış bir API kullanılır.',
        'Uygun olmayan modeller için harici bir API kullanılır.',
        'tr',
      ),
    ).toEqual([]);
    expect(
      issues(
        'Bu ortalamalar tek satırın sinyalini binlerce satır içinde boğuyor.',
        'Bu ortalamalar tek bir satırın sinyalini binlerce satır içinde yok eder.',
        'tr',
      ),
    ).toEqual([]);
    expect(
      issues(
        'Bu araç engelleyici değil, önceliklendirici olarak kullanılmalıdır.',
        'Bu araç engellemek yerine önceliklendirmek için kullanılmalıdır.',
        'tr',
      ),
    ).toEqual([]);
    expect(
      issues(
        'Yöntem yalnızca JavaScript ve Python için kolayca uygulanabilen bir yaklaşımdır.',
        'Yöntem yalnızca JavaScript ve Python için kolayca uygulanan bir yaklaşımdır.',
        'tr',
      ),
    ).toEqual([]);
    expect(
      issues(
        'Bu sonuç modelin aşırı öğrenme yapmış olabileceğini gösteriyor.',
        'Bu sonuç modelin aşırı öğrenme yaptığını gösteriyor.',
        'tr',
      ),
    ).toEqual(['major: hedging lost']);
  });

  it('attaches the back-translation to each finding', () => {
    const findings = backTranslationFindings(
      [{ id: 's1', source: 'The effect was <t1>not</t1> significant in ⟦F1⟧ cases.', target: '…' }],
      ['The effect was significant in these cases.'],
      'en',
      'tr',
    );
    expect(findings).toEqual([
      {
        id: 's1',
        issue: 'negation lost',
        severity: 'major',
        backTranslation: 'The effect was significant in these cases.',
      },
    ]);
  });

  it('reads hedges and quantifiers in other source languages', () => {
    expect(
      issues(
        'Die Ergebnisse deuten darauf hin, dass die Methode die Genauigkeit verbessern könnte.',
        'Die Ergebnisse zeigen, dass die Methode die Genauigkeit verbessert.',
        'de',
      ),
    ).toEqual(['major: hedging lost']);
    expect(
      issues(
        'La plupart des patients ont répondu au traitement après deux semaines.',
        'Tous les patients ont répondu au traitement après deux semaines.',
        'fr',
      ),
    ).toEqual(['major: quantifier changed']);
    expect(
      issues(
        'Полученные данные, по-видимому, подтверждают гипотезу о влиянии температуры.',
        'Полученные данные подтверждают гипотезу о влиянии температуры.',
        'ru',
      ),
    ).toEqual(['major: hedging lost']);
    expect(
      issues(
        'Model nie osiągnął zbieżności po stu epokach uczenia.',
        'Model osiągnął zbieżność po stu epokach uczenia.',
        'pl',
      ),
    ).toEqual(['major: negation lost']);
    // A hedge kept in other words is not a finding.
    expect(
      issues(
        'Los resultados sugieren que el método podría mejorar la precisión.',
        'Los resultados indican que el método puede mejorar la precisión.',
        'es',
      ),
    ).toEqual([]);
  });

  it('does not take helium, "whether or not" or non- compounds for negation', () => {
    expect(
      issues(
        'Пациентам назначали t-Не/O2 20 мин/сут с индивидуальным подбором концентрации Не и О2.',
        'Пациентам назначали t-He/O2 20 мин/день с индивидуальным подбором концентраций He и O2.',
        'ru',
      ),
    ).toEqual([]);
    expect(
      issues(
        'Er werd gevraagd of de hond al dan niet bekend was bij het slachtoffer.',
        'Er werd gevraagd of de hond bekend was bij het slachtoffer.',
        'nl',
      ),
    ).toEqual([]);
    expect(
      issues(
        'De meeste incidenten vonden plaats op niet-openbare locaties in de provincie.',
        'De meeste incidenten vonden plaats op privélocaties in de provincie.',
        'nl',
      ),
    ).toEqual([]);
    expect(
      issues(
        'Patiënten zonder geldig antwoord werden uitgesloten van deze analyse.',
        'Patiënten zonder geldig antwoord werden niet meegenomen in deze analyse.',
        'nl',
      ),
    ).toEqual([]);
    // Non-governmental organisations, as a back-translation calls them civil society.
    expect(
      issues(
        'Vennero avviate le prime consultazioni con le organizzazioni non governative.',
        'Sono state avviate le prime consultazioni con le organizzazioni della società civile.',
        'it',
      ),
    ).toEqual([]);
    expect(
      issues(
        'Trabajamos con organizaciones no gubernamentales de la región.',
        'Trabajamos con organizaciones de la sociedad civil de la región.',
        'es',
      ),
    ).toEqual([]);
    // "Sin embargo" is "however".
    expect(
      issues(
        'Pero, debido a sus fundamentos distintos, a menudo surgen confusiones.',
        'Sin embargo, debido a sus fundamentos distintos, a menudo surgen confusiones.',
        'es',
      ),
    ).toEqual([]);
  });

  it('skips passages of the source that are already in the target language', () => {
    const pairs = [
      {
        id: 'a',
        source: 'Dogs have been part of families for centuries, but bites are not rare.',
        target: 'x',
      },
    ];
    expect(
      backTranslationFindings(
        pairs,
        ['Honden zijn al eeuwen deel van gezinnen en beten komen voor.'],
        'nl',
        'en',
      ),
    ).toEqual([]);
  });

  it('takes fused negation and "above all" for what they are', () => {
    expect(
      issues(
        'Mimo powszechnego używania terminu fake news nie jest on jednoznaczny pojęciowo.',
        'Pomimo powszechnego użycia terminu fake news jest on niejednoznaczny pojęciowo.',
        'pl',
      ),
    ).toEqual([]);
    expect(
      issues(
        'Analiza opiera się głównie na raportach Komisji Europejskiej z lat 2017–2019.',
        'Analiza opiera się przede wszystkim na raportach Komisji Europejskiej z lat 2017–2019.',
        'pl',
      ),
    ).toEqual([]);
  });

  it('reads French negation with "n’" and leaves "ne … que" (only) alone', () => {
    expect(
      issues(
        'Cette méthode n’est pas adaptée aux grandes cartes inconnues.',
        'Cette méthode est adaptée aux grandes cartes inconnues.',
        'fr',
      ),
    ).toEqual(['major: negation lost']);
    expect(
      issues(
        'La dispersion des robots ne repose que sur le choix d’une cible lointaine.',
        'La dispersion des robots repose uniquement sur le choix d’une cible lointaine.',
        'fr',
      ),
    ).toEqual([]);
  });
});
