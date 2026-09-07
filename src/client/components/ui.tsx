import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useEffect, useRef } from "react";

export function Button({
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={`button ${className}`} {...props} />;
}
export function Modal({
  title,
  children,
  close,
  dismissible = true,
  onOpen,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  dismissible?: boolean;
  onOpen?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const openCallback = useRef(onOpen);
  useEffect(() => {
    ref.current?.showModal();
    openCallback.current?.();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        if (dismissible) close();
        else event.preventDefault();
      }}
      onClose={close}
      aria-label={title}
    >
      <header className="modal-heading">
        <h2>{title}</h2>
        {dismissible && (
          <Button aria-label="关闭对话框" onClick={close}>
            关闭
          </Button>
        )}
      </header>
      {children}
    </dialog>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function Field({
  value,
}: {
  value: {
    state: string;
    value?: string | number | boolean;
  };
}) {
  return (
    <>
      {value.state === "known"
        ? String(value.value)
        : value.state === "not_applicable"
          ? "不适用"
          : "—"}
    </>
  );
}
