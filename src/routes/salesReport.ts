import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'

type Bindings = {
  DB: D1Database
}

type Variables = {
  user: {
    id: number
    name: string
    username: string
    role: string
  }
}

const salesReport = new Hono<{
  Bindings: Bindings
  Variables: Variables
}>()


// ======================================================
// SALES REPORT
// ======================================================

salesReport.get('/', authMiddleware, async (c) => {
  const from = String(c.req.query('from') ?? '').trim()
  const to = String(c.req.query('to') ?? '').trim()

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
    from > to
  ) {
    return c.json(
      {
        success: false,
        error: {
          message: 'Некорректный период отчёта',
        },
      },
      400
    )
  }

  try {
    const result = await c.env.DB
      .prepare(`
        SELECT
          s.id AS doc,
          s.sale_date,
          s.sale_time,
          si.barcode,
          si.name,
          si.buy_price,
          si.sell_price
        FROM sales s
        JOIN sale_items si
          ON si.sale_id = s.id
        WHERE s.sale_date BETWEEN ? AND ?
        ORDER BY
          s.sale_date DESC,
          s.sale_time DESC,
          s.id DESC,
          si.id ASC
      `)
      .bind(from, to)
      .all()

    return c.json({
      success: true,
      data: result.results,
    })
  } catch (error) {
    console.error('Sales report load failed', error)

    return c.json(
      {
        success: false,
        error: {
          message: 'Ошибка загрузки отчёта продаж',
        },
      },
      500
    )
  }
})

export default salesReport