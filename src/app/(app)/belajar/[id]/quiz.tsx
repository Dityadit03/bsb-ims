'use client';
import { useActionState } from 'react';
import { btnPrimary } from '@/components/ui';
import { submitQuiz } from '../../hrga/elearning/actions';

export type QuizData = { attempt_id: string; started_at: string; duration_minutes: number | null; questions: { id: string; question: string; options: string[] }[] };

export function Quiz({ course, quiz }: { course: string; quiz: QuizData }) {
  const [state, run, pending] = useActionState(submitQuiz, {});
  return (
    <form action={run} className="grid gap-4">
      <input type="hidden" name="course" value={course} />
      <input type="hidden" name="attempt" value={quiz.attempt_id} />
      <input type="hidden" name="n" value={quiz.questions.length} />
      {quiz.questions.map((q, i) => (
        <fieldset key={q.id} className="grid gap-2 rounded-xl border border-line p-3">
          <legend className="px-1 text-sm font-semibold">{i + 1}. {q.question}</legend>
          {q.options.map((o, k) => (
            <label key={k} className="flex items-start gap-2 text-sm"><input type="radio" name={`q${i}`} value={k + 1} className="mt-1" /> <span>{o}</span></label>
          ))}
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button className={btnPrimary} disabled={pending}>{pending ? 'Memeriksa…' : 'Kumpulkan jawaban'}</button>
        {state.error && <span role="alert" className="text-sm text-crit">{state.error}</span>}
        {state.ok && <span className="text-sm text-ok">{state.ok}</span>}
      </div>
    </form>
  );
}
