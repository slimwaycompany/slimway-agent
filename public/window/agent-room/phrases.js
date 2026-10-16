/* phrases.js — speech bubble text pools */
(function () {
  'use strict';

  var POOLS = {
    move: [
      'Перенесла карточку в «Дожим»',
      'Готово, карточка на месте',
      'Навела порядок в воронке',
      'Карточка переехала',
      'Воронка в порядке',
    ],
    task: [
      'Поставила задачу на звонок',
      'Задача менеджеру — есть',
      'Звонок назначен',
      'Менеджер в курсе',
    ],
    new_lead: [
      'Новая заявка! Девочки, ваш выход',
      'Свежий лид пришёл',
      'Есть контакт!',
      'Новенький в воронке',
    ],
    error: [
      'Fitbase капризничает…',
      'Что-то пошло не так, проверяю',
      'Ошибка, разбираюсь',
      'Сбой — смотрю',
    ],
    panic: [
      'Fitbase капризничает…',
      'Что-то пошло не так, проверяю',
      'Ошибка, разбираюсь',
    ],
    confused: [
      'Давно не было прогона… меня точно запускают?',
      'Тишина подозрительная',
      'Жду прогона…',
    ],
    typing: [
      'Проверяю пробные…',
      'Все карточки на месте',
      'Пробные под контролем',
      'Работаю, не волнуйся',
      'Всё по расписанию',
    ],
    walk:    ['Разомнусь пару минут'],
    coffee:  ['Кофе — и за работу'],
    pullup:  ['Пока тихо — можно и подтянуться'],
    stretch: ['Потянусь — и дальше'],
    window:  ['Хорошо сегодня над Байтереком'],
    idle: [
      'Всё под контролем',
      'Пробные в порядке',
      'Воронка чистая',
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
