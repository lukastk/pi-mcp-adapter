// Runs real Pi 0.99 + adapter + stdio MCP + QuickJS, with a deterministic local
// model. No model credentials, browser, network requests, or user config needed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const here = path.dirname(fileURLToPath(import.meta.url));

if (!process.argv[2]) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-native-'));
  try {
    for (const mode of ['cold', 'warm', 'approval', 'idle']) {
      const env = { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), TMPDIR: home,
        PI_CODING_AGENT_DIR: path.join(home, '.pi/agent'), PI_OFFLINE: '1',
        PI_MCP_ADAPTER_TEST_AUTH_STORE: 'memory', PI_MCP_ADAPTER_DISABLE_AUTH_CACHE: '1' };
      const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), mode], { env, cwd: home, encoding: 'utf8', timeout: 60000 });
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      assert.equal(result.status, 0, `${mode}: ${result.error ?? result.signal ?? result.stderr}`);
    }
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
  console.log('PASS: cold/warm discovery, structured results, errors, large values, metadata privacy, native search, approvals, hooks, cancellation, withdrawal, idle reconnect');
  process.exit(0);
}

const mode = process.argv[2];
const sdk = await import('@earendil-works/pi-coding-agent');
const { createAssistantMessageEventStream } = await import('@earendil-works/pi-ai');
const agentDir = process.env.PI_CODING_AGENT_DIR;
fs.mkdirSync(agentDir, { recursive: true });
const log = path.join(process.env.HOME, 'fixture.jsonl');
function events() { return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s)) : []; }
const starts = () => events().filter(e => e.event === 'start').length;
const calls = name => events().filter(e => e.event === 'call' && e.name === name).length;
const countBefore = starts();
const config = {
  settings: { deferWithMissingMetadata: true, exposeResources: false, scriptMode: false },
  mcpServers: { audit: { command: 'python3', args: [path.join(here, 'native-fixture.py')],
    env: { AUDIT_LOG: log }, lifecycle: 'lazy', directTools: 'search',
    ...(mode === 'approval' ? { approveTools: true } : {}),
    ...(mode === 'idle' ? { idleTimeout: 0.001 } : {}) } },
};
fs.writeFileSync(path.join(agentDir, 'mcp-adapter.json'), JSON.stringify(config));
let pi;
let pending;
const toolEvents = [];
const modelExtension = api => {
  pi = api;
  api.on('tool_call', event => {
    toolEvents.push(event);
    if (event.toolName === 'audit_echo' && event.input.value === 'blocked') return { block: true, reason: 'audit permission gate' };
  });
  api.registerProvider('audit-local', {
    baseUrl: 'http://invalid.local', apiKey: 'local-test', api: 'openai-completions',
    models: [{ id: 'audit', name: 'Audit', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 8192 }],
    streamSimple(model) {
      const stream = createAssistantMessageEventStream();
      const call = pending; pending = undefined;
      const message = { role: 'assistant', content: call ? [{ type: 'toolCall', id: `audit-${toolEvents.length}`, ...call }] : [{ type: 'text', text: 'done' }],
        api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: call ? 'toolUse' : 'stop',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      stream.push({ type: 'done', reason: message.stopReason, message }); stream.end(); return stream;
    },
  });
};
const settingsManager = sdk.SettingsManager.inMemory({ defaultTools: ['+codemode', '+tool_search'], defaultProjectTrust: 'always' });
const resourceLoader = new sdk.DefaultResourceLoader({ cwd: process.env.HOME, agentDir, settingsManager,
  noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
  additionalExtensionPaths: [path.join(here, '../index.ts')],
  extensionFactories: [sdk.createCodemodeExtension(), sdk.createToolSearchExtension(), modelExtension],
  agentsFilesOverride: () => ({ agentsFiles: [] }),
});
await resourceLoader.reload();
assert.deepEqual(resourceLoader.getExtensions().errors, []);
const { session } = await sdk.createAgentSession({ cwd: process.env.HOME, agentDir, settingsManager, resourceLoader, sessionManager: sdk.SessionManager.inMemory(process.env.HOME) });
async function run(name, args) {
  pending = { name, arguments: args };
  const before = session.messages.length;
  await session.prompt('Run the next deterministic integration assertion.');
  const result = session.messages.slice(before).find(m => m.role === 'toolResult');
  assert(result, 'missing tool result');
  return result;
}
async function code(source, isError = false) {
  const result = await run('codemode', { code: source });
  assert.equal(result.isError, isError, JSON.stringify(result));
  return result;
}
async function until(condition) {
  for (let n = 0; n < 100; n++) {
    if (condition()) return;
    await new Promise(r => setTimeout(r, 50));
  }
  assert.fail('condition did not become true');
}
try {
  await session.bindExtensions({});
  await session.setModel(session.modelRuntime.getModel('audit-local', 'audit'));
  await new Promise(r => setTimeout(r, 100));
  assert.equal(starts(), countBefore, 'startup must not connect');
  await code('text(await searchTools("echo", {namespace:"mcp__audit"}));');
  assert.equal(starts(), countBefore, 'discovery must not connect');
  if (!pi.getAllTools().some(t => t.name === 'audit_echo')) {
    // With no cached catalog, explicit discovery connects once; no invented schemas.
    const connected = await run('mcp', { connect: 'audit' });
    assert.equal(connected.isError, false, JSON.stringify(connected));
  }
  await until(() => pi.getAllTools().some(t => t.name === 'audit_echo'));
  const echo = pi.getAllTools().find(t => t.name === 'audit_echo');
  assert.equal(echo.exposure, 'deferred');
  assert.equal(echo.annotations.readOnlyHint, true);
  assert(!pi.getActiveTools().includes('audit_echo'), 'deferred tool declared eagerly');

  if (mode === 'approval') {
    const before = calls('echo');
    await code('const r=await tools.audit_echo({value:"approval"}); if(r.isError!==true) throw Error("approval missing"); text("approval enforced");');
    assert.equal(calls('echo'), before);
  } else {
    await code('const r=await tools.audit_echo({value:"x".repeat(100000)}); if(r.structuredContent.value.length!==100000 || "_meta" in r) throw Error("lost/truncated/private result"); const e=await tools.audit_fail({}); if(e.isError!==true) throw Error("error lost"); text("structured pass");');
    assert(toolEvents.some(e => e.toolName === 'audit_echo' && e.parentToolCallId), 'nested hook missing parent id');
    const before = calls('echo');
    await code('try { await tools.audit_echo({value:"blocked"}); throw Error("gate bypassed"); } catch(e) { if(!String(e).includes("audit permission gate")) throw e; }');
    assert.equal(calls('echo'), before);

    if (mode === 'idle') {
      const connectedStarts = starts();
      const eofBefore = events().filter(e => e.event === 'eof').length;
      await new Promise(r => setTimeout(r, 31500)); // production health-check interval = 30s
      assert(events().filter(e => e.event === 'eof').length > eofBefore, 'idle transport not closed');
      await code('if(!(await searchTools("echo",{namespace:"mcp__audit"})).length) throw Error("catalog lost on idle");');
      assert.equal(starts(), connectedStarts, 'idle discovery reconnected');
      await code('const r=await tools.audit_echo({value:"reconnect"}); if(r.structuredContent.value!=="reconnect") throw Error("reconnect failed");');
      assert.equal(starts(), connectedStarts + 1, 'expected exactly one reconnect');
    } else {
      await code('// @options: {"timeout_ms": 100}\nawait tools.audit_slow({});', true);
      await until(() => events().some(e => e.event === 'notifications/cancelled'));
      await run('tool_search', { query: 'echo', namespace: 'mcp__audit' });
      assert(pi.getActiveTools().includes('audit_echo'), 'native tool_search did not activate');
      await code('text("next turn");');
      assert(pi.getActiveTools().includes('audit_echo'), 'adapter undid native activation');
      await code('await tools.audit_remove_echo({});');
      await until(() => pi.getAllTools().find(t => t.name === 'audit_echo')?.exposure === 'hidden');
      await code('if((await searchTools("echo",{namespace:"mcp__audit"})).some(t=>t.name==="audit_echo")) throw Error("withdrawn tool visible");');
      await code('await tools.audit_restore_echo({});');
      await until(() => pi.getAllTools().find(t => t.name === 'audit_echo')?.exposure === 'deferred');
      await code('const r=await tools.audit_echo({value:"restored"}); if(r.structuredContent.value!=="restored") throw Error("restore failed");');
    }
  }
  console.log(`PASS ${mode}: ${starts() - countBefore} fixture process(es)`);
} finally {
  await session.extensionRunner.emit({ type: 'session_shutdown' });
  session.dispose();
}
