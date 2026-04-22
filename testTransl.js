import { translateFields, translateToTelugu } from './services/geminiTranslator.js';

async function run() {
  console.log('--- Test 1: translateToTelugu ---');
  const single = await translateToTelugu('Holiday Alert');
  console.log('Single:', single);

  console.log('\n--- Test 2: translateFields ---');
  const multi = await translateFields({ title: 'Holiday Alert', content: 'School will be closed tomorrow for Ugadi festival' });
  console.log('Multi:', multi);

  process.exit(0);
}
run();
