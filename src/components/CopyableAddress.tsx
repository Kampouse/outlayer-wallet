import { Copy, Check } from "lucide-react";
import { useState, useCallback } from "react";
import { useToast } from "@/components/ToastProvider";

interface CopyableAddressProps {
  address: string;
  className?: string;
  as?: "span" | "a";
  href?: string;
}

export default function CopyableAddress({
  address,
  className = "",
  as: Tag = "span",
  href,
}: CopyableAddressProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const copy = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard.writeText(address).then(() => {
        setCopied(true);
        toast("Address copied");
        setTimeout(() => setCopied(false), 1500);
      });
    },
    [address, toast],
  );

  return (
    <div className="relative group">
      <Tag
        {...(Tag === "a" ? { href, target: "_blank", rel: "noopener noreferrer" } : {})}
        className={`text-xs text-zinc-500 font-mono break-all hover:text-zinc-700 hover:underline pr-5 ${className}`}
      >
        {address}
      </Tag>
      <button
        onClick={copy}
        className="absolute top-0 right-0 text-zinc-300 hover:text-zinc-500 transition-colors p-0.5 min-h-0 min-w-0"
        title="Copy address"
      >
        {copied ? (
          <Check size={12} className="text-emerald-500" />
        ) : (
          <Copy size={12} />
        )}
      </button>
    </div>
  );
}
