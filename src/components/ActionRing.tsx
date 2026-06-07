import {
  SendHorizontal,
  ArrowDownUp,
  ArrowDownToLine,
  Shield,
} from "lucide-react";

interface ActionRingProps {
  onSend?: () => void;
  onSwap?: () => void;
  onReceive?: () => void;
  privateMode?: boolean;
  onTogglePrivate?: () => void;
}

export default function ActionRing({
  onSend,
  onSwap,
  onReceive,
  privateMode = false,
  onTogglePrivate,
}: ActionRingProps) {
  return (
    <div className="flex justify-center items-center gap-6">
      {/* Send */}
      <button
        onClick={onSend}
        className="flex flex-col items-center gap-1.5 active:scale-95 transition-transform cursor-pointer"
      >
        <div className="w-12 h-12 rounded-full flex items-center justify-center bg-lime-500/95 text-lime-600 dark:text-lime-400">
          <SendHorizontal size={20} />
        </div>
        <span className="text-[10px] text-muted-foreground">Send</span>
      </button>

      {/* Swap */}
      <button
        onClick={onSwap}
        className="flex flex-col items-center gap-1.5 active:scale-95 transition-transform cursor-pointer"
      >
        <div className="w-12 h-12 rounded-full flex items-center justify-center bg-blue-500/95 text-blue-600 dark:text-blue-400">
          <ArrowDownUp size={20} />
        </div>
        <span className="text-[10px] text-muted-foreground">Swap</span>
      </button>

      {/* Receive */}
      <button
        onClick={onReceive}
        className="flex flex-col items-center gap-1.5 active:scale-95 transition-transform cursor-pointer"
      >
        <div className="w-12 h-12 rounded-full flex items-center justify-center bg-purple-500/95 text-purple-600 dark:text-purple-400">
          <ArrowDownToLine size={20} />
        </div>
        <span className="text-[10px] text-muted-foreground">Receive</span>
      </button>

      {/* Private toggle (replaces Buy) */}
      <button
        onClick={onTogglePrivate}
        className={`flex flex-col items-center gap-1.5 active:scale-95 transition-all cursor-pointer relative ${
          privateMode ? "scale-105" : ""
        }`}
      >
        <div
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
          privateMode
            ? "bg-purple-500 text-white shadow-[0_0_16px_-2px] shadow-purple-500/60"
            : "bg-zinc-500/95 text-zinc-600 dark:text-zinc-400"
        }`}
        >
          <Shield size={20} />
        </div>
        <span className={`text-[10px] ${privateMode ? "text-purple-400 font-medium" : "text-muted-foreground"}`}>
          {privateMode ? "Private" : "Private"}
        </span>
        {privateMode && (
          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
        )}
      </button>
    </div>
  );
}
