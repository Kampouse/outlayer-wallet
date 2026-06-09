import { useState } from "react";
import { Copy, Check, QrCode } from "lucide-react";

export default function ReceiveSheet({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const [imgError, setImgError] = useState(false);

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = address;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(address)}&bgcolor=ffffff&color=000000`;

  return (
    <div className="flex flex-col items-center gap-5 py-4">
      {/* QR Code */}
      {!imgError ? (
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <img
            src={qrUrl}
            alt="QR Code"
            width={200}
            height={200}
            className="rounded-lg"
            onError={() => setImgError(true)}
          />
        </div>
      ) : (
        <div className="w-[200px] h-[200px] bg-white rounded-2xl flex items-center justify-center shadow-sm">
          <QrCode size={64} className="text-muted-foreground" />
        </div>
      )}

      {/* Address */}
      <div className="w-full text-center">
        <p className="text-xs text-muted-foreground mb-2">Your NEAR Address</p>
        <p className="text-sm font-mono break-all px-2 py-2 bg-muted/50 rounded-lg select-all">
          {address}
        </p>
      </div>

      {/* Copy button */}
      <button
        onClick={copyAddress}
        className={`flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-medium transition-all duration-200 ${
          copied
            ? "bg-lime-500/15 text-lime-600 dark:text-lime-400"
            : "bg-foreground text-background active:scale-95"
        }`}
      >
        {copied ? (
          <>
            <Check size={16} />
            Copied
          </>
        ) : (
          <>
            <Copy size={16} />
            Copy Address
          </>
        )}
      </button>
    </div>
  );
}
