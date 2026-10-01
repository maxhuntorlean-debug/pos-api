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

const salesJournal = new Hono<{
  Bindings: Bindings
  Variables: Variables
}>()


// ======================================================
// SALES JOURNAL
// ======================================================

salesJournal.get('/', authMiddleware, async (c) => {
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
          message: 'Некорректный период журнала',
        },
      },
      400
    )
  }

  try {
    const result = await c.env.DB
      .prepare(`
        SELECT
          id,
          sale_date,
          sale_time,
          sum
        FROM sales
        WHERE sale_date BETWEEN ? AND ?
        ORDER BY
          sale_date DESC,
          sale_time DESC,
          id DESC
      `)
      .bind(from, to)
      .all()

    return c.json({
      success: true,
      data: result.results,
    })
  } catch (error) {
    console.error('Sales journal load failed', error)

    return c.json(
      {
        success: false,
        error: {
          message: 'Ошибка загрузки журнала продаж',
        },
      },
      500
    )
  }
})

export default salesJournal