# 🚀 Инструкция по деплою на Vercel

## Проблема
После деплоя frontend работает, но при добавлении игроков возникает ошибка `NOT_FOUND`, потому что backend сервер не задеплоен.

## Решение
Проект теперь адаптирован для Vercel Serverless Functions.

## 📋 Шаги для деплоя

### 1. Установите Vercel CLI (если еще не установлен)

```bash
npm install -g vercel
```

### 2. Войдите в Vercel

```bash
vercel login
```

### 3. Задеплойте проект

Из папки `my-archery-app`:

```bash
vercel
```

При первом деплое Vercel спросит:
- **Set up and deploy?** → Yes
- **Which scope?** → Выберите свой аккаунт
- **Link to existing project?** → No
- **Project name?** → archery-tournament (или свое название)
- **Directory?** → ./ (текущая директория)
- **Override settings?** → No

### 4. Production деплой

После успешного тестового деплоя:

```bash
vercel --prod
```

## 🔧 Что изменилось

### Добавлены serverless функции:
- `api/health.mjs` - проверка работы API
- `api/state.mjs` - получение/обновление состояния турнира
- `api/register-player.mjs` - регистрация игроков

### Добавлен `vercel.json`:
Конфигурация для правильной маршрутизации запросов

### ⚠️ Важно:
Данные хранятся в `/tmp/` на Vercel, что означает:
- Данные временные и могут быть удалены при перезапуске функции
- Для production рекомендуется использовать базу данных (MongoDB, PostgreSQL, Supabase)

## 🗄️ Переход на постоянное хранилище (опционально)

Для production рекомендуется использовать:

### Вариант 1: Vercel KV (Redis)
```bash
npm install @vercel/kv
```

### Вариант 2: Supabase (PostgreSQL)
```bash
npm install @supabase/supabase-js
```

### Вариант 3: MongoDB Atlas
```bash
npm install mongodb
```

## 📝 После деплоя

1. Откройте URL, который выдаст Vercel (например, `https://your-app.vercel.app`)
2. Перейдите в админ-панель: `https://your-app.vercel.app/admin/`
3. Попробуйте добавить игрока - теперь должно работать!

## 🐛 Отладка

Если что-то не работает:

1. Проверьте логи в Vercel Dashboard
2. Откройте DevTools (F12) → Console для просмотра ошибок
3. Проверьте, что API endpoints доступны:
   - `https://your-app.vercel.app/api/health`
   - `https://your-app.vercel.app/api/state`

## 🔄 Обновление после изменений

```bash
git add .
git commit -m "Ваше сообщение"
git push

# Или напрямую через Vercel
vercel --prod
```

Vercel автоматически задеплоит изменения при push в GitHub (если настроена интеграция).
