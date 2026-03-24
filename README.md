# Landline Bot

Telegram-бот для управления аналоговым модемом и открытия пропускных пунктов по DTMF/звонку.

Проект поддерживает:
- работу через serial-порт (`serialport`);
- fallback через HTTP API модема;
- SQLite-хранилище пользователей, групп и пунктов;
- админские команды с пошаговыми формами.

## Основные возможности

- Список доступных пропускных пунктов с фильтрацией по группам пользователя.
- Открытие пункта командой или кнопками.
- Произвольный вызов модема командой `/call`.
- Управление пользователями, группами и пунктами через команды админа.
- Режим модема `/mode` с ручным переключением `serial | fallback`.
- Авто-деградация на fallback при ошибках serial (порог + окно времени).

## Стек

- Node.js + TypeScript
- `node-telegram-bot-api`
- `serialport`
- `better-sqlite3`
- `axios`

## Переменные окружения

Обязательные:
- `BOT_TOKEN` — токен Telegram-бота.
- `BOT_ADMIN_USER_ID` — Telegram ID первичного администратора.

Модем:
- `MODEM_PATH` (default: `/dev/ttyACM0`)
- `MODEM_BAUD_RATE` (default: `9600`)
- `MODEM_FALLBACK_API_PATH` (default: `https://modem.ozdon.online/api/v1`)
- `MODEM_FALLBACK_API_TOKEN`

Прочее:
- `ENV_MODE` (`development` | `production`)
- `GATES_LIST` — сидирование пунктов при пустой БД.

Формат `GATES_LIST`:
- `gateId,title,groupId,phone1,phone2;gateId2,title2,groupId2,phone1`

Пример:
- `north_gate,North Gate,staff,+79990001122,+79990001123;parking,Parking,guests,+79990002233`

## Запуск

### Локально

```bash
yarn install
yarn build
yarn start
```

Для разработки:

```bash
yarn dev
```

### Docker (dev)

```bash
docker compose up --build
```

Используется `.env.dev`, БД монтируется в `./storage:/data`.

### Docker (prod)

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

Используется `.env.prod`, БД также хранится в volume `./storage:/data`.

## Команды бота

Базовые:
- `/start`
- `/gates`
- `/gates open <gate_id> [phone_index]`
- `/call <dial_sequence>`

Режим транспорта модема (только админ):
- `/mode` — показывает текущий режим и кнопки:
- `serial` — сброс ошибок и возврат к serial.
- `fallback` — принудительный fallback на 30 дней.

Админские CRUD-команды:
- Пользователи: `/add_user`, `/update_user`, `/delete_user`
- Пункты: `/add_gate`, `/update_gate`, `/delete_gate`
- Группы: `/add_group`, `/update_group`, `/delete_group`

Если аргументы не переданы, запускается пошаговая форма.

## Права и доступ

- Команды админки и `/mode` доступны только `admin`.
- При недостатке прав возвращается: `Error: Not enouth priveleges`.
- Для обычного списка пунктов доступ фильтруется по группам пользователя.
- Пользователь с группой `*` или `admin` видит все группы.

## База данных

Файл БД: `/data/landline.sqlite`.

Ключевые сущности:
- `users`
- `groups` (включая дефолтную `*`)
- `user_groups`
- `gates`
- `gate_phone_numbers`
- `modem_transport_state` (ошибки serial, fallback state, forced mode)

## Поведение fallback модема

- По умолчанию бот пытается работать через serial.
- При ошибках serial используется fallback API.
- На серии ошибок serial может включаться fallback как primary.
- По успешному serial ошибки сбрасываются.
- Для fallback выполняется `acquire -> at/send -> release`.

## Сборка и проверка

```bash
yarn build
```

Если сборка проходит, TypeScript-часть проекта консистентна.
