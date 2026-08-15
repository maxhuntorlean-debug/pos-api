import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'
import { requirePermission } from '../middleware/permission'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; name: string; username: string; role: string } }
type SaleItem = { barcode: number; name: string; buy_price: number; sell_price: number }

const sales = new Hono<{ Bindings: Bindings; Variables: Variables }>()

sales.get('/', authMiddleware, requirePermission('journal.read'), async (c) => {
  const from = String(c.req.query('from') ?? '').trim()
  const to = String(c.req.query('to') ?? '').trim()

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return c.json({ success: false, error: { message: 'Некорректный период журнала' } }, 400)
  }

  try {
    const result = await c.env.DB.prepare(`
      SELECT id, sale_date, sale_time, sum
      FROM sales
      WHERE sale_date BETWEEN ? AND ?
      ORDER BY sale_date DESC, sale_time DESC, id DESC
    `).bind(from, to).all()

    return c.json({ success: true, data: result.results })
  } catch (error) {
    console.error('Sales journal load failed', error)
    return c.json({ success: false, error: { message: 'Ошибка загрузки журнала продаж' } }, 500)
  }
})

sales.post('/', authMiddleware, async (c) => {
  try {
    const user = c.get('user')
    const body = await c.req.json<{ sale_date?: string; sale_time?: string; items?: SaleItem[] }>()
    const saleDate = String(body.sale_date ?? '').trim()
    const saleTime = String(body.sale_time ?? '').trim()
    const items = Array.isArray(body.items) ? body.items : []

    if (!saleDate || !saleTime || items.length === 0) {
      return c.json({ success: false, error: { message: 'Некорректные данные продажи' } }, 400)
    }

    const normalized = items.map((item) => ({ barcode: Number(item.barcode), name: String(item.name ?? '').trim(), buy_price: Number(item.buy_price), sell_price: Number(item.sell_price) }))
    if (normalized.some((item) => !Number.isFinite(item.barcode) || !item.name || !Number.isFinite(item.buy_price) || !Number.isFinite(item.sell_price) || item.sell_price <= 0)) {
      return c.json({ success: false, error: { message: 'Некорректная позиция продажи' } }, 400)
    }

    const sum = normalized.reduce((total, item) => total + item.sell_price, 0)
    const saleResult = await c.env.DB.prepare(`INSERT INTO sales (sale_date, sale_time, sum, user_id) VALUES (?, ?, ?, ?)`).bind(saleDate, saleTime, sum, user.id).run()
    const saleId = Number(saleResult.meta.last_row_id)

    try {
      await c.env.DB.batch(normalized.map((item) => c.env.DB.prepare(`INSERT INTO sale_items (sale_id, barcode, name, buy_price, sell_price) VALUES (?, ?, ?, ?, ?)`).bind(saleId, item.barcode, item.name, item.buy_price, item.sell_price)))
    } catch (error) {
      await c.env.DB.prepare('DELETE FROM sales WHERE id = ?').bind(saleId).run()
      throw error
    }

    return c.json({ success: true, data: { id: saleId, sum } }, 201)
  } catch (error) {
    console.error('Sale creation failed', error)
    return c.json({ success: false, error: { message: 'Ошибка сохранения продажи' } }, 500)
  }
})

export default sales
