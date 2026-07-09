import { useAppStore } from '../stores/useAppStore';

export default function Toast() {
  const { toasts, dismissToast } = useAppStore();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast ${t.type}`}
          onClick={() => dismissToast(t.id)}
          style={{ cursor: 'pointer' }}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
