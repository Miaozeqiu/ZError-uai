import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import Ajv from 'ajv'
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core'
import variant from '@jitl/quickjs-wasmfile-release-sync'

const artifact = JSON.parse(await readFile(new URL('../dist/runtime.json', import.meta.url), 'utf8'))
const quickjs = await newQuickJSWASMModuleFromVariant(variant)
const ajv = new Ajv({ allErrors: true, strict: false })
const doc = { frameId: 'frame', loaderId: 'loader', url: 'https://uai.unipus.cn/' }

async function execute({ args = {}, documents = [doc], query = () => ({ ok: true, nodes: [], total: 0, truncated: false }), tool = 'inspect' } = {}) {
  const spec = artifact.tools.find(item => item.name === 'inspect')
  assert(ajv.validate(spec.parameters, args), JSON.stringify(ajv.errors))
  const runtime = quickjs.newRuntime(), context = runtime.newContext(), calls = []
  runtime.setMemoryLimit(8 * 1024 * 1024)
  let deadline = 0
  runtime.setInterruptHandler(() => performance.now() > deadline)
  const evaluate = code => {
    deadline = performance.now() + 500
    const result = context.evalCode(code)
    if (result.error) {
      const error = context.dump(result.error)
      result.error.dispose()
      throw new Error(error.message || JSON.stringify(error))
    }
    try { return JSON.parse(context.getString(result.value)) } finally { result.value.dispose() }
  }
  try {
    evaluate(artifact.bundle.code + ';const task=ZErrorSitePackage.create(' + JSON.stringify({ tool, args }) + ');JSON.stringify(true)')
    let receipt = null
    for (let index = 0; index < 16; index++) {
      const step = evaluate('JSON.stringify(task.next(' + JSON.stringify(receipt) + '))')
      if (step.done) {
        assert(ajv.validate(spec.result, step.value), JSON.stringify(ajv.errors))
        return { result: step.value, calls }
      }
      assert(spec.commands.includes(step.value.op), '命令必须在编译产物中声明')
      calls.push(step.value)
      receipt = step.value.op === 'document.list' ? { ok: true, documents } : await query(step.value.args)
    }
    assert.fail('命令数超限')
  } finally { context.dispose(); runtime.dispose() }
}

test('编译产物具有完整哈希、受限命令与可校验 schema', () => {
  assert.equal(artifact.apiVersion, 2)
  assert.equal(artifact.bundle.sha256, createHash('sha256').update(artifact.bundle.code).digest('hex'))
  assert(Buffer.byteLength(artifact.bundle.code) < 256 * 1024)
  assert.deepEqual(artifact.tools[0].commands, ['document.list', 'document.query'])
  assert(!ajv.validate(artifact.tools[0].parameters, { limit: 25 }))
  assert(!ajv.validate(artifact.tools[0].parameters, { password: 'must-not-accept' }))
})

test('QuickJS 读取有界页面，不返回输入值或猜测登录完成', async () => {
  const { result, calls } = await execute({ args: { limit: 2, offset: 3 }, query: args => {
    assert.deepEqual(args.document, doc)
    assert.equal(args.limit, 2); assert.equal(args.offset, 3)
    assert(!/input|textarea/.test(args.selector))
    return { ok: true, nodes: [
      { tag: 'h1', text: ' U校园   AI 版 ', visible: true, selector: 'h1', value: 'private-fixture' },
      { tag: 'button', text: '登录', visible: true, selector: 'button' },
    ], total: 8, truncated: true }
  } })
  assert.equal(result.status, 'observed')
  assert.equal(result.pages[0].items[0].text, 'U校园 AI 版')
  assert.equal(result.pages[0].truncated, true)
  assert.equal(calls.length, 2)
  assert(!JSON.stringify(result).includes('private-fixture'))
  assert(!Object.hasOwn(result, 'loggedIn'))
})

test('非授权域文档不触发 DOM 读取', async () => {
  for (const url of ['https://u.unipus.cn/', 'https://uai.unipus.cn.evil.example/', 'http://uai.unipus.cn/', 'https://uai.unipus.cn:8443/']) {
    await assert.rejects(execute({ documents: [{ ...doc, url }], query: () => assert.fail('不应读取其他域') }), /没有.*授权页面/)
  }
})

test('最多读取四个授权文档，隐藏节点不会成为操作建议', async () => {
  const { result, calls } = await execute({ documents: Array.from({ length: 7 }, (_, index) => ({ ...doc, frameId: String(index) })), query: () => ({
    ok: true, nodes: [{ tag: 'button', text: '隐藏提交', visible: false, selector: 'button' }], total: 1, truncated: false,
  }) })
  assert.equal(result.pages.length, 4)
  assert.equal(calls.length, 5)
  assert(result.pages.every(page => !page.items.length))
})

test('宿主拒绝读取时立即失败，不把错误当作空页面成功', async () => {
  await assert.rejects(execute({ query: () => ({ ok: false, denied: true }) }), /读取.*失败/)
})

test('未发布的工具不能绕过命令声明执行', async () => {
  await assert.rejects(execute({ tool: 'login' }), /未知.*工具/)
})
