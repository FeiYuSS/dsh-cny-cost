/**
 * Static consistency checks for the published bundle. The package name appears
 * in three places that must agree (package.json, the cordis patch insert row,
 * and the browser module loader id), and a rename that misses one of them only
 * fails at install time — so CI checks them here instead.
 *
 * Usage: node scripts/check-package.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

const problems = [];
function check(name, fn) {
  try {
    fn();
    console.log('PASS  ' + name);
  } catch (error) {
    problems.push(name + ': ' + error.message);
    console.log('FAIL  ' + name + ': ' + error.message);
  }
}

const pkg = JSON.parse(read('package.json'));
const patchPath = pkg.dsh?.bundle?.patch ?? 'cordis.patch.yml';
const patch = read(patchPath);
const client = read('client.js');
const readme = read('README.md');

/** `owner/repo` from the package repository URL. */
function githubSlug() {
  const url = pkg.repository?.url ?? '';
  const match = /github\.com[/:]([^/]+)\/([^/#]+?)(?:\.git)?(?:#.*)?$/.exec(url);
  if (!match) throw new Error('repository.url is not a GitHub URL: ' + url);
  return match[1] + '/' + match[2];
}

check('name is a valid npm package name', () => {
  if (!/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(pkg.name)) throw new Error(pkg.name);
});

check('cordis patch inserts this package by name', () => {
  if (!new RegExp('name:\\s*' + pkg.name + '\\s*$', 'm').test(patch)) {
    throw new Error('no insert row named ' + pkg.name + ' in ' + patchPath);
  }
});

check('browser loader id equals the package name', () => {
  const match = /__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/.exec(client);
  if (!match) throw new Error('loader id not found in client.js');
  if (match[1] !== pkg.name) throw new Error(match[1] + ' !== ' + pkg.name);
});

check('bundle patch and client export exist', () => {
  if (!pkg.dsh?.bundle?.patch) throw new Error('dsh.bundle.patch is missing');
  if (!exists(pkg.dsh.bundle.patch)) throw new Error(pkg.dsh.bundle.patch + ' does not exist');
  if (!pkg.exports?.['./client']) throw new Error('exports["./client"] is missing');
});

check('every static export target exists', () => {
  for (const [key, target] of Object.entries(pkg.exports ?? {})) {
    const value = typeof target === 'string' ? target : target?.default;
    if (typeof value !== 'string' || value.includes('*')) continue;
    const relative = value.replace(/^\.\//, '');
    if (!exists(relative)) throw new Error(key + ' -> ' + value + ' does not exist');
  }
  if (pkg.icon && !exists(pkg.icon.replace(/^\.\//, ''))) throw new Error('icon does not exist: ' + pkg.icon);
  for (const locale of ['locale/en.json', 'locale/zh.json']) {
    JSON.parse(read(locale));
  }
});

check('dsh.client declares the services the client half uses', () => {
  const inject = pkg.dsh?.client?.inject ?? [];
  for (const module of ['@deepseek-ai/dsh-api-session-controller', '@deepseek-ai/dsh-client-locale']) {
    if (!inject.includes(module)) throw new Error('dsh.client.inject is missing ' + module);
  }
});

check('README documents the same GitHub install spec', () => {
  const spec = 'github:' + githubSlug();
  if (!readme.includes(spec)) throw new Error('README does not mention ' + spec);
});

check('README and package agree on the license', () => {
  if (pkg.license !== 'MIT') throw new Error('package license is ' + pkg.license);
  if (!/\[MIT\]\(\.\/LICENSE\)/.test(readme)) throw new Error('README does not link the MIT license');
});

console.log('');
if (problems.length === 0) {
  console.log('PACKAGE CHECK PASSED');
} else {
  console.log(problems.length + ' PACKAGE CHECK(S) FAILED');
  process.exitCode = 1;
}
