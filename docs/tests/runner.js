import { run } from './tests.js';

const list = document.getElementById('results');
const summary = document.getElementById('summary');

const { total, failed } = await run((pass, name, msg) => {
  const li = document.createElement('li');
  li.className = pass ? 'pass' : 'fail';
  li.textContent = `${pass ? '✓' : '✗'} ${name}${msg ? ` — ${msg}` : ''}`;
  list.append(li);
});
summary.textContent = `${total - failed}/${total} passed`;
summary.className = failed ? 'fail' : 'pass';
