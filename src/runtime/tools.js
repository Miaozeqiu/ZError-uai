const text = { type: 'string' }
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const array = (items, maxItems) => ({ type: 'array', items, maxItems })
const item = object({ tag: text, text, selector: text }, ['tag', 'text', 'selector'])
const page = object({ url: text, items: array(item, 24), total: { type: 'integer', minimum: 0 }, truncated: { type: 'boolean' } }, ['url', 'items', 'total', 'truncated'])

export const tools = [{
  name: 'inspect',
  description: '只读识别当前 U校园 AI 版网页中的标题、导航和按钮；每个授权文档最多 24 项、最多四个文档。不读取输入框值，不登录或提交，也不根据界面猜测任务完成。',
  parameters: object({ offset: { type: 'integer', minimum: 0, maximum: 10000 }, limit: { type: 'integer', minimum: 1, maximum: 24 } }),
  result: object({ status: { type: 'string', enum: ['observed'] }, message: text, pages: array(page, 4) }, ['status', 'message', 'pages']),
  commands: ['document.list', 'document.query'],
}]
