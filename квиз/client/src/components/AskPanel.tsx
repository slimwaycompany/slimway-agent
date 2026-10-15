import { STEP_ASK, Answers } from '../config/qualify';

export default function AskPanel({ step, answers, onToggle, readOnly }: {
  step: number; answers: Answers; onToggle: (qIdx: number) => void; readOnly?: boolean;
}) {
  const questions = STEP_ASK[step - 1] ?? [];
  if (!questions.length) return null;
  const asked: boolean[] = (answers.asked?.[String(step)] ?? []) as boolean[];

  return (
    <div className="col-panel">
      <h4>❓ Спросить</h4>
      {questions.map((q, i) => {
        const done = !!asked[i];
        return (
          <div
            key={i}
            className={`ask-item${done ? ' asked' : ''}`}
            onClick={() => !readOnly && onToggle(i)}
          >
            <input type="checkbox" checked={done} readOnly onChange={() => {}} />
            <label>{q}</label>
          </div>
        );
      })}
    </div>
  );
}
