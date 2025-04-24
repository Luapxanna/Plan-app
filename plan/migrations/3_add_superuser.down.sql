-- Drop the superuser column
ALTER TABLE users DROP COLUMN is_superuser;

-- Drop the hash generation function
DROP FUNCTION IF EXISTS generate_hash; 