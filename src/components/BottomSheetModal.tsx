import { useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

interface BottomSheetModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export function BottomSheetModal({
  open,
  onClose,
  title,
  children,
}: BottomSheetModalProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-center">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div className="sheet-enter fixed bottom-0 left-0 right-0 z-50 max-h-[85vh] rounded-t-2xl bg-background shadow-lg">
        {/* Drag handle */}
        <div className="flex justify-center p-3">
          <div className="h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-600" />
        </div>

        {/* Title */}
        {title && (
          <div className="border-b border-border px-4 pb-3 pt-1">
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          </div>
        )}

        {/* Content */}
        <div
          className="overflow-y-auto px-4 pb-6 pt-2"
          style={{
            maxHeight: title
              ? "calc(85vh - 7.5rem)"
              : "calc(85vh - 4rem)",
          }}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
