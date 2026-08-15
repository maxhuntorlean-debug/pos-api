import { Hono } from 'hono'

const migrate = new Hono<{ Bindings: { DB: D1Database; OLD_DB: D1Database } }>()

migrate.post('/products', async (c) => {
  let offset = 0
  const batchSize = 500
  let copied = 0

  try {
    while (true) {
      const rows = await c.env.OLD_DB
        .prepare('SELECT barcode, name, buy_price, sell_price, created_at FROM products LIMIT ? OFFSET ?')
        .bind(batchSize, offset)
        .all()

      if (!rows.results.length) break

      const statements = (rows.results as any[]).map((product) =>
        c.env.DB.prepare(`
          INSERT OR IGNORE INTO products
          (barcode, name, buy_price, sell_price, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).bind(
          product.barcode,
          product.name,
          product.buy_price,
          product.sell_price,
          product.created_at
        )
      )

      try {
        await c.env.DB.batch(statements)
      } catch (error: any) {
        return c.json({
          ok: false,
          offset,
          error: error?.message || String(error)
        }, 500)
      }

      copied += statements.length
      offset += batchSize
    }

    return c.json({ ok: true, copied })
  } catch (error: any) {
    return c.json({
      ok: false,
      error: error?.message || String(error)
    }, 500)
  }
})

export default migrate
