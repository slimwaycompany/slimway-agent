export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', fontFamily: "'Manrope',system-ui,sans-serif" }}>
      <div style={{ textAlign: 'center', color: '#94a3b8' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🚧</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#1a202c', marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 14 }}>В разработке</div>
      </div>
    </div>
  );
}
