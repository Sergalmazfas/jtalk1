# JTalk1 — Онлайн-распознавание речи с разделением по голосам

JTalk1 — это веб-приложение, которое обеспечивает **распознавание речи в реальном времени** с разделением по колонкам: **владелец устройства (слева)** и **собеседник (справа)**. Проект основан на Google Cloud Speech-to-Text и работает **строго в режиме онлайн**, без сохранения аудио и задержек.

## Текущее состояние проекта

### Что работает:
- ✅ Базовое распознавание речи через Google Speech-to-Text
- ✅ Отображение промежуточных результатов (interim results) в бегущей строке
- ✅ Отображение финальных результатов в соответствующих колонках
- ✅ WebSocket соединение для передачи аудио в реальном времени
- ✅ Калибровка голоса владельца (базовая функциональность)
- ✅ Автоматическое восстановление соединения при разрывах
- ✅ Оптимизированная обработка аудио на клиенте

### В процессе доработки:
- 🔄 Стабилизация работы системы распознавания речи
- 🔄 Оптимизация определения голоса владельца/гостя
- 🔄 Улучшение обработки ошибок и восстановления после сбоев

## Архитектура проекта

### Диаграмма архитектуры

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Микрофон  │────▶│ AudioContext│────▶│  WebSocket  │────▶│ Google STT  │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                                                              │
                                                              ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Колонки    │◀────│  interimText│◀────│  WebSocket  │◀────│  Результаты │
│ owner/guest │     │     DOM     │     │  (клиент)   │     │ распознавания│
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

### Серверная часть (Node.js + TypeScript)
- **src/index.ts** — основной файл сервера, обрабатывает WebSocket соединения и управляет потоками распознавания речи
- **src/speakerService.ts** — сервис для определения голоса владельца (временно отключен для стабилизации)
- **scripts/extract_embedding.py** — Python скрипт для извлечения голосового отпечатка (используется для определения владельца)

### Клиентская часть (HTML + JavaScript)
- **public/index.html** — основной HTML файл с интерфейсом приложения
- **public/js/app.js** — клиентский JavaScript код для обработки аудио и взаимодействия с сервером

## Как работает система

### 1. Инициализация и калибровка
1. Пользователь открывает приложение в браузере
2. Устанавливается WebSocket соединение с сервером
3. Запрашивается доступ к микрофону
4. Выполняется калибровка голоса владельца (3 секунды записи)
5. После успешной калибровки начинается основной режим работы

### 2. Распознавание речи
1. Аудио захватывается через AudioContext API
2. Обрабатывается в ScriptProcessor с буфером 8192 сэмпла
3. Отправляется на сервер чанками каждые 500 мс
4. Сервер передает аудио в Google Speech-to-Text API
5. Промежуточные результаты отображаются в бегущей строке
6. Финальные результаты перемещаются в соответствующую колонку

### 3. Определение говорящего
- Временно отключено для стабилизации системы
- В будущем будет использовать сравнение голосовых отпечатков

## Интерфейс приложения

### 1. Бегущая строка (вверху)
- Отображает текущую распознаваемую речь в реальном времени
- Обновляется по мере поступления промежуточных результатов
- Очищается после завершения фразы

### 2. Колонки сообщений
- **Левая колонка** — сообщения владельца устройства
- **Правая колонка** — сообщения гостя/собеседника
- Каждая колонка имеет индикатор активности говорящего

### 3. Индикаторы состояния
- Индикатор записи (красная точка) — показывает, что микрофон активен
- Индикаторы говорящего — показывают, кто сейчас говорит (временно отключено)

## WebSocket сообщения

| Тип сообщения | Направление | Описание |
|---------------|-------------|----------|
| `ping` | client → server | Сообщение для поддержания соединения |
| `pong` | server → client | Ответ на ping |
| `calibrate` | client → server | Калибровка голоса владельца |
| `calibrated` | server → client | Подтверждение завершения калибровки |
| `audio` | client → server | Аудио чанки (PCM) |
| `transcript` | server → client | Промежуточный или финальный текст |
| `speaker` | server → client | Определение говорящего (временно отключено) |
| `error` | server → client | Сообщение об ошибке |

## Пример логов

### Клиентская часть
```
[WS] WebSocket connected
[CALIBRATION] Starting calibration...
[CALIBRATION] Microphone access granted
[CALIBRATION] Recording completed, sending data...
[CALIBRATION] Calibration completed
[RECORDING] Starting recording...
[CHUNK] Audio chunk sent (8192 bytes)
[CHUNK] Audio chunk sent (8192 bytes)
[WS] Received transcript: "привет как дела" (interim)
[WS] Received transcript: "Привет, как дела?" (final)
[WS] Connection lost, attempting to reconnect...
[WS] WebSocket reconnected
```

### Серверная часть
```
Server is running on port 8085
New client connected, ID: 1yqwjgtenb7
Creating new recognition stream for connection 1yqwjgtenb7
Received message from connection 1yqwjgtenb7, type: calibrate
Received calibration data from connection 1yqwjgtenb7, length: 45056
Saving owner voice, audio length: 45056
Extracted voice embedding, length: 256
Owner voice saved to /Users/seregaboss/Desktop/jtalk1/data/owner_voice.json
Received message from connection 1yqwjgtenb7, type: audio
Received audio data from connection 1yqwjgtenb7, length: 6144, timestamp: 1744041743072
Successfully wrote audio data to STT stream for connection 1yqwjgtenb7, size: 12288 bytes
Received data from Speech-to-Text for connection 1yqwjgtenb7: "привет как дела"
Received data from Speech-to-Text for connection 1yqwjgtenb7: "Привет, как дела?"
Client disconnected, ID: 1yqwjgtenb7
Cleaning up resources for connection 1yqwjgtenb7
```

## Технические детали

### Аудио обработка
- Формат: LINEAR16 (16-bit PCM)
- Частота дискретизации: 16 кГц
- Каналы: моно
- Размер буфера: 8192 сэмпла
- Интервал отправки чанков: 500 мс

### WebSocket соединение
- Протокол: ws://
- Пинг каждые 15 секунд для поддержания соединения
- Автоматическое переподключение при разрывах (до 5 попыток)
- Экспоненциальная задержка между попытками переподключения

### Ресурсы и оптимизация
- Периодическая очистка неактивных соединений (каждые 5 минут)
- Таймаут соединения: 10 минут неактивности
- Пропуск тихих аудио чанков для снижения нагрузки
- Буферизация аудио при ошибках соединения

## Запуск проекта

### Требования
- Node.js 14+
- Python 3.7+ (для скрипта extract_embedding.py)
- Google Cloud Speech-to-Text API ключ

### Установка и запуск
```bash
# Установка зависимостей
npm install

# Запуск сервера
npm run dev
```

### Доступ к приложению
- Откройте браузер и перейдите по адресу: http://localhost:8085
- Разрешите доступ к микрофону при запросе
- Выполните калибровку голоса (3 секунды)
- Начните говорить для распознавания

## Известные проблемы и ограничения

1. **Стабильность распознавания**
   - Система может зависать при длительной работе
   - Временное решение: перезапуск сервера

2. **Определение голоса**
   - Функция определения владельца/гостя временно отключена
   - Будет восстановлена после стабилизации базового распознавания

3. **Производительность**
   - Высокая нагрузка на CPU при обработке аудио
   - Возможны задержки на слабых устройствах

## Частые проблемы и решения (Troubleshooting)

### 1. Нет текста после калибровки
**Возможные причины:**
- Аудио не отправляется (проверь консоль: [CHUNK])
- Сервер не пишет в поток Google STT
- DOM не обновляется (interim-text скрыт)

**Решения:**
- Перезапустите сервер (`npm run dev`)
- Проверьте WebSocket-сообщения в консоли (`[WS message]`)
- Убедитесь, что interimText имеет класс `.visible`

### 2. Ошибка "Failed to connect to WebSocket"
**Возможные причины:**
- Сервер не запущен
- Порт 8085 занят другим приложением
- Проблемы с сетевым подключением

**Решения:**
- Убедитесь, что сервер запущен (`npm run dev`)
- Проверьте, не занят ли порт 8085 (`lsof -i :8085`)
- Перезапустите браузер и попробуйте снова

### 3. Калибровка не завершается
**Возможные причины:**
- Недостаточно громкая речь во время калибровки
- Проблемы с доступом к микрофону
- Ошибка при сохранении голосового отпечатка

**Решения:**
- Говорите громче во время калибровки
- Проверьте настройки доступа к микрофону в браузере
- Проверьте права доступа к директории `data/`

### 4. Система зависает при длительной работе
**Возможные причины:**
- Утечка памяти в WebSocket соединениях
- Перегрузка сервера из-за частых аудио чанков
- Проблемы с Google Speech-to-Text API

**Решения:**
- Перезапустите сервер каждые 30-60 минут
- Увеличьте интервал отправки аудио чанков (измените `chunkInterval` в `app.js`)
- Проверьте квоты и статус Google Speech-to-Text API

## Сценарии тестирования (Manual QA checklist)

### Чеклист для тестирования

- [ ] При загрузке открывается окно калибровки
- [ ] После 3 сек — начинается распознавание
- [ ] Interim текст отображается вверху
- [ ] Final текст уходит в колонку владельца или гостя
- [ ] Пропадание интернета → авто-переподключение
- [ ] Interim очищается после фиксации фразы

### Тестирование калибровки
- [ ] Калибровка начинается автоматически при загрузке
- [ ] Индикатор записи активен во время калибровки
- [ ] После завершения калибровки начинается распознавание
- [ ] При ошибке калибровки можно повторить процесс

### Тестирование распознавания речи
- [ ] Речь распознается с минимальной задержкой
- [ ] Промежуточный текст отображается в бегущей строке
- [ ] Финальный текст перемещается в соответствующую колонку
- [ ] Бегущая строка очищается после завершения фразы

### Тестирование устойчивости
- [ ] При потере соединения происходит автоматическое переподключение
- [ ] После восстановления соединения распознавание продолжается
- [ ] Система стабильно работает при длительном использовании
- [ ] Перезапуск сервера не требует перезагрузки страницы

## Планы по улучшению

1. **Краткосрочные задачи**
   - Стабилизация работы распознавания речи
   - Оптимизация обработки аудио
   - Улучшение обработки ошибок

2. **Среднесрочные задачи**
   - Восстановление функции определения голоса
   - Добавление подсказок и рекомендаций
   - Улучшение UI/UX

3. **Долгосрочные задачи**
   - Интеграция с Google Vertex AI
   - Добавление поддержки других языков
   - Расширение функциональности для групповых бесед

# TalkHint Project

## Security Guidelines

### Environment Variables and Secrets
- Never commit `.env` files or any files containing secrets
- Use `.env.example` as a template for required environment variables
- Store production secrets in Google Cloud Secret Manager
- Rotate secrets regularly
- Use different secrets for development and production environments

### GitHub Security
- Never commit credentials or API keys
- Use `.gitignore` to prevent accidental commits of sensitive files
- Review all commits before pushing
- Use branch protection rules
- Enable two-factor authentication for GitHub accounts

### Google Cloud Security
- Store service account keys securely
- Use minimal IAM permissions
- Enable audit logging
- Regularly review service account permissions
- Use Secret Manager for sensitive data

## Setup Instructions

1. Clone the repository:
   ```bash
   git clone https://github.com/your-org/talkhint.git
   cd talkhint
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   - Copy `.env.example` to `.env`
   - Fill in the required values
   - Never commit `.env` file

4. Set up Google Cloud:
   - Create a new project in Google Cloud Console
   - Enable required APIs
   - Create service account and download key
   - Store key securely (not in repository)

5. Set up secrets in Google Cloud Secret Manager:
   ```bash
   # Example commands for setting up secrets
   gcloud secrets create TWILIO_AUTH_TOKEN --replication-policy="automatic"
   gcloud secrets versions add TWILIO_AUTH_TOKEN --data-file="/path/to/secret.txt"
   ```

## Development Workflow

1. Create a new branch for your feature:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make changes and test locally

3. Commit changes:
   ```bash
   git add .
   git commit -m "Description of changes"
   ```

4. Push to GitHub:
   ```bash
   git push origin feature/your-feature-name
   ```

5. Create a Pull Request

## Deployment

1. Ensure all tests pass
2. Review security implications
3. Deploy to Google Cloud Run:
   ```bash
   gcloud run deploy talkhint --source .
   ```

## Security Checklist

- [ ] No secrets in code or configuration files
- [ ] Environment variables properly set
- [ ] Google Cloud permissions reviewed
- [ ] Service account keys secured
- [ ] Dependencies updated and secure
- [ ] Security headers configured
- [ ] SSL/TLS enabled
- [ ] Regular security audits scheduled

## Contact

For security concerns, please contact the security team at security@your-org.com

```bash
npm install
npm run dev---

Если всё готово — вставь этот текст в `README.md`, потом выполни:

```bash
git add README.md
git commit -m "feat: Обновлен README под новую структуру jtalk1"
git push -u origin main
