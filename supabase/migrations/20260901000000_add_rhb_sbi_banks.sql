-- Add RHB and State Bank of India to the banks table
INSERT INTO banks (name, sort_order) VALUES
  ('RHB',                  11),
  ('State Bank of India',  12)
ON CONFLICT (name) DO NOTHING;
