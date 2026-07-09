import { useAppStore } from '../stores/useAppStore';

export default function RollbackBar() {
  const { undoStack, redoStack, undo, redo } = useAppStore();

  return (
    <div className="rollback-bar">
      <button
        className="rollback-btn"
        disabled={undoStack.length === 0}
        onClick={undo}
        title="回退到上一步 (Ctrl+Z)"
      >
        ↩ 撤销
      </button>
      <button
        className="rollback-btn"
        disabled={redoStack.length === 0}
        onClick={redo}
        title="重做到下一步 (Ctrl+Y)"
      >
        ↪ 重做
      </button>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
        历史记录 {undoStack.length}/20
      </span>
    </div>
  );
}
