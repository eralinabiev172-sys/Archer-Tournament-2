-- Создание таблицы для хранения состояния турнира
CREATE TABLE IF NOT EXISTS tournament_state (
  id TEXT PRIMARY KEY,
  tournament_name TEXT NOT NULL DEFAULT 'Жаа атуу боюнча турнир',
  location TEXT NOT NULL DEFAULT 'Чолпон-Ата, 2026-жыл',
  category TEXT NOT NULL DEFAULT 'Классикалык жаа, 50 метр, эркектер',
  head_referee TEXT DEFAULT '',
  head_secretary TEXT DEFAULT '',
  players JSONB DEFAULT '[]'::jsonb,
  scores JSONB DEFAULT '{}'::jsonb,
  bracket JSONB DEFAULT '{"roundOf32":[],"roundOf16":[],"quarterFinals":[],"semiFinals":[],"final12":null,"final34":null,"winners":[]}'::jsonb,
  playoff_stage TEXT DEFAULT 'none',
  playoff_mode INTEGER DEFAULT 16,
  player_number_book JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Создание индекса для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_tournament_state_id ON tournament_state(id);

-- Вставка начального состояния (если не существует)
INSERT INTO tournament_state (
  id,
  tournament_name,
  location,
  category,
  head_referee,
  head_secretary,
  players,
  scores,
  bracket,
  playoff_stage,
  playoff_mode,
  player_number_book
)
VALUES (
  'main',
  'Жаа атуу боюнча турнир',
  'Чолпон-Ата, 2026-жыл',
  'Классикалык жаа, 50 метр, эркектер',
  '',
  '',
  '[]'::jsonb,
  '{}'::jsonb,
  '{"roundOf32":[],"roundOf16":[],"quarterFinals":[],"semiFinals":[],"final12":null,"final34":null,"winners":[]}'::jsonb,
  'none',
  16,
  '{}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- Функция для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Триггер для автоматического обновления updated_at
DROP TRIGGER IF EXISTS update_tournament_state_updated_at ON tournament_state;
CREATE TRIGGER update_tournament_state_updated_at
  BEFORE UPDATE ON tournament_state
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Включение Row Level Security (RLS)
ALTER TABLE tournament_state ENABLE ROW LEVEL SECURITY;

-- Политика: разрешить всем читать
CREATE POLICY "Allow public read access" ON tournament_state
  FOR SELECT
  USING (true);

-- Политика: разрешить всем обновлять
CREATE POLICY "Allow public update access" ON tournament_state
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Политика: разрешить всем вставлять
CREATE POLICY "Allow public insert access" ON tournament_state
  FOR INSERT
  WITH CHECK (true);
