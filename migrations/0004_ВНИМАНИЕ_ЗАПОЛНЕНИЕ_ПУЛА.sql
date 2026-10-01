-- =====================================================
-- ЗАПОЛНЕНИЕ ПУЛА СВОБОДНЫХ ШТРИХКОДОВ
-- Диапазон: 10000 - 99999
-- =====================================================

DELETE FROM free_barcodes;

UPDATE barcode_sequence
SET position = 1
WHERE id = 1;


WITH RECURSIVE barcode_range(barcode) AS (
  SELECT 10000

  UNION ALL

  SELECT barcode + 1
  FROM barcode_range
  WHERE barcode < 99999
),

available AS (
  SELECT barcode
  FROM barcode_range

  WHERE NOT EXISTS (
    SELECT 1
    FROM products
    WHERE products.barcode = barcode_range.barcode
  )
)

INSERT INTO free_barcodes (
  id,
  barcode
)

SELECT
  ROW_NUMBER() OVER (
    ORDER BY barcode
  ) AS id,

  barcode

FROM available

ORDER BY barcode;