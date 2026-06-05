import {
  SendHorizontal,
  ArrowDownUp,
  ArrowDownToLine,
  CirclePlus,
} from "lucide-react";

interface ActionRingProps {
  onSend?: () => void;
  onSwap?: () => void;
  onReceive?: () => void;
  onBuy?: () => void;
}

const actions = [
  {
    key: "send",
    icon: SendHorizontal,
    label: "Send",
    color: "bg-lime-500/30 text-lime-600 dark:text-lime-400",
  },
  {
    key: "swap",
    icon: ArrowDownUp,
    label: "Swap",
    color: "bg-blue-500/30 text-blue-600 dark:text-blue-400",
  },
  {
    key: "receive",
    icon: ArrowDownToLine,
    label: "Receive",
    color: "bg-purple-500/30 text-purple-600 dark:text-purple-400",
  },
  {
    key: "buy",
    icon: CirclePlus,
    label: "Buy",
    color: "bg-zinc-500/30 text-zinc-600 dark:text-zinc-400",
    disabled: true,
  },
] as const satisfies readonly { key: string; icon: typeof SendHorizontal; label: string; color: string; disabled?: boolean }[];

export default function ActionRing({
  onSend,
  onSwap,
  onReceive,
  onBuy,
}: ActionRingProps) {
  const handlers: Record<string, (() => void) | undefined> = {
    send: onSend,
    swap: onSwap,
    receive: onReceive,
    buy: onBuy,
  };

  return (
    <div className="flex justify-center items-center gap-6">
      {actions.map(({ key, icon: Icon, label, color, disabled }) => (
        <button
          key={key}
          onClick={handlers[key]}
          className={`flex flex-col items-center gap-1.5 active:scale-95 transition-transform ${
            disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
          }`}
          disabled={disabled}
        >
          <div className={`w-12 h-12 rounded-full flex items-center justify-center ${color}`}>
            <Icon size={20} />
          </div>
          <span className="text-[10px] text-muted-foreground">{label}</span>
        </button>
      ))}
    </div>
  );
}
