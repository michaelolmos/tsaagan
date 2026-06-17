// SDK surface tests — CI-safe, no browser. End-to-end browser coverage is done
// manually against a live daemon; here we assert the API shape and the no-daemon
// error paths (which never touch a browser).

import { test } from 'node:test';
import assert from 'node:assert';
import { Tsaagan, createTsaagan } from '../sdk/index.mjs';

const DEAD_PORT = 39899; // assumed not in use during tests

test('Tsaagan exposes the verify-first API surface', () => {
  const k = new Tsaagan({ port: DEAD_PORT, autoStart: false });
  const methods = [
    'status', 'snapshot', 'extract', 'consoleLog', 'network', 'recall',
    'goto', 'back', 'scroll', 'waitFor',
    'click', 'type', 'fillForm', 'select', 'press', 'assert', 'screenshot',
    'tabs', 'switchTab', 'newTab', 'closeTab', 'stop', 'raw', 'ready', 'alive', 'close',
  ];
  for (const m of methods) assert.equal(typeof k[m], 'function', `missing method ${m}`);
  assert.equal(typeof createTsaagan, 'function');
  assert.equal(k.port, DEAD_PORT);
});

test('alive() is false when no daemon is listening', async () => {
  const k = new Tsaagan({ port: DEAD_PORT, autoStart: false });
  assert.equal(await k.alive(), false);
});

test('ready() rejects when autoStart is off and no daemon is running', async () => {
  const k = new Tsaagan({ port: DEAD_PORT, autoStart: false });
  await assert.rejects(() => k.ready(), /no Tsaagan daemon/);
});
