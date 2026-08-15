import { Hono } from 'hono'

const products = new Hono<{ Bindings: { DB: D1Database } }>()

products.get('/:barcode', async (c) => {
  const barcode = c.req.param('barcode').trim()

  if (!barcode) {
    return c.json({ success: false, error: { message: 'Не указан штрихкод' } }, 400)
  }

  try {
    const product = await c.env.DB
      .prepare(`
        SELECT barcode, name, buy_price, sell_price
        FROM products
        WHERE barcode = ?
        LIMIT 1
      `)
      .bind(barcode)
      .first()

    if (!product) {
      return c.json({ success: false, error: { message: 'Товар не найден' } }, 404)
    }

    return c.json({ success: true, data: product })
  } catch (error: any) {
    console.error('Product lookup failed', error)
    return c.json({ success: false, error: { message: 'Ошибка получения товара' } }, 500)
  }
})

export default products
