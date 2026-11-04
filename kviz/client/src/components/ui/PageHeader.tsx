interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Buttons / controls. On mobile: wraps below title. */
  actions?: React.ReactNode;
}

/**
 * Desktop: title left, actions right (flex row).
 * Phone: title + subtitle, actions below.
 */
export default function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="ui-page-header">
      <div className="ui-page-header-text">
        <h1 className="ui-page-header-title">{title}</h1>
        {subtitle && <p className="ui-page-header-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="ui-page-header-actions">{actions}</div>}
    </div>
  );
}
