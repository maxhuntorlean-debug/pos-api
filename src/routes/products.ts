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


// ======================================================
// ROUTER
// ======================================================

const products = new Hono<{
  Bindings: Bindings
  Variables: Variables
}>()


// ======================================================
// CREATE PRODUCT
// POST /api/products
// ======================================================

products.post('/', authMiddleware, async (c) => {
  try {

    // --------------------------------------------------
    // USER
    // --------------------------------------------------

    const user = c.get('user')


    // --------------------------------------------------
    // BODY
    // --------------------------------------------------

    const body = await c.req.json<{
      name?: string
      buy_price?: number
      sell_price?: number
    }>()

    const name =
      String(body.name ?? '').trim()

    const buyPrice =
      Number(body.buy_price)

    const sellPrice =
      Number(body.sell_price)


    // --------------------------------------------------
    // VALIDATION
    // --------------------------------------------------

    if (!name) {
      return c.json(
        {
          success: false,
          error: {
            message: 'Не указано наименование товара',
          },
        },
        400
      )
    }


    if (
      !Number.isFinite(buyPrice) ||
      buyPrice <= 0
    ) {
      return c.json(
        {
          success: false,
          error: {
            message: 'Некорректная закупочная цена',
          },
        },
        400
      )
    }


    if (
      !Number.isFinite(sellPrice) ||
      sellPrice <= 0
    ) {
      return c.json(
        {
          success: false,
          error: {
            message: 'Некорректная цена продажи',
          },
        },
        400
      )
    }


    // --------------------------------------------------
    // CURRENT POSITION
    // --------------------------------------------------

    const sequence = await c.env.DB
      .prepare(`
        SELECT position
        FROM barcode_sequence
        WHERE id = 1
        LIMIT 1
      `)
      .first<{
        position: number
      }>()

    if (!sequence) {
      return c.json(
        {
          success: false,
          error: {
            message: 'Не настроен генератор штрихкодов',
          },
        },
        500
      )
    }


    const position =
      Number(sequence.position)


    // --------------------------------------------------
    // GET FREE BARCODE
    // --------------------------------------------------

    const freeBarcode = await c.env.DB
      .prepare(`
        SELECT barcode
        FROM free_barcodes
        WHERE id = ?
        LIMIT 1
      `)
      .bind(position)
      .first<{
        barcode: number
      }>()

    if (!freeBarcode) {
      return c.json(
        {
          success: false,
          error: {
            message: 'Свободные штрихкоды закончились',
          },
        },
        409
      )
    }


    const barcode =
      Number(freeBarcode.barcode)


    // --------------------------------------------------
    // SAFETY CHECK
    // --------------------------------------------------

    if (
      !Number.isInteger(barcode) ||
      barcode < 10000 ||
      barcode > 99999
    ) {
      throw new Error(
        `Invalid free barcode: ${barcode}`
      )
    }


    // --------------------------------------------------
    // CREATE PRODUCT + MOVE POINTER
    // --------------------------------------------------

    await c.env.DB.batch([

      // Создаём товар

      c.env.DB
        .prepare(`
          INSERT INTO products (
            barcode,
            name,
            buy_price,
            sell_price
          )
          VALUES (?, ?, ?, ?)
        `)
        .bind(
          barcode,
          name,
          buyPrice,
          sellPrice
        ),


      // Передвигаем указатель
      // на следующий свободный штрихкод

      c.env.DB
        .prepare(`
          UPDATE barcode_sequence
          SET position = position + 1
          WHERE id = 1
        `),
    ])


    // --------------------------------------------------
    // EVENT LOG
    // --------------------------------------------------

    await writeEvent(
      c.env.DB,
      user,
      'PRODUCT_CREATE',
      [
        `barcode=${barcode}`,
        `name=${name}`,
        `buy_price=${buyPrice}`,
        `sell_price=${sellPrice}`,
      ].join('; ')
    )


    // --------------------------------------------------
    // RESPONSE
    // --------------------------------------------------

    return c.json(
      {
        success: true,
        data: {
          barcode,
          name,
          buy_price: buyPrice,
          sell_price: sellPrice,
        },
      },
      201
    )

  } catch (error) {

    console.error(
      'Product creation failed',
      error
    )

    return c.json(
      {
        success: false,
        error: {
          message: 'Ошибка создания товара',
        },
      },
      500
    )
  }
})


// ======================================================
// GET PRODUCT
// GET /api/products/:barcode
// ======================================================

products.get('/:barcode', authMiddleware, async (c) => {

  const barcode =
    c.req.param('barcode').trim()


  // ----------------------------------------------------
  // VALIDATION
  // ----------------------------------------------------

  if (!barcode) {
    return c.json(
      {
        success: false,
        error: {
          message: 'Не указан штрихкод',
        },
      },
      400
    )
  }


  try {

    // --------------------------------------------------
    // PRODUCT
    // --------------------------------------------------

    const product = await c.env.DB
      .prepare(`
        SELECT
          barcode,
          name,
          buy_price,
          sell_price
        FROM products
        WHERE barcode = ?
        LIMIT 1
      `)
      .bind(barcode)
      .first()


    // --------------------------------------------------
    // NOT FOUND
    // --------------------------------------------------

    if (!product) {
      return c.json(
        {
          success: false,
          error: {
            message: 'Товар не найден',
          },
        },
        404
      )
    }


    // --------------------------------------------------
    // RESPONSE
    // --------------------------------------------------

    return c.json({
      success: true,
      data: product,
    })

  } catch (error) {

    console.error(
      'Product lookup failed',
      error
    )

    return c.json(
      {
        success: false,
        error: {
          message: 'Ошибка получения товара',
        },
      },
      500
    )
  }
})


// ======================================================
// EXPORT
// ======================================================

export default products