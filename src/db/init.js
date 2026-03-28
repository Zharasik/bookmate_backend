const pool = require('./pool');
require('dotenv').config();

const SQL = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  phone TEXT,
  role TEXT DEFAULT 'user' CHECK (role IN ('user','admin','owner')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS venues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  location TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  price_range TEXT,
  latitude DOUBLE PRECISION DEFAULT 0,
  longitude DOUBLE PRECISION DEFAULT 0,
  amenities TEXT[] DEFAULT '{}',
  rating NUMERIC(2,1) DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  open_time TEXT DEFAULT '10:00',
  close_time TEXT DEFAULT '02:00',
  phone TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  venue_id UUID REFERENCES venues(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  time TEXT NOT NULL,
  guests INTEGER DEFAULT 1,
  status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming','completed','cancelled')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(venue_id, date, time)
);

CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  venue_id UUID REFERENCES venues(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, venue_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('booking','offer','review','venue')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  venue_id UUID REFERENCES venues(id) ON DELETE CASCADE,
  UNIQUE(user_id, venue_id)
);

CREATE TABLE IF NOT EXISTS venue_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID REFERENCES venues(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID REFERENCES venues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price INTEGER DEFAULT 0,
  duration INTEGER DEFAULT 60,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS masters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID REFERENCES venues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT DEFAULT '',
  bio TEXT,
  avatar_url TEXT,
  phone TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID REFERENCES venues(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  discount INTEGER DEFAULT 0,
  start_date DATE,
  end_date DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Migration helpers
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
  ALTER TABLE venues ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE SET NULL;
  ALTER TABLE venues ADD COLUMN IF NOT EXISTS open_time TEXT DEFAULT '10:00';
  ALTER TABLE venues ADD COLUMN IF NOT EXISTS close_time TEXT DEFAULT '02:00';
  ALTER TABLE venues ADD COLUMN IF NOT EXISTS phone TEXT;
  ALTER TABLE venues ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Older DBs may have role CHECK (user, admin) only; register-owner needs owner.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user','admin','owner'));
`;

const SEED = `
INSERT INTO venues (name, category, location, description, image_url, price_range, latitude, longitude, amenities, rating, review_count)
VALUES
  ('Elite Billiards Club','Billiards','Downtown','Premium billiards club with professional tables.','https://images.unsplash.com/photo-1575425186775-b8de9a427e67?w=800','₸₸₸',43.2389,76.8897,ARRAY['WiFi','Bar','Parking'],0,0),
  ('Strike Zone Bowling','Bowling','West End','Modern bowling center with 16 lanes.','https://images.unsplash.com/photo-1538511051852-73f9c6ac587b?w=800','₸₸',43.252,76.875,ARRAY['16 Lanes','Arcade','Cafe'],0,0),
  ('Neon Arcade Gaming','Gaming','Midtown','Gaming lounge with VR and retro arcades.','https://images.unsplash.com/photo-1511512578047-dfb367046420?w=800','₸₸₸',43.235,76.91,ARRAY['VR','PC Gaming','Tournaments'],0,0),
  ('Champions Sports Bar','Billiards','East Side','Sports bar with pool tables and darts.','https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800','₸₸',43.22,76.92,ARRAY['Pool','Darts','Sports TV'],0,0),
  ('Retro Arcade Almaty','Arcade','City Center','80s themed arcade with pinball.','https://images.unsplash.com/photo-1605901309584-818e25960a8f?w=800','₸',43.245,76.88,ARRAY['Pinball','Retro Games','Snacks'],0,0),
  ('Royal Bowling Center','Bowling','South Mall','Luxury bowling with VIP lanes.','https://images.unsplash.com/photo-1558618047-f4b51120375f?w=800','₸₸₸₸',43.215,76.865,ARRAY['VIP Lanes','Restaurant','Bar'],0,0)
ON CONFLICT DO NOTHING;
`;

async function init() {
  const client = await pool.connect();
  try {
    console.log('Creating tables...');
    await client.query(SQL);
    console.log('Tables created.');

    const { rows } = await client.query('SELECT count(*) FROM venues');
    if (+rows[0].count === 0) {
      await client.query(SEED);
      console.log('Venues seeded (ratings start at 0 — real reviews only).');
    }

    const admins = await client.query("SELECT count(*) FROM users WHERE role='admin'");
    if (+admins.rows[0].count === 0) {
      const bcrypt = require('bcrypt');
      const hash = await bcrypt.hash('admin123', 10);
      await client.query(
        `INSERT INTO users (email, password_hash, name, role) VALUES ($1,$2,$3,'admin') ON CONFLICT (email) DO UPDATE SET role='admin'`,
        ['admin@bookmate.kz', hash, 'Admin']
      );
      console.log('Default admin: admin@bookmate.kz / admin123');
    }

    console.log('DB initialized!');
  } catch (err) { console.error('DB init error:', err); process.exit(1); }
  finally { client.release(); await pool.end(); }
}

init();
