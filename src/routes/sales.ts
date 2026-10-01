import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'
import { writeEvent } from '../lib/eventLog'


// ======================================================
// TYPES
// ======================================================

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

type SaleItem = {
  barcode: number
  name: string
  buy_price: number
  sell_price: number
}


// ======================================================
// ROUTER
// ======================================================

const sales = new Hono<{
  Bindings: Bindings
  Variables: Variables
}>()


// ======================================================
// GET SALE DOCUMENT
// GET /api/sales/:id
// ======================================================

sales.get('/:id', authMiddleware, async (c) => {
  const id = Number(c.req.param('id'))

  if (!Number.isInteger(id) || id <= 0) {
    return c.json(
      {
        success: false,
        error: {
          message: 'Некорректный номер документа',
        },
      },
      400
    )
  }

  try {

    // --------------------------------------------------
    // SALE HEADER
    // --------------------------------------------------

    const sale = await c.env.DB
      .prepare(`
        SELECT
          id,
          sale_date,
          sale_time,
          sum,
          user_id
        FROM sales
        WHERE id = ?
        LIMIT 1
      `)
      .bind(id)
      .first()

    if (!sale) {
      return c.json(
        {
          success: false,
          error: {
            message: 'Документ не найден',
          },
        },
        404
      )
    }


    // --------------------------------------------------
    // SALE ITEMS
    // --------------------------------------------------

    const items = await c.env.DB
      .prepare(`
        SELECT
          id,
          barcode,
          name,
          buy_price,
          sell_price
        FROM sale_items
        WHERE sale_id = ?
        ORDER BY id ASC
      `)
      .bind(id)
      .all()


    // --------------------------------------------------
    // RESPONSE
    // --------------------------------------------------

    return c.json({
      success: true,
      data: {
        ...sale,
        items: items.results,
      },
    })

  } catch (error) {

    console.error(
      'Sale document load failed',
      error
    )

    return c.json(
      {
        success: false,
        error: {
          message: 'Ошибка загрузки документа',
        },
      },
      500
    )
  }
})


// ======================================================
// CREATE SALE
// POST /api/sales
// ======================================================

sales.post('/', authMiddleware, async (c) => {
  try {

    // --------------------------------------------------
    // USER
    // --------------------------------------------------

    const user = c.get('user')


    // --------------------------------------------------
    // BODY
    // --------------------------------------------------

    const body = await c.req.json<{
      sale_date?: string
      sale_time?: string
      items?: SaleItem[]
    }>()

    const saleDate =
      String(body.sale_date ?? '').trim()

    const saleTime =
      String(body.sale_time ?? '').trim()

    const items =
      Array.isArray(body.items)
        ? body.items
        : []


    // --------------------------------------------------
    // VALIDATE DOCUMENT
    // --------------------------------------------------

    if (
      !saleDate ||
      !saleTime ||
      items.length === 0
    ) {
      return c.json(
        {
          success: false,
          error: {
            message: 'Некорректные данные продажи',
          },
        },
        400
      )
    }


    // --------------------------------------------------
    // NORMALIZE ITEMS
    // --------------------------------------------------

    const normalized = items.map(
      (item) => ({
        barcode:
          Number(item.barcode),

        name:
          String(item.name ?? '').trim(),

        buy_price:
          Number(item.buy_price),

        sell_price:
          Number(item.sell_price),
      })
    )


    // --------------------------------------------------
    // VALIDATE ITEMS
    // --------------------------------------------------

    const hasInvalidItem =
      normalized.some(
        (item) =>
          !Number.isFinite(item.barcode) ||
          !item.name ||
          !Number.isFinite(item.buy_price) ||
          !Number.isFinite(item.sell_price) ||
          item.sell_price <= 0
      )

    if (hasInvalidItem) {
      return c.json(
        {
          success: false,
          error: {
            message: 'Некорректная позиция продажи',
          },
        },
        400
      )
    }


    // --------------------------------------------------
    // CALCULATE TOTAL
    // --------------------------------------------------

    const sum = normalized.reduce(
      (total, item) =>
        total + item.sell_price,
      0
    )


    // --------------------------------------------------
    // CREATE SALE HEADER
    // --------------------------------------------------

    const saleResult = await c.env.DB
      .prepare(`
        INSERT INTO sales (
          sale_date,
          sale_time,
          sum,
          user_id
        )
        VALUES (?, ?, ?, ?)
      `)
      .bind(
        saleDate,
        saleTime,
        sum,
        user.id
      )
      .run()

    const saleId =
      Number(
        saleResult.meta.last_row_id
      )


    // --------------------------------------------------
    // CREATE SALE ITEMS
    // --------------------------------------------------

    try {

      const statements =
        normalized.map((item) =>
          c.env.DB
            .prepare(`
              INSERT INTO sale_items (
                sale_id,
                barcode,
                name,
                buy_price,
                sell_price
              )
              VALUES (?, ?, ?, ?, ?)
            `)
            .bind(
              saleId,
              item.barcode,
              item.name,
              item.buy_price,
              item.sell_price
            )
        )

      await c.env.DB.batch(
        statements
      )

    } catch (error) {

      // Если позиции не записались,
      // удаляем созданную шапку документа.

      await c.env.DB
        .prepare(`
          DELETE FROM sales
          WHERE id = ?
        `)
        .bind(saleId)
        .run()

      throw error
    }


    // --------------------------------------------------
    // EVENT LOG
    // --------------------------------------------------

    await writeEvent(
      c.env.DB,
      user,
      'SALE_CREATE',
      [
        `sale_id=${saleId}`,
        `sum=${sum}`,
        `items=${normalized.length}`,
      ].join('; ')
    )


    // --------------------------------------------------
    // RESPONSE
    // --------------------------------------------------

    return c.json(
      {
        success: true,
        data: {
          id: saleId,
          sum,
        },
      },
      201
    )

  } catch (error) {

    console.error(
      'Sale creation failed',
      error
    )

    return c.json(
      {
        success: false,
        error: {
          message: 'Ошибка сохранения продажи',
        },
      },
      500
    )
  }
})


// ======================================================
// UPDATE SALE DOCUMENT
// PUT /api/sales/:id
// ======================================================

sales.put('/:id', authMiddleware, async (c) => {

  // ----------------------------------------------------
  // DOCUMENT ID
  // ----------------------------------------------------

  const id =
    Number(c.req.param('id'))

  if (
    !Number.isInteger(id) ||
    id <= 0
  ) {
    return c.json(
      {
        success: false,
        error: {
          message: 'Некорректный номер документа',
        },
      },
      400
    )
  }


  try {

    // --------------------------------------------------
    // USER
    // --------------------------------------------------

    const user = c.get('user')


    // --------------------------------------------------
    // BODY
    // --------------------------------------------------

    const body = await c.req.json<{
      items?: SaleItem[]
    }>()

    const items =
      Array.isArray(body.items)
        ? body.items
        : []


    // --------------------------------------------------
    // EMPTY DOCUMENT
    // --------------------------------------------------

    if (items.length === 0) {
      return c.json(
        {
          success: false,
          error: {
            message: 'Документ не может быть пустым',
          },
        },
        400
      )
    }


    // --------------------------------------------------
    // NORMALIZE ITEMS
    // --------------------------------------------------

    const normalized = items.map(
      (item) => ({
        barcode:
          Number(item.barcode),

        name:
          String(item.name ?? '').trim(),

        buy_price:
          Number(item.buy_price),

        sell_price:
          Number(item.sell_price),
      })
    )


    // --------------------------------------------------
    // VALIDATE ITEMS
    // --------------------------------------------------

    const hasInvalidItem =
      normalized.some(
        (item) =>
          !Number.isFinite(item.barcode) ||
          !item.name ||
          !Number.isFinite(item.buy_price) ||
          !Number.isFinite(item.sell_price) ||
          item.sell_price <= 0
      )

    if (hasInvalidItem) {
      return c.json(
        {
          success: false,
          error: {
            message: 'Некорректная позиция продажи',
          },
        },
        400
      )
    }


    // --------------------------------------------------
    // CHECK DOCUMENT
    // --------------------------------------------------

    const sale = await c.env.DB
      .prepare(`
        SELECT id
        FROM sales
        WHERE id = ?
        LIMIT 1
      `)
      .bind(id)
      .first()

    if (!sale) {
      return c.json(
        {
          success: false,
          error: {
            message: 'Документ не найден',
          },
        },
        404
      )
    }


    // --------------------------------------------------
    // CALCULATE NEW TOTAL
    // --------------------------------------------------

    const sum = normalized.reduce(
      (total, item) =>
        total + item.sell_price,
      0
    )


    // --------------------------------------------------
    // BUILD UPDATE BATCH
    // --------------------------------------------------

    const statements = [

      // Сумма документа

      c.env.DB
        .prepare(`
          UPDATE sales
          SET sum = ?
          WHERE id = ?
        `)
        .bind(
          sum,
          id
        ),


      // Удаляем старый состав

      c.env.DB
        .prepare(`
          DELETE FROM sale_items
          WHERE sale_id = ?
        `)
        .bind(id),


      // Записываем новый состав

      ...normalized.map(
        (item) =>
          c.env.DB
            .prepare(`
              INSERT INTO sale_items (
                sale_id,
                barcode,
                name,
                buy_price,
                sell_price
              )
              VALUES (?, ?, ?, ?, ?)
            `)
            .bind(
              id,
              item.barcode,
              item.name,
              item.buy_price,
              item.sell_price
            )
      ),
    ]


    // --------------------------------------------------
    // UPDATE DOCUMENT
    // --------------------------------------------------

    await c.env.DB.batch(
      statements
    )


    // --------------------------------------------------
    // EVENT LOG
    // --------------------------------------------------

    await writeEvent(
      c.env.DB,
      user,
      'SALE_UPDATE',
      [
        `sale_id=${id}`,
        `sum=${sum}`,
        `items=${normalized.length}`,
      ].join('; ')
    )


    // --------------------------------------------------
    // RESPONSE
    // --------------------------------------------------

    return c.json({
      success: true,
      data: {
        id,
        sum,
      },
    })

  } catch (error) {

    console.error(
      'Sale update failed',
      error
    )

    return c.json(
      {
        success: false,
        error: {
          message: 'Ошибка перезаписи документа',
        },
      },
      500
    )
  }
})


// ======================================================
// EXPORT
// ======================================================

export default sales