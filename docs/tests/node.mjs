// Node runner for the same tests: `node docs/tests/node.mjs`
import { run } from './tests.js';

const { total, failed } = await run((pass, name, msg) => {
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${msg ? ` — ${msg}` : ''}`);
});
console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
