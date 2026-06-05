import { LogIn, KeyRound, Shield, Send, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNearWallet } from "@/contexts/NearWalletContext";

const STEPS = [
  {
    icon: LogIn,
    title: "Login",
    body: "Google OAuth or connect a NEAR wallet. You can also import an API key locally, no Google required.",
  },
  {
    icon: KeyRound,
    title: "Create an agent wallet",
    body: "Generate a wallet and hand the API key to your AI agent.",
  },
  {
    icon: Shield,
    title: "Set the rules",
    body: "Per-tx, daily, monthly caps. Allowed tokens, address allowlist, time locks. The agent can only do what you permit.",
  },
  {
    icon: Send,
    title: "Agent acts, you oversee",
    body: "In-policy transactions execute automatically. Anything over budget lands in Approvals for your sign-off.",
  },
];

/**
 * First-visit explainer shown on Home page when not logged in.
 * Logged-in users see the normal dashboard.
 */
export default function EmptyStateHero() {
  const { requestLogin } = useNearWallet();

  return (
    <div className="max-w-lg mx-auto px-4 pt-6 pb-24">
      {/* Hero */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-lime-500/15 mb-4">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" className="w-7 h-7 text-lime-500">
            <rect x="3" y="8" width="18" height="12" rx="2"/>
            <path d="M12 8V4M9 4h6"/>
            <circle cx="8.5" cy="14" r="1.5"/>
            <circle cx="15.5" cy="14" r="1.5"/>
          </svg>
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-2">
          Your AI agent's wallet.
          <br />
          Your rules.
        </h1>
        <p className="text-sm text-muted-foreground max-w-xs mx-auto">
          Give AI agents a wallet they can spend from with spending caps, allowed tokens, and a human approval queue for anything over budget.
        </p>
      </div>

      {/* Numbered steps */}
      <div className="space-y-3 mb-8">
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          return (
            <div
              key={i}
              className="flex items-start gap-3 rounded-2xl border border-border/50 bg-card/50 p-4"
            >
              <div className="shrink-0">
                <div className="w-10 h-10 rounded-full bg-lime-500/15 flex items-center justify-center">
                  <Icon size={16} className="text-lime-500" />
                </div>
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="text-sm font-medium mb-0.5">{step.title}</div>
                <div className="text-xs text-muted-foreground leading-relaxed">
                  {step.body}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* CTA */}
      <div className="flex flex-col gap-2 max-w-xs mx-auto">
        <Button
          onClick={requestLogin}
          size="lg"
          className="flex items-center justify-center gap-2"
        >
          Login
          <ArrowRight size={16} />
        </Button>
      </div>
    </div>
  );
}
