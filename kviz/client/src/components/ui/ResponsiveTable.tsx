interface Column {
  key: string;
  label: string;
  /** Pin this column when mode="scroll" (usually the first column) */
  sticky?: boolean;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

interface ResponsiveTableProps {
  columns: Column[];
  rows: Record<string, React.ReactNode>[];
  /**
   * "cards" — phone: each row becomes a card (label: value). Default for narrow tables.
   * "scroll" — always scrollable with sticky first column. Use for wide report tables.
   */
  mode?: 'cards' | 'scroll';
  emptyText?: string;
  keyField?: string;
}

/** Desktop: regular <table>. Phone cards mode: each row → card. Phone scroll mode: overflow-x + sticky col. */
export default function ResponsiveTable({
  columns, rows, mode = 'cards', emptyText = 'Нет данных', keyField,
}: ResponsiveTableProps) {
  const cls = `ui-rtable ui-rtable--${mode}`;

  if (rows.length === 0) {
    return <div className="ui-rtable-empty">{emptyText}</div>;
  }

  return (
    <div className={cls}>
      {/* Table (visible on desktop; hidden on phone when mode=cards) */}
      <div className="ui-rtable-wrap">
        <table>
          <thead>
            <tr>
              {columns.map(c => (
                <th key={c.key} className={`${c.sticky ? 'ui-rtable-sticky' : ''} ${c.className || ''}`}
                    style={{ textAlign: c.align || 'left' }}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={keyField ? String(row[keyField]) : i}>
                {columns.map(c => (
                  <td key={c.key} className={`${c.sticky ? 'ui-rtable-sticky' : ''} ${c.className || ''}`}
                      style={{ textAlign: c.align || 'left' }}>
                    {row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cards (visible on phone when mode=cards) */}
      {mode === 'cards' && (
        <div className="ui-rtable-cards">
          {rows.map((row, i) => (
            <div key={keyField ? String(row[keyField]) : i} className="ui-rtable-card">
              {columns.map(c => (
                <div key={c.key} className="ui-rtable-card-row">
                  <span className="ui-rtable-card-label">{c.label}</span>
                  <span className="ui-rtable-card-value" style={{ textAlign: c.align || 'left' }}>{row[c.key]}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
