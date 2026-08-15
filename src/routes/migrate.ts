import { Hono } from 'hono'

const migrate = new Hono<{ Bindings: { DB: D1Database; OLD_DB: D1Database } }>()

migrate.post('/products', async (c) => {
  let offset = 0
  const batchSize = 500
  let copied = 0

  while (true) {
    const rows = await c.env.OLD_DB
      .prepare('SELECT barcode, name, buy_price, sell_price, created_at FROM products LIMIT ? OFFSET ?')
      .bind(batchSize, offset)
      .all()

    if (!rows.results.length) break

    for (const product of rows.results as any[]) {
      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO products
        (barcode, name, buy_price, sell_price, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(
        product.barcode,
        product.name,
        product.buy_price,
        product.sell_price,
        product.created_at
      ).run()
      copied++
    }

    offset += batchSize
  }

  return c.json({ ok: true, copied })
})

export default migrate
