/* phrases.js — speech bubble text pools */
(function () {
  'use strict';

  var POOLS = {
    move: [
      'Готово — следующий этап',
      'Карточка переехала',
      'Воронка в порядке',
      'Перенёс — работаем',
      'Этап закрыт, двигаемся',
    ],
    task: [
      'Задача поставлена',
      'Звонок назначен',
      'Менеджер в курсе',
      'Задача — есть',
      'Поставил звонок',
    ],
    new_lead: [
      'Новая заявка!',
      'Свежий лид пришёл',
      'Есть контакт!',
      'Новенький в воронке',
      'Заявка — обработаю',
    ],
    error: [
      'Что-то пошло не так',
      'Fitbase капризничает…',
      'Ошибка, проверяю',
      'Сбой — разбираюсь',
      'Упс, неудача',
    ],
    confused: [
      'Давно не запускали…',
      'Меня точно включили?',
      'Жду прогона…',
      'Тишина подозрительная',
    ],
    idle: [
      'Кофе — и за работу',
      'Всё под контролем',
      'Пробные в порядке',
      'Воронка чистая',
      'Работаю, не волнуйся',
      'Всё по расписанию',
    ],
    sleep: [
      'Zzz… до утра',
      'Ночной режим',
      'Сплю, не трогать',
    ],
  };

  // Per-type rotation cursors (no repeat in a row)
  var cursors = {};
  var lastPicked = {};

  function getPhrase(type, stageName) {
    var pool = POOLS[type] || POOLS.idle;
    if (cursors[type] === undefined) cursors[type] = 0;

    // Build candidate (avoid last picked)
    var idx = cursors[type] % pool.length;
    if (pool[idx] === lastPicked[type] && pool.length > 1) {
      idx = (idx + 1) % pool.length;
    }
    cursors[type] = (idx + 1) % pool.length;

    var text = pool[idx];
    lastPicked[type] = text;

    if (stageName && text.indexOf('{stage}') >= 0) {
      text = text.replace('{stage}', stageName);
    }
    return text;
  }

  window.AgentPhrases = { getPhrase: getPhrase };
}());
