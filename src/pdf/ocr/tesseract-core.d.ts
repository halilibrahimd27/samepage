// Emscripten builds of Tesseract (tesseract.js-core) ship without type declarations; the parts
// used are typed in ./tesseract.ts.
declare module 'tesseract.js-core/tesseract-core-simd-lstm.js' {
  const factory: unknown;
  export default factory;
}
declare module 'tesseract.js-core/tesseract-core-lstm.js' {
  const factory: unknown;
  export default factory;
}
