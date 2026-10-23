// Regenerates the synthetic test corpus under tests/corpus/.
// Generators are registered here as they land (DOCX in Phase 2, PDF/LaTeX in Phase 3).
const generators = [];

if (generators.length === 0) {
  console.log('fixtures: no generators registered yet — nothing to do.');
}
for (const gen of generators) {
  await gen();
}
