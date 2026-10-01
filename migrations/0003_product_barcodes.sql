-- =====================================================
-- FREE PRODUCT BARCODES
-- =====================================================

CREATE TABLE IF NOT EXISTS free_barcodes (
  id INTEGER PRIMARY KEY,
  barcode INTEGER NOT NULL UNIQUE
);


-- =====================================================
-- BARCODE SEQUENCE
-- =====================================================

CREATE TABLE IF NOT EXISTS barcode_sequence (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  position INTEGER NOT NULL DEFAULT 1
);


-- =====================================================
-- INITIAL POSITION
-- =====================================================

INSERT OR IGNORE INTO barcode_sequence (
  id,
  position
)
VALUES (
  1,
  1
);