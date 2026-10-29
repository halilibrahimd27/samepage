/**
 * Software and ecosystem names that machine engines must neither translate nor re-case
 * ("Python" → "Piton", "npm" → "NPM", "Npm ve PyPI'de…" at a sentence start). They apply in
 * every language pair, whole word and case-sensitive, so the snake "python" in a biology paper
 * is left to the engine.
 *
 * Left out on purpose because the plain word is common in academic text: Go, R, C, Swift, Julia,
 * Spark (a verb), Rust (a plant disease), pip (a seed), Windows ("Time Windows" in a title-case heading), React and Composer
 * (sentence-initial verb / noun). "pandas" is lowercase only, as the library writes it.
 */
export const BUILT_IN_NAMES: readonly string[] = [
  // languages
  'Python',
  'JavaScript',
  'TypeScript',
  'Java',
  'Kotlin',
  'Scala',
  'Haskell',
  'Ruby',
  'PHP',
  'Perl',
  'MATLAB',
  'Fortran',
  'C++',
  'C#',
  // package managers and hosting
  'npm',
  'PyPI',
  'Maven',
  'NuGet',
  'RubyGems',
  'CRAN',
  'Conda',
  'GitHub',
  'GitLab',
  'Bitbucket',
  // platforms
  'Docker',
  'Kubernetes',
  'Linux',
  'Ubuntu',
  'macOS',
  'Android',
  'iOS',
  'Node.js',
  // libraries and models
  'TensorFlow',
  'PyTorch',
  'Keras',
  'scikit-learn',
  'XGBoost',
  'LightGBM',
  'CatBoost',
  'NumPy',
  'SciPy',
  'pandas',
  'Matplotlib',
  'Jupyter',
  'BERT',
  'RoBERTa',
  'GPT-3',
  'GPT-4',
  'ChatGPT',
  'LLaMA',
  'word2vec',
  // tools
  'LaTeX',
  'BibTeX',
  'Overleaf',
  'Zotero',
  'Mendeley',
  'SPSS',
  'Stata',
  'NVivo',
  'ImageJ',
  'Weka',
  'Excel',
];
