# Требования к доработке Newo CLI — по итогам тестирования PR #2076 (superagent)

- Дата: 2026-06-10
- Автор: muhammad.nuriddinov@newo.ai (анализ — Claude Code)
- Версия CLI, на которой выявлены пробелы: `newo` **3.7.1** (репозиторий: `github.com/sabbah13/newo-cli`)
- Контекст: при тестировании контекстного окна VibeFlow (PR #2076 superagent) штатных команд CLI не хватило, и пришлось писать ad-hoc Node-скрипты, импортирующие внутренности пакета (`dist/api.js`, `dist/env.js`) напрямую. Скрипты лежат в `superagent/.cache/*.mjs`. Цель этого документа — перенести эти сценарии в первоклассные команды CLI.

Все ссылки на код ниже — по установленному пакету `newo@3.7.1` (`dist/`), при реализации сверить с исходниками репозитория.

---

## Что УЖЕ есть в CLI (дублировать не нужно — проверено)

| Возможность | Как есть сейчас |
|---|---|
| Логи с фильтрами | `newo logs --flow <idn> --skill <idn> --event-id <external_event_id> --from/--to/--hours --per --page --json` (`dist/cli/commands/logs.js`) — покрыло почти все нужды анализа |
| Push модели/метаданных скилла | `newo push` умеет пушить metadata-изменения скилла, включая `model` (`dist/sync/push.js:427-432`), и публикует flow (`dist/sync/push.js:501`) — но только из pull-workspace `newo_customers/<idn>/...` |
| Sandbox-диалог | `newo sandbox "<msg>"` + продолжение через `--actor <id>` |

---

## R1. `newo sandbox`: выбор connector/integration (приоритет: HIGH)

**Проблема.** `findSandboxConnector()` берёт **первый** running-коннектор integration `sandbox`: `return sandboxConnectors[0]` (`dist/sandbox/chat.js:58`). На customer'е PR 2076 первым всегда оказывается `convo_agent_sandbox` (внешний AI Employee), поэтому достучаться до Vibe Builder (`VibeFlow`, событие `user_message` привязано к connector `vibe_agent`) из CLI **невозможно в принципе** — флага выбора нет (`dist/cli/commands/sandbox.js` парсит только `--actor`, `--customer`, `--quiet`, `--interactive`).

**Требование.**
```
newo sandbox "<msg>" --connector vibe_agent            # выбор connector_idn внутри integration sandbox
newo sandbox "<msg>" --integration sandbox --connector vibe_agent   # явная пара (default integration: sandbox)
newo sandbox --list-connectors                          # показать running-коннекторы, чтобы было что подставить
```
- Если указан `--connector`, фильтровать `listConnectors()` по `connector_idn` + `status === "running"`; если не найден — понятная ошибка со списком доступных.
- Без флага — текущее поведение (первый running), чтобы не сломать существующие сценарии.

**Acceptance:** `newo sandbox "ping" --connector vibe_agent` создаёт actor на vibe_agent и получает ответ VibeFlow (сейчас это делает только обходной скрипт `.cache/run_vibeflow_chunked_context_test.mjs`).

## R2. `newo sandbox`: длинные сообщения и машиночитаемый вывод (приоритет: HIGH)

**Проблема.** Тестовые сообщения были по 40 000–400 000 символов (кириллица). Передавать такое аргументом shell неудобно и хрупко. Ответа с большим контекстом агент ждёт дольше минуты, а в `dist/sandbox/chat.js` захардкожено `MAX_POLL_ATTEMPTS = 60` × `POLL_INTERVAL_MS = 1000` = максимум 60 секунд — длинные ходы VibeFlow (наблюдали 1–7 минут) отваливаются по таймауту опроса. Также CLI не печатает `external_event_id`, без которого нельзя сматчить ход с `newo logs --event-id`.

**Требование.**
```
newo sandbox --file ./chunk1.txt --actor <id> --connector vibe_agent
cat chunk1.txt | newo sandbox --stdin --actor <id>
newo sandbox "<msg>" --timeout 420        # сек, дефолт оставить 60
newo sandbox "<msg>" --json               # {actor_id, persona_id, external_event_id, response, elapsed_ms}
```
- `--json` обязан включать `external_event_id` ходов user и agent — это ключ корреляции с logs.

**Acceptance:** скрипт уровня `.cache/run_vibeflow_chunked_context_test.mjs` (маркер → N чанков по 50k → контрольный вопрос → сверка по logs) можно переписать обычным bash-циклом из `newo sandbox --file ... --json` + `newo logs --event-id ... --json`, без импорта `dist/api.js`.

## R3. Точечное изменение свойств скилла на платформе без pull-workspace (приоритет: MEDIUM)

**Проблема.** Чтобы временно переключить модель `VibeFlow/structured_generation` (gpt54 ↔ gemini25_pro), нужны были `updateSkill()` + `publishFlow()` из `dist/api.js` (скрипты `.cache/set_vibeflow_structured_generation_model.mjs`, `.cache/patch_get_memory_count.mjs`). Штатный путь — `newo pull` в layout `newo_customers/`, правка metadata-yaml, `newo push` — не подходит, когда работаешь из исходного репозитория проекта (superagent) и нужно поменять ровно одно поле, не затрагивая остальное (push зацепит все изменённые файлы).

**Требование.**
```
newo update-skill <skill-idn> --project <idn> --agent <idn> --flow <idn> \
    [--model <provider_idn>/<model_idn>] \
    [--script <file.nsl>] \
    [--publish] [--publish-description "<text>"]
newo get-skill <skill-idn> --project <idn> --agent <idn> --flow <idn> [--json]   # посмотреть текущее состояние (model, prompt_script)
```
- `--publish` вызывает `publishFlow` после обновления (как делает push); без него — только draft.
- `get-skill` нужен и для проверки «что сейчас живёт на платформе» (сейчас это `.cache/check_live.mjs` / `.cache/probe_get_memory_skill.mjs`).
- Вывести предупреждение, что изменение расходится с локальным workspace, если он есть.

**Acceptance:** сценарий «переключи модель → прогони тест → верни модель» выполняется двумя командами `newo update-skill ... --model ... --publish` без Node-скриптов.

## R4. `newo logs`: мелкие добивки (приоритет: LOW, nice-to-have)

Текущих фильтров почти хватило; не хватило только:
- `--name <ActionName>` — фильтр по `data.name` (например, только `Gen` или `GetMemory`); сейчас приходится тянуть `--json` и фильтровать jq/скриптом;
- в `--json`-выводе поле `data.source.model` уже есть — задокументировать в help, что модель хода надо брать оттуда (а не из имени актёра): на этом дважды ловились при анализе PR 2076.

---

## Сводка: какие ad-hoc скрипты закрывает каждое требование

| Скрипт в `superagent/.cache/` | Закрывается |
|---|---|
| `run_vibeflow_chunked_context_test.mjs`, `run_vibeflow_marker_limit_test.mjs` | R1 + R2 (+ существующий `logs`) |
| `set_vibeflow_structured_generation_model.mjs`, `patch_get_memory_count.mjs` | R3 |
| `check_live.mjs`, `probe_get_memory_skill.mjs` | R3 (`get-skill`) |

Порядок реализации: R1 → R2 → R3 → R4. R1+R2 — минимальный набор, после которого интеграционные тесты агентов (как в PR 2076) можно гонять чистым CLI.
