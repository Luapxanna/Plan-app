-- Create pgcrypto extension if not exists
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create a function to generate bcrypt hash
CREATE OR REPLACE FUNCTION generate_hash(password TEXT) 
RETURNS TEXT AS $$
BEGIN
    -- Generate a bcrypt hash with cost factor 10
    RETURN crypt(password, gen_salt('bf', 10));
END;
$$ LANGUAGE plpgsql;

-- Create a default superuser (password: admin123)
INSERT INTO users (email, password_hash, is_superuser)
VALUES (
  'admin@example.com',
  generate_hash('admin123'),
  TRUE
)
ON CONFLICT (email) DO UPDATE SET password_hash = generate_hash('admin123'), is_superuser = TRUE; 