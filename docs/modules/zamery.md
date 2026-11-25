# Модуль: Замеры и InBody

Чат в claude.ai: «Замеры» · Файл: `docs/modules/zamery.md`

## Назначение
Замеры тела клиентов, InBody-тесты (CSV и скан QR с листа InBody 270), скрытый отчёт клиента с фигурой (карточка клиента), ссылка для клиента `/r/:token`. Результаты студии и ТВ — см. [tv.md](tv.md).

## Где код
- `kviz/client/src/pages/measure/NewMeasurePage.tsx` — новый замер тела
- `kviz/client/src/pages/measure/MeasureLayout.tsx` — обёртка страниц замеров (вкладки: Новый замер / InBody)
- `kviz/client/src/pages/measure/InBodyScanPage.tsx` — быстрое сканирование InBody без контекста клиента; после сохранения ищет клиента по phone_digits и навигирует
- `kviz/client/src/pages/measure/InBodyImportPage.tsx` — импорт InBody CSV (admin)
- `kviz/client/src/pages/measure/ClientPage.tsx` — страница результатов клиента: фигура, зоны, «потеряно со старта»
- `kviz/client/src/pages/measure/SharePage.tsx` — публичная страница результатов (без входа, по внутреннему ID)
- `kviz/client/src/pages/measure/PrintPage.tsx` — печать бланка замера
- `kviz/client/src/lib/useQrCamera.ts` — React-хук: камера + jsQR-скан (5 fps, 200 мс таймер), колбэк `onQr(ibData)` при попадании InBody QR
- `src/http/measure.ts` — API `/kviz/api/measure/*`: замеры, расчёт изменений, сводка «потеряно со старта»
- `src/http/inbody.ts` — API `/kviz/api/inbody/*`: импорт CSV, тесты, расчёт параметров, результаты студии

## Таблицы
- замеры тела — (`measure_no` ставит триггер, `total_cm` — генерируемая колонка)
- `inbody_tests` — тесты InBody (CSV + сканы; связь с клиентом через `phone_digits`)
- `fitbase_clients_cache` — клиенты для поиска
- `studio_results`, `studio_settings` — результаты студии для ТВ, см. [tv.md](tv.md)

## Ключевые решения
- **Мобильная версия — сразу в каждой задаче (04.11.2026).** Любой новый или изменённый экран сразу верстается под телефон (≤640), планшет и компьютер; задача без мобильной вёрстки не считается выполненной. Проверка `npm run check:mobile`, скриншоты 375 и 1440 в отчёте.
- Во вкладке «Замеры» остаётся только «Новый замер». Отчёты по замерам и InBody — во вкладке «Отчёты» (колонка «Клиенты»).
- Вес берём только из InBody; поле веса в замерах тела убрано (колонку в базе не трогаем). «Потеряно со старта»: кг и жир — первый vs последний InBody, см — из замеров; нет данных — «—»; отрицательное не показываем.
- Фигура и клики по зонам работают, если есть любые данные (замеры ИЛИ InBody); попап зоны — сегменты InBody + замеры зоны.
- Результаты студии (ТВ) — правила хранения, защита, логика потерь: см. [tv.md](tv.md).
- После нового замера/скана экран результата остаётся (отправить в Fitbase, копировать) + «Перейти в отчёт».
- Внешняя ссылка на результаты клиента по внутреннему ID, без входа.
- `inbody_tests` не имеет `client_id` — связь только через `phone_digits`.
- Фото листа InBody распознаётся целиком в браузере (`qrFromImage.ts`): EXIF-поворот, ресайз 2000px, BarcodeDetector → jsQR; фото никуда не отправляется и не сохраняется, на сервер уходят только распознанные цифры (как при ручном вводе).
- Координаты печати бланка (% от A4): имя — x=36, y=12.3 (anchor=left), шрифт 15/13/11 по длине; дата ДО x=20.8 y=25.4; дата ПОСЛЕ x=79.5 y=25.4; замеры x_до=29.7, x_после=88.5.

## Мобильная версия
Задача 34 (04.11.2026):
- `NewMeasurePage`: форма зон (`FIELDS`) рендерится в 1 колонку на телефоне — inline-стили без фиксированной сетки. Поиск и выбор клиента занимают полную ширину.
- `ClientPage` (страница клиента с фигурой): SVG-фигура занимает 100% ширины, точки зон адаптивны по % координатам. На телефоне панель зоны — нативный нижний блок.
- `PrintPage`, `SharePage`, `InBodyImportPage` — mobile-first вёрстка без горизонтального скролла.
- **Не сделано в задаче 34**: InBodyDialog full-screen на мобиле; bottom-sheet панель зоны в ClientPage — отложено.

## Сделано
### 25.11.2026 · task 95 · QR — висцеральный жир из позиции 150, префикс IBData

- **kviz/client/src/utils/inbody.ts**: `vfl` теперь из `data.slice(150, 154)` (4 цифры сразу после норм ВИР, bc-смещение 127); формула `Math.floor(parseInt / 100)` — деление на 100, округление вниз; в `selfCheck` добавлена проверка `vfl=4` для SAMPLE ("фон 8 на листе" = верхняя граница нормы, не само значение).
- **parseInBody**: перед парсингом отрезает префикс `IBData=` (строки вида `https://qrcode.inbody.com/?IBData=270-...` теперь корректно разбираются).

**Правило:** VFL в InBody QR — `data.slice(150, 154)`, делить на 100, `Math.floor`. Позиция: bc (data.slice(23)) смещение 127, сразу после двух норм ВИР (4 цифры на каждую).

### 23.11.2026 · 2680116 · task 85 — связка body_clients ↔ crm_clients, UI в Настройках
- `body_clients` получила колонки `crm_client_id uuid references crm_clients` и `crm_link_method text check in ('fitbase_id','phone','manual')`.
- `src/jobs/fitbaseHistoryImport.ts`: `linkBodyClients()` — автосвязка по `fitbase_client_id`, затем по последним 10 цифрам телефона (только уникальное совпадение); не перезаписывает `crm_link_method='manual'`; `getLinkStats()` — счётчики (linked, no_crm_pair, disputed).
- `src/http/crm.ts`: новые эндпоинты `GET /kviz/api/crm/inbody-link-stats`, `POST /kviz/api/crm/inbody-link-auto`, `POST /kviz/api/crm/body-clients/:id/link`, `POST /kviz/api/crm/body-clients/:id/unlink`.
- `kviz/client/src/pages/crm/SettingsPage.tsx`: в разделе «Данные InBody» — счётчики связей (linked/disputed/no_crm_pair), список спорных записей, кнопки «Автосвязь», ручная привязка/отвязка.
- Нightly-импорт вызывает `linkBodyClients()` автоматически.

### 20.11.2026 · task 77 · карточка клиента — NormBar без нормы показывает значение; Row dp-пропс; Минералы 2 знака

- **ClientPage.tsx** `NormBar`: если норма отсутствует (`lo/hi == null`), показывает значение числом без полосы (раньше ставил `—`).
- **ClientPage.tsx** `Row`: добавлен проп `dp?: number`, применяется к `.toFixed()` значения и норм (было жёстко `1`).
- **ClientPage.tsx** строка Минералы: `dp={2}` — отображает 3.86, а не 3.9.

### 20.11.2026 · a4f0d34 · task 76 · QR — висцеральный жир, нормы воды/белка/минералов, ИСМ 1 знак

- **kviz/client/src/utils/inbody.ts**: `vfl` из `data[228..231]`; `g4f` исправлен для divisor≥100 (2 знака вместо 1 — фикс pre-existing бага `minerals = 3.9 → 3.86`; SAMPLE теперь PASS).
- **src/http/inbody.ts**: `vfl` в `InBodyRow` и `data`; добавлены `protein_min/max`, `minerals_min/max`, `tbw_min/max`.
- **ClientPage.tsx**: `smi.toFixed(1)` вместо `toFixed(0)`.

### 20.11.2026 · c27f8e8 · task 75 · QR — нормы ИМТ/%жира/безжировой/BMR, ИСМ, ккал, делители сегментов

- **kviz/client/src/utils/inbody.ts**: tail-парсер переписан на `tg(i, div)` + `seg(base, divs[])`. Нормы: `bmi_min/max` (tail 0,4), `pbf_min/max` (tail 12,16), `ffm_min/max` (tail 115,119), `bmr_min/max` (tail 123,127), `smi` (tail 105). `recommended_kcal` из `data[160..163]`. Делители сегментов: lean trunk ÷10 (20.6), fat все ÷10; % безжир ÷10 (позиции 60–79); % жир ÷10 по позициям 81,86,91,96,101. `fat_by_segment.trunk` SAMPLE: 0.47 → 4.7 (исправление ÷100→÷10). `lean_norm` = `[ffm_min, ffm_max]`.
- **src/http/inbody.ts**: в data QR добавлены `bmi_min/max`, `pbf_min/max`, `smi`, `recommended_kcal`, `bmr_min/max`.

### 20.11.2026 · ab82712 · task 74 · QR-парсер: блок контроля `!0000`; QR data — ключи CSV

- **kviz/client/src/utils/inbody.ts**: регулярка блока контроля `/^([+-]\d{4})([+-]\d{4})([+-]\d{4})/` → `/^([+-]\d{4})([+-]\d{4})([+!\-]\d{4})/`. Символ `!` перед `0000` совпадает; `sign4` не менялся (`!` трактуется как `+`, значение 0). Это устраняло сдвиг BMR на −19 и WHR на 0.02.
- **src/http/inbody.ts** `POST /kviz/api/inbody/qr`: в `data` добавлены ключи, которые читает ClientPage: `target_weight`, `weight_control`, `bfm_control`, `ffm_control`, `obesity_degree`; поля, которые QR не разбирает, пишутся явно как `null` (`vfl`, `inbody_score`, `recommended_kcal`, `abdomen_circumference`).

### 20.11.2026 · ce1786f · task 73 · сохранять сырую строку QR в inbody_tests.raw_qr

- Колонка `inbody_tests.raw_qr` (text, nullable) добавлена Сергеем в Supabase.
- `src/http/inbody.ts`: в `InBodyRow` добавлено поле `raw_qr?: string | null`; в обработчике `POST /kviz/api/inbody/qr` значение берётся из `ib.raw` (поле `raw` объекта `InBodyData`, который клиент уже отправлял в составе `inbody`). Клиентский код (`InBodyScanPage.tsx`, `ClientPage.tsx`) не менялся — `parsed.raw` уже шёл на сервер.
- Если `raw` пустой или отсутствует → `raw_qr = null`, запрос не падает.
- CSV-импорт и колонка `raw` у CSV-тестов не затронуты.

### 18.11.2026 · 8f16595 · task 67 · проверка путей TV-пересчёта + 5 новых тестов calcLosses

- **Пути recalcStudioResultForClient подтверждены** (код не менялся): measure.ts:515 (POST /measure/measurements), inbody.ts:146 (POST /inbody/qr), inbody.ts:259 (POST /inbody/csv-import, fire-and-forget), inbody.ts:373 (POST /inbody/recalculate, fire-and-forget), inbody.ts:501 (POST /inbody/link-to-client) — все 5 путей присутствуют.
- **studioResults.test.ts**: добавлено 5 тестов `calcLosses` — cm only (kgLost=0, fatKgLost=null), kg only (нет замеров — cmLost=0), fat only (вес одинаков, жир уменьшился), all metrics grew (cmLost=0, kgLost=0), mixed (cm fell weight rose → cmLost>0, kgLost=0). Итого 12 тестов, все проходят.

### 17.11.2026 · c99b29c · task 61 · две кнопки-карточки вместо подвкладок + авто-отправка студии

- **MeasureLayout.tsx**: вместо sub-tabs — landing с двумя карточками-кнопками; карточки navigate через `?section=measure|inbody`; `isLanding = pathname === '/measure' && !section`; в non-landing режиме — шапка с «← Назад» к `/measure`; `active` prop оставлен для обратной совместимости (не используется).
- **App.tsx**: добавлен `MeasureLandingPage` (читает `?section`, рендерит `NewMeasurePage` / `InBodyScanPage` / `<MeasureLayout />`); маршрут `/measure` теперь рендерит `<RequireAuth><MeasureLandingPage /></RequireAuth>` вместо редиректа на `/measure/new`.
- **shell-app.js**: `TAB_HOME.measure` и оба места создания iframe — `/kviz/measure/new` → `/kviz/measure`.
- **index.css**: `.measure-subtab` → `.measure-home` + `.measure-card` (glassmorphism, десктоп рядом, мобиле — строчки). Брейкпоинты ≤640px.
- **measure.ts**: добавлены `calcLosses(measurements, ibTests)` (экспортируется, тестируема) и `recalcStudioResultForClient(clientId, sentBy)`: если все потери ≤ 0 — удаляет из `studio_results` + tvNotify; иначе — upsert + tvNotify; не бросает исключений, возвращает `{ action, error? }`. `POST /kviz/api/measure/measurements` теперь вызывает `recalcStudioResultForClient` и добавляет `studioWarning` в ответ если ошибка.
- **inbody.ts**: импортирует `recalcStudioResultForClient`; `POST /inbody/qr` — ищет клиента по `phone_digits`, вызывает recalc; `POST /inbody/link-to-client` — recalc после привязки; `POST /inbody/csv-import` и `POST /inbody/recalculate` — fire-and-forget recalc для затронутых клиентов.
- **NewMeasurePage.tsx** / **InBodyScanPage.tsx**: показывают `studioWarning` из ответа сервера (жёлтый блок-предупреждение).
- **studioResults.test.ts**: 7 тестов `calcLosses`; `package.json test` обновлён (18 тестов всего).

### 16.11.2026 · (task 57) · фикс доступа к отчёту по InBody для сотрудников
- **manager.ts**: убран `role !== 'admin'` из префикс-guard `/kviz/api/reports` (остался только 401); `/kviz/api/reports/tasks` и `/kviz/api/reports/studio` получили явный `requireAdmin`; `/kviz/api/reports/inbody` теперь проверяет `requirePerm(..., 'reports.inbody', 'view', session)` через `getSessionWithPerms`.
- **ReportsPage.tsx**: `InBodySection` — добавлен стейт `fetchError`; при 403 → «Нет доступа», при других ошибках → «Ошибка загрузки»; «Пока нет тестов InBody» — только при 200 с пустым списком.

### 16.11.2026 · (текущий) · task 55 — парсер InBody v2, хук камеры, кнопка InBody в замерах

- **inbody.ts (парсер)**: regex телефона `([78]\d{10})` (11 цифр), убран мёртвый код `afterHeader`; позиция после `!` вычисляется правильно.
- **qrFromImage.ts**: `extractIBData` через regex вместо URLSearchParams ('+' в данных QR не теряется).
- **useQrCamera.ts** (новый, `kviz/client/src/lib/`): хук с `cameraActive`, `videoRef`, `canvasRef`, `startCamera`, `stopCamera`, `cameraErr`; вызывает `onQr(ibData)` при успешном QR; cleanup при unmount.
- **ClientPage.tsx / InBodyDialog**: камерная логика заменена на `useQrCamera(tryParse)`; ошибки камеры через `cameraErr`; убраны `streamRef`, `scanTimerRef`, `rafRef`, `scheduleScan`, `scanFrame` — 60 строк минус.
- **MeasureLayout.tsx**: добавлена вкладка «InBody» → `/measure/inbody`; активная вкладка подсвечивается по pathname.
- **InBodyScanPage.tsx** (новый): страница `/measure/inbody`; использует `useQrCamera`; после сохранения ищет `body_clients` по digits телефона из QR и навигирует на страницу клиента.
- **App.tsx**: добавлен маршрут `/measure/inbody`.
- **src/http/inbody.ts**: POST `/kviz/api/inbody/qr` принимает `client_id`; если передан — берёт `phone` из `body_clients` и использует его вместо телефона из QR, обеспечивая правильную привязку.
- **Проверка колонок**: `body_clients.{phone,phone_digits}`, `inbody_tests.{phone,phone_digits,inbody_id,source}` — все есть; `inbody_tests.client_id` — нет (ожидаемо).

### 16.11.2026 · afd8e36 · task 54 — печать с животом, фикс InBody на публичной ссылке, новая страница результатов

- **PrintPage + bodyr.png**: новый бланк 11 пунктов (добавлен «Живот» строка 6), координаты y пересчитаны: neck 34.0 → shin_r 75.25, шаг 4.12.
- **Фикс InBody на /r/:token** (`src/http/kviz.ts`): `body_clients` теперь выбирается вместе с `phone_digits`; `inbody_tests` выбираются по `.eq('phone_digits', client.phone_digits)` вместо несуществующего `client_id`; ошибки логируются через `console.error`; из select убраны `id`, `data`, `inbody_score` (не должны утекать наружу).
- **Новая SharePage** (`kviz/client/src/pages/measure/SharePage.tsx`): шапка с именем и датами ДО/ПОСЛЕ; герой −X см / −X кг / −X кг жира (≤0 → «—»); 3 вкладки с sticky-переключателем; «Фигура» — два силуэта body.png с цветными бейджами (зелёный = убыль, тап = значение), на мобиле — переключатель До/После; «Замеры» — таблица (десктоп) / карточки (мобиле) 11 зон; «InBody» — карточки первого и последнего теста со стрелками, график при ≥3 тестах; футер; публичных данных (телефон, ID, консультант) нет.

### 04.11.2026 · 148766d…62c0188 · task 35 — camera fix, barcode-detector, ClientPage mobile

- **Part 7 (camera fix)**: `ClientPage.tsx` — video всегда в DOM (не под cameraActive), `loadedmetadata` event перед сканированием, 5fps throttle (200ms setTimeout), `scanTimerRef` cleanup в `stopCamera`. Статический `import jsQR`.
- **Part 9 (admin diag)**: `handlePhotoFile` — при QR не найден: admin видит размер фото, BarcodeDetector result, первые 60 chars найденного QR. `isAdmin` стейт → fetch `/kviz/api/me`. `InBodyDialog` полноэкранный ≤640px через `.inbody-dialog-modal` CSS класс.
- **Part 8 (barcode-detector)**: установлен `barcode-detector@3.2.3` (zxing-wasm); `zxing_reader.wasm` → `kviz/client/public/`; `qrFromImage.ts` перезаписан: `prepareZXingModule` (WASM с собственного хоста), native BarcodeDetector → polyfill → jsQR, квадранты кропятся из оригинального bitmap при ~1600px (не из 2000px скейла), таймаут 8с.
- **Part 4 (ClientPage mobile)**: numbered points (`body-callout-num`), `ZoneList` компонент ниже фигуры, sticky `.client-mini-nav` (Итог/Фигура/График/Замеры/InBody), section IDs. CSS ≤640px: callout → маленький круг с цифрой, `zone-list-mobile`.

### 04.11.2026 · (текущий) · камера в iframe, фото InBody, PrintPage координаты

- `public/shell-app.js`: `allow="camera; clipboard-write"` у всех iframe /kviz/* (lazyIframe + measure + reports inline).
- `kviz/client/src/lib/qrFromImage.ts` (новый): `extractIBData`, `qrFromImage(file)` — распознаёт InBody QR из фото; ресайз до 2000px + EXIF-поворот; BarcodeDetector (Android Chrome) → jsQR по всему кадру, четвертям с перекрытием 15%, верхней половине; шкалы 1/0.75/0.5; grayscale+contrast; таймаут 4 с; bitmap/canvas освобождается внутри; на сервер уходят только цифры.
- `ClientPage.tsx`: 3 кнопки в InBodyDialog (📸 Сфотографировать, 📷 Сканировать камерой, 📂 Из галереи); ошибки getUserMedia по-русски (NotAllowedError / NotFoundError / иначе); спиннер «Ищу QR» + «QR не найден / Ещё раз»; `extractIBData` перенесена в lib/qrFromImage.ts; кнопка `📷 Скан InBody` → `📷 InBody по QR` (фикс «двух кнопок InBody»).
- `PrintPage.tsx`: fontFamily `"'Arial"` → `"Arial, sans-serif"`; имя — `anchor="left"`, x=36, y=12.3, размер шрифта 15→13→11 по длине; дата ДО x=20.8 y=25.4; дата ПОСЛЕ x=79.5 y=25.4.

### до 28.10.2026 · b8435e1 · вес из InBody, фигура без замеров, сброс вкладки
- Убрано поле веса из формы замеров; вес только из InBody.
- Фигура и результаты клиента доступны при любых данных (замеры или InBody).
- Повторный клик по активной вкладке = возврат на начальный экран.

### до 28.10.2026 · c7cb5ae · скрытый отчёт клиента /reports/client/:id
- Скрытая страница клиента с фигурой и результатами (только по ссылке). Выгрузка результатов в студийный общий — см. [tv.md](tv.md).

### до 28.10.2026 · 443e6bd · отчёты замеров и InBody
- Колонка «Клиенты» в Отчётах (список замеров, список InBody, результаты студии).

### до 28.10.2026 · 3905f22 · InBody CSV-парсер, полный лист, зум зон
- Импорт InBody CSV, расчёт параметров, полный лист замера, попап зоны с зумом.

## Открытые баги
- **QR-парсер не читает**: норма мышц (smm_min/max, эталон 21.4–26.2), окружность живота (abdomen_circumference, не на листе 20.11). Пишутся `null`.

## Следующее
- **Выжимка в карточке клиента CRM (23.11.2026, ТЗ не собирать до команды):** InBody и замеры тела уже есть — новые разделы НЕ делать. В левой части карточки клиента (crm-core) короткий блок по данным этого модуля:
  - последний InBody: дата + главные цифры (вес, % жира, жир кг, мышцы кг) и изменение к прошлому тесту
  - последний замер тела: дата + сумма обхватов и изменение со старта
  - таймер 7 дней до следующего замера/InBody (от последней даты): сколько дней осталось; когда срок подходит (≤ 2 дня) — подсветка, просрочено — красным «просрочено на N дн.»
  - клик по блоку → отчёт клиента (замеры + InBody)
- **ClientPage mobile дополнения (записано 04.11):** zone-detail как bottom-sheet на мобиле; попап зоны по нажатию на строку списка — проверить на реальном телефоне.
- Проверить SharePage на реальном устройстве 375 px и клиенте с InBody.
- Прогноз по зонам (примерный, проверить).
- Решить, нужен ли InBody пятым «аппаратом» в расписании CRM.
- InBodyScanPage: протестировать на реальном листе InBody.
