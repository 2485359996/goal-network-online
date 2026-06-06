import { useCallback, useEffect, useRef } from "react";

// 模态弹窗的可达性收口：Esc 关闭、遮罩点击关闭、打开时把焦点收进弹窗并做 Tab 焦点环、关闭后归还焦点。
// canDismiss 为 false 时（如保存中 / 生成中）忽略 Esc 与遮罩点击，但仍保持焦点环，避免误关丢失中途操作。
const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])'
].join(",");

export function useModalDialog<T extends HTMLElement>({
  onDismiss,
  canDismiss = true
}: {
  onDismiss: () => void;
  canDismiss?: boolean;
}) {
  const dialogRef = useRef<T | null>(null);
  const pointerDownOnBackdropRef = useRef(false);
  const dismissRef = useRef(onDismiss);
  const canDismissRef = useRef(canDismiss);
  dismissRef.current = onDismiss;
  canDismissRef.current = canDismiss;

  useEffect(() => {
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusableElements = () =>
      dialog ? Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)) : [];

    const focusable = focusableElements();
    (focusable[0] ?? dialog)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!canDismissRef.current) return;
        event.preventDefault();
        dismissRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;

      const elements = focusableElements();
      if (elements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || active === dialog || !dialog.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, []);

  // 仅当“按下”和“抬起”都落在遮罩本身时才关闭，避免在弹窗内拖选文本滑到遮罩误触关闭。
  const onBackdropPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    pointerDownOnBackdropRef.current = event.target === event.currentTarget;
  }, []);

  const onBackdropClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    const startedOnBackdrop = pointerDownOnBackdropRef.current;
    pointerDownOnBackdropRef.current = false;
    if (!canDismissRef.current) return;
    if (event.target === event.currentTarget && startedOnBackdrop) {
      dismissRef.current();
    }
  }, []);

  return { dialogRef, onBackdropPointerDown, onBackdropClick };
}
