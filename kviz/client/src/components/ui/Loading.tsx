interface EmptyStateProps { text?: string; }
interface ErrorStateProps { text?: string; onRetry?: () => void; }
interface SkeletonProps { width?: string; height?: string; className?: string; }
interface LoadingProps { text?: string; }

export function Loading({ text = 'Загрузка…' }: LoadingProps) {
  return <div className="ui-loading">{text}</div>;
}

export function Skeleton({ width = '100%', height = '16px', className }: SkeletonProps) {
  return <div className={`ui-skeleton${className ? ' ' + className : ''}`} style={{ width, height }} />;
}

export function EmptyState({ text = 'Нет данных' }: EmptyStateProps) {
  return <div className="ui-empty-state">{text}</div>;
}

export function ErrorState({ text = 'Ошибка загрузки', onRetry }: ErrorStateProps) {
  return (
    <div className="ui-error-state">
      <span>{text}</span>
      {onRetry && <button className="ui-btn ui-btn-secondary" onClick={onRetry}>Повторить</button>}
    </div>
  );
}
