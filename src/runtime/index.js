const allowed = url => /^https:\/\/uai\.unipus\.cn(?:\/|$)/.test(String(url || ''))
const clean = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 240)

function* command(op, args = {}) {
  const receipt = yield { op, args }
  if (!receipt || receipt.ok === false || receipt.error || receipt.denied) {
    throw new Error('读取 U校园页面失败，请根据宿主回执处理后重新观察')
  }
  return receipt
}

export function* create({ tool, args = {} }) {
  if (tool !== 'inspect') throw new Error('未知 U校园工具')
  const limit = args.limit ?? 12, offset = args.offset ?? 0
  if (!Number.isInteger(limit) || limit < 1 || limit > 24 || !Number.isInteger(offset) || offset < 0 || offset > 10000) {
    throw new Error('页面读取范围无效')
  }
  const listed = yield* command('document.list')
  const documents = (listed.documents || []).filter(document => allowed(document.url)).slice(0, 4)
  if (!documents.length) throw new Error('当前没有 U校园 AI 版授权页面，请先打开官网')
  const pages = []
  for (const document of documents) {
    const result = yield* command('document.query', {
      document, selector: 'title,h1,h2,h3,a[href],[role="tab"],button', limit, offset,
    })
    const items = (result.nodes || []).slice(0, limit)
      .filter(node => (node.visible || node.tag === 'title') && clean(node.text))
      .map(node => ({ tag: clean(node.tag), text: clean(node.text), selector: String(node.selector || '').slice(0, 1024) }))
    pages.push({ url: document.url, items, total: result.total, truncated: Boolean(result.truncated) })
  }
  return { status: 'observed', message: '已读取当前页面；请结合用户目标和真实控件继续操作。', pages }
}
