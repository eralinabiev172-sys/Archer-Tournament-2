# 🗄️ Настройка Supabase для постоянного хранения данных

## Зачем Supabase?

Vercel serverless функции используют временное хранилище `/tmp/`, которое очищается при перезапуске. Supabase предоставляет постоянную PostgreSQL базу данных.

## 📋 Шаги настройки

### 1. Создайте проект в Supabase

1. Зайдите на https://supabase.com
2. Нажмите "Start your project"
3. Создайте аккаунт (если нет)
4. Нажмите "New Project"
5. Заполните:
   - **Name**: archery-tournament (или свое название)
   - **Database Password**: придумайте надежный пароль (сохраните его!)
   - **Region**: выберите ближайший регион
6. Нажмите "Create new project" (займет 1-2 минуты)

### 2. Создайте таблицу в базе данных

1. В левом меню выберите **SQL Editor**
2. Нажмите "New query"
3. Скопируйте содержимое файла `supabase-schema.sql`
4. Вставьте в редактор
5. Нажмите "Run" (или Ctrl+Enter)

Вы должны увидеть сообщение: "Success. No rows returned"

### 3. Получите API ключи

1. В левом меню выберите **Settings** (⚙️)
2. Выберите **API**
3. Скопируйте:
   - **Project URL** (например: `https://xxxxx.supabase.co`)
   - **anon public** ключ (длинная строка)

### 4. Настройте переменные окружения

#### Для локальной разработки:

Создайте файл `.env` в папке `my-archery-app`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
SUPABASE_ANON_KEY=your-anon-key-here

VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

For Vercel production, add these Environment Variables and redeploy:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (recommended for serverless API routes)
- `SUPABASE_ANON_KEY` (fallback)

#### Для Vercel (production):

1. Зайдите на https://vercel.com/dashboard
2. Выберите свой проект
3. Перейдите в **Settings** → **Environment Variables**
4. Добавьте переменные:
   - `SUPABASE_URL` = ваш Project URL
   - `SUPABASE_ANON_KEY` = ваш anon ключ
5. Нажмите "Save"
6. **Важно**: Сделайте Redeploy проекта для применения переменных

### 5. Установите зависимости

```bash
cd my-archery-app
npm install
```

### 6. Проверьте работу

#### Локально:

```bash
# Запустите backend (если нужно)
npm run dev:server

# Запустите frontend
npm run dev:admin
```

Попробуйте добавить игрока - данные должны сохраниться в Supabase!

#### На Vercel:

После redeploy откройте ваш сайт и попробуйте добавить игрока.

### 7. Проверьте данные в Supabase

1. В Supabase перейдите в **Table Editor**
2. Выберите таблицу `tournament_state`
3. Вы должны увидеть запись с `id = 'main'`
4. После добавления игроков, в колонке `players` появятся данные

## 🔍 Структура данных

Все данные турнира хранятся в одной записи с `id = 'main'`:

- `tournament_name` - название турнира
- `location` - место проведения
- `category` - категория
- `head_referee` - главный судья
- `head_secretary` - главный секретарь
- `players` - массив игроков (JSONB)
- `scores` - результаты квалификации (JSONB)
- `bracket` - сетка плей-офф (JSONB)
- `playoff_stage` - текущий этап плей-офф
- `playoff_mode` - режим плей-офф (8, 16, 32)
- `player_number_book` - книга номеров игроков (JSONB)

## 🔒 Безопасность

Текущая настройка использует Row Level Security (RLS) с публичным доступом для чтения и записи. Это подходит для MVP, но для production рекомендуется:

1. Настроить аутентификацию для админ-панели
2. Ограничить запись только для авторизованных пользователей
3. Оставить публичный доступ только для чтения (пользовательский сайт)

## 🐛 Отладка

### Ошибка: "Supabase not configured"

- Проверьте, что переменные окружения установлены
- В Vercel: сделайте Redeploy после добавления переменных

### Ошибка: "relation 'tournament_state' does not exist"

- Выполните SQL скрипт из `supabase-schema.sql`

### Данные не сохраняются

- Проверьте логи в Vercel Dashboard → Functions
- Проверьте RLS политики в Supabase → Authentication → Policies

## 📊 Мониторинг

В Supabase Dashboard вы можете:
- Просматривать данные в реальном времени (Table Editor)
- Смотреть логи запросов (Logs)
- Анализировать производительность (Reports)

## 🚀 Готово!

Теперь ваши данные сохраняются постоянно в Supabase PostgreSQL базе данных! 🎯
