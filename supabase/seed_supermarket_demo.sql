-- TrueMarket single-store supermarket demo catalog.
-- Prices and stock levels are illustrative South African Rand values. Confirm
-- shelf prices and product-specific VAT treatment before using this in a live store.
-- SKUs are demo identifiers; barcodes are intentionally NULL until scanned from
-- the actual products. Existing products are left untouched when this is rerun.

BEGIN;

INSERT INTO public.categories (name)
VALUES
    ('Bakery'),
    ('Fruit & vegetables'),
    ('Dairy & eggs'),
    ('Meat & poultry'),
    ('Fish & seafood'),
    ('Rice, grains & legumes'),
    ('Pantry & cooking'),
    ('Canned & jars'),
    ('Breakfast & spreads'),
    ('Snacks & confectionery'),
    ('Soft drinks & water'),
    ('Tea & coffee'),
    ('Frozen foods'),
    ('Household cleaning'),
    ('Laundry'),
    ('Personal care'),
    ('Baby care'),
    ('Pet supplies'),
    ('Health & first aid')
ON CONFLICT (name) DO NOTHING;

WITH seed_products (sku, name, price_cents, tax_category, stock_qty, reorder_at, category_name) AS (
    VALUES
    -- Bakery (brown bread is zero-rated when it meets the legal definition).
    ('DEMO-BAK-001', 'Brown bread loaf 700 g', 1799, 'zero_rated', 24, 6, 'Bakery'),
    ('DEMO-BAK-002', 'White sandwich bread loaf 700 g', 1899, 'standard', 22, 6, 'Bakery'),
    ('DEMO-BAK-003', 'Wholewheat bread loaf 700 g', 2299, 'standard', 12, 4, 'Bakery'),
    ('DEMO-BAK-004', 'Hot dog rolls 6 pack', 2499, 'standard', 10, 3, 'Bakery'),
    ('DEMO-BAK-005', 'Hamburger rolls 6 pack', 2699, 'standard', 10, 3, 'Bakery'),
    ('DEMO-BAK-006', 'Plain croissants 4 pack', 3999, 'standard', 7, 2, 'Bakery'),
    ('DEMO-BAK-007', 'Blueberry muffins 4 pack', 3599, 'standard', 8, 2, 'Bakery'),
    ('DEMO-BAK-008', 'Plain vetkoek 4 pack', 3299, 'standard', 8, 2, 'Bakery'),

    -- Fresh whole fruit and vegetables are zero-rated basic foodstuffs.
    ('DEMO-FRV-001', 'Bananas loose 1 kg', 2499, 'zero_rated', 30, 8, 'Fruit & vegetables'),
    ('DEMO-FRV-002', 'Apples, red 1 kg bag', 3299, 'zero_rated', 18, 5, 'Fruit & vegetables'),
    ('DEMO-FRV-003', 'Oranges 1 kg bag', 2999, 'zero_rated', 18, 5, 'Fruit & vegetables'),
    ('DEMO-FRV-004', 'Pears 1 kg bag', 3499, 'zero_rated', 12, 4, 'Fruit & vegetables'),
    ('DEMO-FRV-005', 'Lemons 500 g bag', 1999, 'zero_rated', 12, 4, 'Fruit & vegetables'),
    ('DEMO-FRV-006', 'Avocados 3 pack', 3499, 'zero_rated', 15, 4, 'Fruit & vegetables'),
    ('DEMO-FRV-007', 'Tomatoes 1 kg', 2999, 'zero_rated', 18, 5, 'Fruit & vegetables'),
    ('DEMO-FRV-008', 'Potatoes 2 kg bag', 3299, 'zero_rated', 20, 6, 'Fruit & vegetables'),
    ('DEMO-FRV-009', 'Onions 1 kg bag', 2499, 'zero_rated', 18, 5, 'Fruit & vegetables'),
    ('DEMO-FRV-010', 'Carrots 1 kg bag', 1999, 'zero_rated', 16, 4, 'Fruit & vegetables'),
    ('DEMO-FRV-011', 'Butternut whole 1 kg', 2299, 'zero_rated', 14, 4, 'Fruit & vegetables'),
    ('DEMO-FRV-012', 'Cabbage whole each', 2499, 'zero_rated', 10, 3, 'Fruit & vegetables'),
    ('DEMO-FRV-013', 'Spinach bunch', 1499, 'zero_rated', 12, 3, 'Fruit & vegetables'),
    ('DEMO-FRV-014', 'Green peppers 3 pack', 2499, 'zero_rated', 12, 3, 'Fruit & vegetables'),
    ('DEMO-FRV-015', 'Cucumbers each', 1299, 'zero_rated', 12, 3, 'Fruit & vegetables'),
    ('DEMO-FRV-016', 'Sweetcorn 4 pack', 2999, 'zero_rated', 10, 3, 'Fruit & vegetables'),

    -- Milk and hen eggs are zero-rated; cheese and cultured dairy are standard here.
    ('DEMO-DAI-001', 'Full cream cow milk 1 L', 1799, 'zero_rated', 24, 8, 'Dairy & eggs'),
    ('DEMO-DAI-002', 'Full cream cow milk 2 L', 3299, 'zero_rated', 18, 6, 'Dairy & eggs'),
    ('DEMO-DAI-003', 'Low fat cow milk 1 L', 1799, 'zero_rated', 16, 5, 'Dairy & eggs'),
    ('DEMO-DAI-004', 'UHT cow milk 1 L', 1999, 'zero_rated', 20, 6, 'Dairy & eggs'),
    ('DEMO-DAI-005', 'Hen eggs large 6 pack', 2299, 'zero_rated', 18, 5, 'Dairy & eggs'),
    ('DEMO-DAI-006', 'Hen eggs large 18 pack', 5699, 'zero_rated', 12, 4, 'Dairy & eggs'),
    ('DEMO-DAI-007', 'Plain yoghurt 1 kg tub', 4299, 'standard', 10, 3, 'Dairy & eggs'),
    ('DEMO-DAI-008', 'Strawberry yoghurt 6 pack', 3199, 'standard', 12, 4, 'Dairy & eggs'),
    ('DEMO-DAI-009', 'Cheddar cheese 400 g', 6999, 'standard', 8, 2, 'Dairy & eggs'),
    ('DEMO-DAI-010', 'Processed cheese slices 200 g', 3999, 'standard', 10, 3, 'Dairy & eggs'),
    ('DEMO-DAI-011', 'Salted butter 500 g', 7999, 'standard', 7, 2, 'Dairy & eggs'),
    ('DEMO-DAI-012', 'Fresh cream 250 ml', 3299, 'standard', 8, 2, 'Dairy & eggs'),

    -- Meat and poultry.
    ('DEMO-MEA-001', 'Chicken breast fillets 1 kg', 8999, 'standard', 12, 3, 'Meat & poultry'),
    ('DEMO-MEA-002', 'Chicken drumsticks 1 kg', 5499, 'standard', 14, 4, 'Meat & poultry'),
    ('DEMO-MEA-003', 'Whole chicken fresh 1.5 kg', 7999, 'standard', 10, 3, 'Meat & poultry'),
    ('DEMO-MEA-004', 'Beef mince 500 g', 6999, 'standard', 10, 3, 'Meat & poultry'),
    ('DEMO-MEA-005', 'Beef stew pieces 1 kg', 10999, 'standard', 8, 2, 'Meat & poultry'),
    ('DEMO-MEA-006', 'Beef boerewors 1 kg', 9999, 'standard', 9, 3, 'Meat & poultry'),
    ('DEMO-MEA-007', 'Pork sausages 500 g', 5999, 'standard', 8, 2, 'Meat & poultry'),
    ('DEMO-MEA-008', 'Pork chops 700 g', 8999, 'standard', 8, 2, 'Meat & poultry'),
    ('DEMO-MEA-009', 'Beef steak 500 g', 11999, 'standard', 7, 2, 'Meat & poultry'),
    ('DEMO-MEA-010', 'Chicken viennas 500 g', 3999, 'standard', 12, 4, 'Meat & poultry'),
    ('DEMO-MEA-011', 'Smoked bacon 250 g', 4999, 'standard', 10, 3, 'Meat & poultry'),
    ('DEMO-MEA-012', 'Sliced ham 200 g', 4299, 'standard', 9, 3, 'Meat & poultry'),

    -- Fish; tinned pilchards in tomato sauce are included as the basic zero-rated item.
    ('DEMO-FIS-001', 'Pilchards in tomato sauce 400 g tin', 2499, 'zero_rated', 24, 6, 'Fish & seafood'),
    ('DEMO-FIS-002', 'Pilchards in chilli sauce 400 g tin', 2599, 'standard', 16, 5, 'Fish & seafood'),
    ('DEMO-FIS-003', 'Tuna chunks in brine 170 g tin', 2399, 'standard', 18, 5, 'Fish & seafood'),
    ('DEMO-FIS-004', 'Sardines in tomato sauce 120 g tin', 1799, 'standard', 16, 4, 'Fish & seafood'),
    ('DEMO-FIS-005', 'Frozen hake fillets 800 g', 9999, 'standard', 8, 2, 'Fish & seafood'),
    ('DEMO-FIS-006', 'Frozen fish fingers 400 g', 5999, 'standard', 9, 3, 'Fish & seafood'),
    ('DEMO-FIS-007', 'Frozen prawns peeled 400 g', 11999, 'standard', 5, 2, 'Fish & seafood'),
    ('DEMO-FIS-008', 'Smoked snoek portions 500 g', 8999, 'standard', 5, 2, 'Fish & seafood'),

    -- Rice, grains and qualifying dry legumes.
    ('DEMO-GRA-001', 'Long grain rice 2 kg', 3999, 'zero_rated', 20, 6, 'Rice, grains & legumes'),
    ('DEMO-GRA-002', 'Long grain rice 5 kg', 8999, 'zero_rated', 10, 3, 'Rice, grains & legumes'),
    ('DEMO-GRA-003', 'Maize meal super fine 2.5 kg', 3499, 'zero_rated', 18, 6, 'Rice, grains & legumes'),
    ('DEMO-GRA-004', 'Maize meal 5 kg', 6499, 'zero_rated', 12, 4, 'Rice, grains & legumes'),
    ('DEMO-GRA-005', 'Samp 1 kg', 2499, 'zero_rated', 12, 4, 'Rice, grains & legumes'),
    ('DEMO-GRA-006', 'Mealie rice 1 kg', 2299, 'zero_rated', 10, 3, 'Rice, grains & legumes'),
    ('DEMO-GRA-007', 'Dried sugar beans 500 g', 2499, 'zero_rated', 14, 4, 'Rice, grains & legumes'),
    ('DEMO-GRA-008', 'Dried red speckled beans 500 g', 2699, 'zero_rated', 10, 3, 'Rice, grains & legumes'),
    ('DEMO-GRA-009', 'Dried lentils 500 g', 2999, 'zero_rated', 12, 4, 'Rice, grains & legumes'),
    ('DEMO-GRA-010', 'Dried split peas 500 g', 2299, 'zero_rated', 10, 3, 'Rice, grains & legumes'),
    ('DEMO-GRA-011', 'Pearl barley 500 g', 2499, 'standard', 8, 2, 'Rice, grains & legumes'),
    ('DEMO-GRA-012', 'Rolled oats 1 kg', 4499, 'standard', 12, 4, 'Rice, grains & legumes'),

    -- Pantry and cooking.
    ('DEMO-PAN-001', 'Sunflower cooking oil 750 ml', 3299, 'zero_rated', 18, 5, 'Pantry & cooking'),
    ('DEMO-PAN-002', 'Sunflower cooking oil 2 L', 7999, 'zero_rated', 10, 3, 'Pantry & cooking'),
    ('DEMO-PAN-003', 'Canola cooking oil 750 ml', 3999, 'zero_rated', 8, 2, 'Pantry & cooking'),
    ('DEMO-PAN-004', 'Extra virgin olive oil 500 ml', 12999, 'standard', 5, 2, 'Pantry & cooking'),
    ('DEMO-PAN-005', 'White sugar 2.5 kg', 4999, 'standard', 18, 5, 'Pantry & cooking'),
    ('DEMO-PAN-006', 'Cake wheat flour 2.5 kg', 3499, 'zero_rated', 14, 4, 'Pantry & cooking'),
    ('DEMO-PAN-007', 'White bread wheat flour 2.5 kg', 3699, 'zero_rated', 10, 3, 'Pantry & cooking'),
    ('DEMO-PAN-008', 'Iodated table salt 1 kg', 1299, 'standard', 14, 4, 'Pantry & cooking'),
    ('DEMO-PAN-009', 'Spaghetti 500 g', 1999, 'standard', 18, 5, 'Pantry & cooking'),
    ('DEMO-PAN-010', 'Macaroni 500 g', 1899, 'standard', 16, 5, 'Pantry & cooking'),

    -- Canned goods and jars.
    ('DEMO-CAN-001', 'Baked beans in tomato sauce 410 g tin', 1799, 'standard', 22, 6, 'Canned & jars'),
    ('DEMO-CAN-002', 'Whole peeled tomatoes 410 g tin', 1699, 'standard', 16, 4, 'Canned & jars'),
    ('DEMO-CAN-003', 'Cream style sweetcorn 410 g tin', 1899, 'standard', 14, 4, 'Canned & jars'),
    ('DEMO-CAN-004', 'Sweet garden peas 400 g tin', 1799, 'standard', 12, 3, 'Canned & jars'),
    ('DEMO-CAN-005', 'Mixed vegetables 410 g tin', 1799, 'standard', 12, 3, 'Canned & jars'),
    ('DEMO-CAN-006', 'Peanut butter smooth 400 g', 3999, 'standard', 12, 4, 'Canned & jars'),
    ('DEMO-CAN-007', 'Strawberry jam 450 g', 3499, 'standard', 10, 3, 'Canned & jars'),
    ('DEMO-CAN-008', 'Mayonnaise 750 g', 4999, 'standard', 8, 2, 'Canned & jars'),
    ('DEMO-CAN-009', 'Tomato sauce 500 ml', 2499, 'standard', 12, 4, 'Canned & jars'),
    ('DEMO-CAN-010', 'Chutney 470 g', 3299, 'standard', 8, 2, 'Canned & jars'),

    -- Breakfast and spreads.
    ('DEMO-BRF-001', 'Corn flakes 500 g', 4999, 'standard', 10, 3, 'Breakfast & spreads'),
    ('DEMO-BRF-002', 'Muesli 750 g', 8999, 'standard', 6, 2, 'Breakfast & spreads'),
    ('DEMO-BRF-003', 'Instant oats sachets 10 pack', 3999, 'standard', 8, 2, 'Breakfast & spreads'),
    ('DEMO-BRF-004', 'Weet-style wheat biscuits 450 g', 5499, 'standard', 8, 2, 'Breakfast & spreads'),
    ('DEMO-BRF-005', 'Honey 500 g', 7999, 'standard', 6, 2, 'Breakfast & spreads'),
    ('DEMO-BRF-006', 'Chocolate hazelnut spread 400 g', 6999, 'standard', 6, 2, 'Breakfast & spreads'),
    ('DEMO-BRF-007', 'Margarine spread 500 g', 2999, 'standard', 10, 3, 'Breakfast & spreads'),
    ('DEMO-BRF-008', 'Raisins 250 g', 2999, 'standard', 8, 2, 'Breakfast & spreads'),

    -- Snacks and confectionery.
    ('DEMO-SNK-001', 'Salted potato crisps 125 g', 1999, 'standard', 20, 6, 'Snacks & confectionery'),
    ('DEMO-SNK-002', 'Cheese corn puffs 100 g', 1499, 'standard', 18, 5, 'Snacks & confectionery'),
    ('DEMO-SNK-003', 'Salted peanuts 200 g', 2499, 'standard', 10, 3, 'Snacks & confectionery'),
    ('DEMO-SNK-004', 'Salted crackers 200 g', 2299, 'standard', 12, 4, 'Snacks & confectionery'),
    ('DEMO-SNK-005', 'Plain tea biscuits 200 g', 1799, 'standard', 18, 5, 'Snacks & confectionery'),
    ('DEMO-SNK-006', 'Chocolate slab 80 g', 1799, 'standard', 18, 5, 'Snacks & confectionery'),
    ('DEMO-SNK-007', 'Gummy sweets 150 g', 1599, 'standard', 14, 4, 'Snacks & confectionery'),
    ('DEMO-SNK-008', 'Popcorn kernels 500 g', 2999, 'standard', 8, 2, 'Snacks & confectionery'),
    ('DEMO-SNK-009', 'Salted pretzels 150 g', 1999, 'standard', 8, 2, 'Snacks & confectionery'),
    ('DEMO-SNK-010', 'Mixed nuts 150 g', 4999, 'standard', 6, 2, 'Snacks & confectionery'),

    -- Soft drinks and water.
    ('DEMO-SFT-001', 'Still water 500 ml', 999, 'standard', 30, 8, 'Soft drinks & water'),
    ('DEMO-SFT-002', 'Still water 1.5 L', 1499, 'standard', 24, 6, 'Soft drinks & water'),
    ('DEMO-SFT-003', 'Sparkling water 1 L', 1799, 'standard', 12, 3, 'Soft drinks & water'),
    ('DEMO-SFT-004', 'Cola soft drink 2 L', 2299, 'standard', 18, 5, 'Soft drinks & water'),
    ('DEMO-SFT-005', 'Lemon-lime soft drink 2 L', 2199, 'standard', 14, 4, 'Soft drinks & water'),
    ('DEMO-SFT-006', 'Orange drink 2 L', 2199, 'standard', 12, 3, 'Soft drinks & water'),
    ('DEMO-SFT-007', '100% orange juice 1 L', 3299, 'standard', 10, 3, 'Soft drinks & water'),
    ('DEMO-SFT-008', 'Energy drink 500 ml', 1999, 'standard', 12, 4, 'Soft drinks & water'),

    -- Tea and coffee.
    ('DEMO-TEA-001', 'Rooibos tea bags 40 pack', 3999, 'standard', 10, 3, 'Tea & coffee'),
    ('DEMO-TEA-002', 'Black tea bags 100 pack', 5999, 'standard', 10, 3, 'Tea & coffee'),
    ('DEMO-TEA-003', 'Ground coffee 250 g', 7999, 'standard', 7, 2, 'Tea & coffee'),
    ('DEMO-TEA-004', 'Instant coffee 200 g', 9999, 'standard', 8, 2, 'Tea & coffee'),
    ('DEMO-TEA-005', 'Hot chocolate powder 500 g', 6999, 'standard', 6, 2, 'Tea & coffee'),
    ('DEMO-TEA-006', 'Coffee creamer 750 g', 5499, 'standard', 7, 2, 'Tea & coffee'),

    -- Frozen foods.
    ('DEMO-FRZ-001', 'Frozen mixed vegetables 1 kg', 3999, 'standard', 10, 3, 'Frozen foods'),
    ('DEMO-FRZ-002', 'Frozen peas 750 g', 3299, 'standard', 8, 2, 'Frozen foods'),
    ('DEMO-FRZ-003', 'Frozen chips 1 kg', 3999, 'standard', 12, 4, 'Frozen foods'),
    ('DEMO-FRZ-004', 'Frozen chicken nuggets 750 g', 7999, 'standard', 8, 2, 'Frozen foods'),
    ('DEMO-FRZ-005', 'Vanilla ice cream 2 L', 6999, 'standard', 8, 2, 'Frozen foods'),
    ('DEMO-FRZ-006', 'Frozen pizza cheese 450 g', 5999, 'standard', 7, 2, 'Frozen foods'),
    ('DEMO-FRZ-007', 'Frozen pastry sheets 400 g', 4999, 'standard', 6, 2, 'Frozen foods'),
    ('DEMO-FRZ-008', 'Frozen berries 500 g', 7999, 'standard', 5, 2, 'Frozen foods'),

    -- Household cleaning.
    ('DEMO-HOU-001', 'Dishwashing liquid 750 ml', 2999, 'standard', 12, 4, 'Household cleaning'),
    ('DEMO-HOU-002', 'Multi-purpose cleaner 750 ml', 3499, 'standard', 10, 3, 'Household cleaning'),
    ('DEMO-HOU-003', 'Cream household cleaner 500 ml', 2699, 'standard', 8, 2, 'Household cleaning'),
    ('DEMO-HOU-004', 'Toilet cleaner 750 ml', 3299, 'standard', 8, 2, 'Household cleaning'),
    ('DEMO-HOU-005', 'Bleach 1 L', 1999, 'standard', 14, 4, 'Household cleaning'),
    ('DEMO-HOU-006', 'All-purpose disinfectant 1 L', 3999, 'standard', 8, 2, 'Household cleaning'),
    ('DEMO-HOU-007', 'Kitchen sponge 3 pack', 1799, 'standard', 12, 3, 'Household cleaning'),
    ('DEMO-HOU-008', 'Refuse bags medium 20 pack', 2499, 'standard', 10, 3, 'Household cleaning'),

    -- Laundry.
    ('DEMO-LAU-001', 'Washing powder 2 kg', 7999, 'standard', 10, 3, 'Laundry'),
    ('DEMO-LAU-002', 'Laundry liquid 1.5 L', 8999, 'standard', 7, 2, 'Laundry'),
    ('DEMO-LAU-003', 'Fabric softener 2 L', 5999, 'standard', 8, 2, 'Laundry'),
    ('DEMO-LAU-004', 'Laundry bar soap 500 g', 1999, 'standard', 12, 4, 'Laundry'),
    ('DEMO-LAU-005', 'Stain remover 500 ml', 4999, 'standard', 6, 2, 'Laundry'),
    ('DEMO-LAU-006', 'Clothes pegs 24 pack', 1999, 'standard', 8, 2, 'Laundry'),

    -- Personal care.
    ('DEMO-PER-001', 'Toilet tissue 2 ply 9 roll', 6999, 'standard', 14, 4, 'Personal care'),
    ('DEMO-PER-002', 'Facial tissues 100 pack', 2299, 'standard', 10, 3, 'Personal care'),
    ('DEMO-PER-003', 'Bath soap 175 g', 1499, 'standard', 20, 6, 'Personal care'),
    ('DEMO-PER-004', 'Shampoo 400 ml', 4999, 'standard', 8, 2, 'Personal care'),
    ('DEMO-PER-005', 'Toothpaste 100 ml', 2999, 'standard', 12, 4, 'Personal care'),
    ('DEMO-PER-006', 'Manual toothbrush medium', 1999, 'standard', 12, 4, 'Personal care'),
    ('DEMO-PER-007', 'Roll-on deodorant 50 ml', 3299, 'standard', 10, 3, 'Personal care'),
    ('DEMO-PER-008', 'Sanitary pads regular 10 pack', 2999, 'standard', 12, 4, 'Personal care'),

    -- Baby care.
    ('DEMO-BAB-001', 'Disposable nappies size 3 44 pack', 18999, 'standard', 7, 2, 'Baby care'),
    ('DEMO-BAB-002', 'Disposable nappies size 4 40 pack', 18999, 'standard', 7, 2, 'Baby care'),
    ('DEMO-BAB-003', 'Baby wipes 80 pack', 2999, 'standard', 12, 4, 'Baby care'),
    ('DEMO-BAB-004', 'Baby lotion 200 ml', 4999, 'standard', 6, 2, 'Baby care'),
    ('DEMO-BAB-005', 'Baby cereal 250 g', 3999, 'standard', 6, 2, 'Baby care'),
    ('DEMO-BAB-006', 'Infant formula stage 1 900 g', 23999, 'standard', 5, 2, 'Baby care'),

    -- Pet supplies.
    ('DEMO-PET-001', 'Adult dog food beef 2 kg', 8999, 'standard', 8, 2, 'Pet supplies'),
    ('DEMO-PET-002', 'Adult cat food 2 kg', 9999, 'standard', 7, 2, 'Pet supplies'),
    ('DEMO-PET-003', 'Dog food chicken 5 kg', 19999, 'standard', 5, 2, 'Pet supplies'),
    ('DEMO-PET-004', 'Cat food chunks 400 g tin', 1999, 'standard', 18, 5, 'Pet supplies'),
    ('DEMO-PET-005', 'Dog treats 500 g', 4999, 'standard', 6, 2, 'Pet supplies'),
    ('DEMO-PET-006', 'Cat litter 5 kg', 6999, 'standard', 5, 2, 'Pet supplies'),

    -- General health and first aid.
    ('DEMO-HLT-001', 'Adhesive plasters assorted 20 pack', 2999, 'standard', 8, 2, 'Health & first aid'),
    ('DEMO-HLT-002', 'Antiseptic solution 100 ml', 3999, 'standard', 6, 2, 'Health & first aid'),
    ('DEMO-HLT-003', 'Cotton wool 100 g', 2299, 'standard', 8, 2, 'Health & first aid'),
    ('DEMO-HLT-004', 'Hand sanitiser 250 ml', 3499, 'standard', 8, 2, 'Health & first aid'),
    ('DEMO-HLT-005', 'Oral rehydration salts 10 sachets', 4999, 'standard', 5, 2, 'Health & first aid')
)
INSERT INTO public.products (
    sku,
    barcode,
    name,
    price_cents,
    tax_category,
    stock_qty,
    reorder_at,
    active,
    category_id
)
SELECT
    seed.sku,
    NULL,
    seed.name,
    seed.price_cents,
    seed.tax_category::public.tax_category,
    seed.stock_qty,
    seed.reorder_at,
    true,
    category.id
FROM seed_products AS seed
JOIN public.categories AS category ON category.name = seed.category_name
ON CONFLICT (sku) DO NOTHING;

COMMIT;

-- After running, the POS should show this catalog immediately after a refresh.
-- SELECT count(*) AS seeded_demo_products FROM public.products WHERE sku LIKE 'DEMO-%';
