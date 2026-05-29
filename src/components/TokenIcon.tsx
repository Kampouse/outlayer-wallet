import { lazy, Suspense, type ComponentType, type SVGProps } from "react";

type Web3IconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
  variant?: "mono" | "branded" | "background";
  color?: string;
  fallback?: string;
};

// ── web3icons SVG components (best quality, crisp at any size) ──
const icons = {
  NEAR: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenNEAR as ComponentType<Web3IconProps> }))),
  ETH: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenETH as ComponentType<Web3IconProps> }))),
  BTC: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenBTC as ComponentType<Web3IconProps> }))),
  USDC: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenUSDC as ComponentType<Web3IconProps> }))),
  USDT: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenUSDT as ComponentType<Web3IconProps> }))),
  WBTC: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenWBTC as ComponentType<Web3IconProps> }))),
  SOL: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenSOL as ComponentType<Web3IconProps> }))),
  FTM: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenFTM as ComponentType<Web3IconProps> }))),
  ZEC: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenZEC as ComponentType<Web3IconProps> }))),
  DAI: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenDAI as ComponentType<Web3IconProps> }))),
  ARB: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenARB as ComponentType<Web3IconProps> }))),
  OP: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenOP as ComponentType<Web3IconProps> }))),
  SUI: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenSUI as ComponentType<Web3IconProps> }))),
  RETH: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenRETH as ComponentType<Web3IconProps> }))),
  LINK: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenLINK as ComponentType<Web3IconProps> }))),
  AAVE: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenAAVE as ComponentType<Web3IconProps> }))),
  DOT: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenDOT as ComponentType<Web3IconProps> }))),
  AVAX: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenAVAX as ComponentType<Web3IconProps> }))),
  MATIC: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenMATIC as ComponentType<Web3IconProps> }))),
  UNI: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenUNI as ComponentType<Web3IconProps> }))),
  NEON: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenNEON as ComponentType<Web3IconProps> }))),
  STRK: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenSTRK as ComponentType<Web3IconProps> }))),
  SHIB: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenSHIB as ComponentType<Web3IconProps> }))),
  PEPE: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenPEPE as ComponentType<Web3IconProps> }))),
  DOGE: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenDOGE as ComponentType<Web3IconProps> }))),
  LTC: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenLTC as ComponentType<Web3IconProps> }))),
  BCH: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenBCH as ComponentType<Web3IconProps> }))),
  TRX: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenTRX as ComponentType<Web3IconProps> }))),
  TON: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenTON as ComponentType<Web3IconProps> }))),
  XRP: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenXRP as ComponentType<Web3IconProps> }))),
  XLM: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenXLM as ComponentType<Web3IconProps> }))),
  DASH: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenDASH as ComponentType<Web3IconProps> }))),
  AURORA: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenAURORA as ComponentType<Web3IconProps> }))),
  REF: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenREF as ComponentType<Web3IconProps> }))),
  SWEAT: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenSWEAT as ComponentType<Web3IconProps> }))),
  POL: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenPOL as ComponentType<Web3IconProps> }))),
  SPX: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenSPX as ComponentType<Web3IconProps> }))),
  COW: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenCOW as ComponentType<Web3IconProps> }))),
  SAFE: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenSAFE as ComponentType<Web3IconProps> }))),
  GMX: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenGMX as ComponentType<Web3IconProps> }))),
  FRAX: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenFRAX as ComponentType<Web3IconProps> }))),
  OKB: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenOKB as ComponentType<Web3IconProps> }))),
  GNO: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenGNO as ComponentType<Web3IconProps> }))),
  KNC: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenKNC as ComponentType<Web3IconProps> }))),
  HAPI: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenHAPI as ComponentType<Web3IconProps> }))),
  MOG: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenMOG as ComponentType<Web3IconProps> }))),
  MON: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenMON as ComponentType<Web3IconProps> }))),
  XPL: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenXPL as ComponentType<Web3IconProps> }))),
  APT: lazy(() => import("@web3icons/react").then((m) => ({ default: m.TokenAPT as ComponentType<Web3IconProps> }))),
};

const ICON_MAP = icons as Record<string, ComponentType<Web3IconProps>>;

// ── Aliases: map variants to existing icons ──
const WEB3_ALIASES: Record<string, string> = {
  WETH: "ETH",
  wBTC: "BTC",
  cbBTC: "BTC",
  xBTC: "BTC",
  xDAI: "DAI",
  nrUsdt: "USDT",
};

// ── CoinMarketCap CDN fallback (128px PNGs) ──
const CMC = "https://s2.coinmarketcap.com/static/img/coins/128x128";

// ── near.com / near-intents.org hosted icons ──
const NEAR_ICONS = "https://near.com/static/icons/token";
const NEAR_NETWORKS = "https://near.com/static/icons/network";
const INTENTS_ICONS = "https://near-intents.org/static/icons/token";

const CMC_BASE = "https://s2.coinmarketcap.com/static/img/coins/64x64";

// Auto-generated: ChainDefuser symbol → CMC coin ID (build-time fetch from CMC API)
// 86 of 119 ChainDefuser tokens matched. Covers tokenized-assets category.
const CMC_SYMBOL_MAP: Record<string, number> = {
  AAPLON: 38037, AAVE: 7278, ADA: 2010, ADI: 38185, AGGON: 38072,
  ALEO: 32193, AMZNON: 38083, APT: 21794, ARB: 11841, ASTER: 36341,
  AURORA: 14803, AVAX: 5805, BCH: 1831, BERA: 24647, BLACKDRAGON: 29627,
  BNB: 1839, BOME: 29870, BRETT: 29743, BTC: 1, COW: 19269,
  DAI: 4943, DASH: 131, DOGE: 74, ETH: 1027, EURE: 20920,
  EVAA: 38376, FRAX: 6952, GLDON: 39276, GMX: 11857, GNO: 1659,
  GOOGLON: 38001, HAPI: 8567, IAUON: 38041, INX: 39461, KAITO: 35763,
  KNC: 9444, LINK: 1975, LTC: 2, MELANIA: 35347, METAON: 38065,
  MOG: 27659, MON: 30495, MSFTON: 38086, NEAR: 6535, NPRO: 39110,
  NVDAON: 38093, OKB: 3897, OP: 11840, PENGU: 34466, PEPE: 24478,
  POL: 28321, PUBLIC: 37728, QQQON: 38094, RHEA: 37529, SAFE: 21585,
  SHIB: 5994, SLVON: 38057, SOL: 5426, SPX: 28081, SPYON: 38067,
  STRK: 22691, SUI: 20947, SWEAT: 21351, TIPON: 38068, TITN: 36271,
  TLTON: 38031, TON: 39249, TRUMP: 35336, TRX: 1958, TSLAON: 38029,
  TURBO: 24911, UNI: 7083, USAD: 38627, USD1: 36148, USDC: 3408,
  USDF: 35721, USDON: 38273, USDT: 825, VVV: 35509, XAUT: 5176,
  XBTC: 26597, XDAI: 8635, XLM: 512, XPL: 36645, XRP: 52, ZEC: 1437,
};

// Omni synthetic stock tokens — CMC icons where available, branded ticker otherwise
const STOCK_ICONS: Record<string, { url?: string; label?: string; bg: string }> = {
  NVDAON: { url: `${CMC_BASE}/38093.png`, bg: "#76B900" },
  AAPLON: { url: `${CMC_BASE}/36994.png`, bg: "#333" },
  TSLAON: { url: `${CMC_BASE}/37004.png`, bg: "#CC0000" },
  GOOGLON:{ url: `${CMC_BASE}/37013.png`, bg: "#4285F4" },
  METAON: { url: `${CMC_BASE}/37055.png`, bg: "#0668E1" },
  MSFTON: { url: `${CMC_BASE}/37056.png`, bg: "#00A4EF" },
  AMZNON: { url: `${CMC_BASE}/37014.png`, bg: "#FF9900" },
  QQQON:  { url: `${CMC_BASE}/37057.png`, bg: "#8B5CF6" },
  SPYON:  { url: `${CMC_BASE}/37006.png`, bg: "#0A3069" },
  GLDON:  { url: `${CMC_BASE}/5176.png`, bg: "#DAA520" },
  IAUON:  { url: `${CMC_BASE}/38051.png`, bg: "#B8860B" },
  AGGON:  { url: `${CMC_BASE}/38067.png`, bg: "#1E40AF" },
  TLTON:  { url: `${CMC_BASE}/38031.png`, bg: "#6366F1" },
  SLVON:  { url: `${CMC_BASE}/38057.png`, bg: "#94A3B8" },
  TIPON:  { url: `${CMC_BASE}/38021.png`, bg: "#059669" },
  USDON: { url: `${CMC_BASE}/38273.png`, bg: "#16A34A" },
};

// Symbol → image URL (for tokens not in web3icons)
const ICON_URLS: Record<string, string> = {
  // Wrapped / bridged variants
  wNEAR: "https://img.rhea.finance/images/w-NEAR-no-border.png",
  stNEAR: `${NEAR_ICONS}/stnear.svg`,
  GNEAR: `${NEAR_ICONS}/gnear.svg`,

  // Coins with CMC IDs
  TURBO: `${CMC}/32898.png`,
  PENGU: `${CMC}/34466.png`,
  LOUD: `${CMC}/33737.png`,
  WIF: `${CMC}/28752.png`,
  USDCx: `${CMC}/39544.png`,
  USDT0: `${CMC}/36440.png`,
  USDf: `${CMC}/34188.png`,
  USAD: `${CMC}/32651.png`,
  USD1: `${CMC}/34182.png`,
  XAUT: `${NEAR_ICONS}/xaut.svg`,
  BOME: `${CMC}/30280.png`,
  BRETT: `${CMC}/34044.png`,
  ALEO: `${CMC}/28035.png`,
  BERAS: `${CMC}/29727.png`,
  KAITO: `${CMC}/33726.png`,
  MELANIA: `${CMC}/35207.png`,
  JAMBO: `${CMC}/34762.png`,
  PURGE: `${CMC}/33946.png`,
  RHEA: `${CMC}/33050.png`,
  EVAA: `${CMC}/33096.png`,
  SHITZU: `${CMC}/31565.png`,
  NOEAR: `${NEAR_ICONS}/noear.svg`,
  NPRO: `${NEAR_ICONS}/npro.svg`,
  ADI: `${NEAR_NETWORKS}/adi.png`,
  ADA: `${NEAR_NETWORKS}/cardano.png`,
  xBTC: `${INTENTS_ICONS}/xbtc.png`,
  USDTn: `${NEAR_ICONS}/usdt.svg`,
  sUSDC: `${NEAR_ICONS}/susdc.svg`,
  sparkUSDC: `${NEAR_ICONS}/sparkusdc.svg`,
  steakUSDC: `${NEAR_ICONS}/steakusdc.svg`,
  gtUSDC: `${NEAR_ICONS}/gtusdc.svg`,
  mpDAO: `${NEAR_ICONS}/mpdao.svg`,
  mwUSDC: `${NEAR_ICONS}/mwusdc.svg`,
  CFI: `${NEAR_ICONS}/cfi.svg`,
  FMS: `${NEAR_ICONS}/fms.svg`,
  ABG: `${NEAR_ICONS}/abg.svg`,
  INX: `${NEAR_ICONS}/inx.svg`,
  ITLX: `${NEAR_ICONS}/itlx.svg`,
};

// ── Deterministic color from symbol (final fallback) ──
function tokenColor(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = symbol.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 50%)`;
}

function FallbackIcon({ symbol, size = 24 }: { symbol: string; size?: number }) {
  const key = symbol.toUpperCase();

  // Omni synthetic stocks — branded icons
  const stock = STOCK_ICONS[key];
  if (stock) {
    if (stock.url) {
      return <ImageIcon src={stock.url} alt={symbol} size={size} />;
    }
    return (
      <div
        className="rounded-full shrink-0 flex items-center justify-center font-bold text-white"
        style={{
          width: size,
          height: size,
          backgroundColor: stock.bg,
          fontSize: Math.max(size * 0.33, 8),
          lineHeight: 1,
          letterSpacing: "-0.02em",
        }}
        title={symbol}
      >
        {stock.label}
      </div>
    );
  }

  const letter = symbol.charAt(0).toUpperCase();
  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-bold shrink-0"
      style={{
        backgroundColor: tokenColor(symbol),
        width: size,
        height: size,
        fontSize: size * 0.45,
      }}
    >
      {letter}
    </div>
  );
}

function ImageIcon({ src, alt, size = 24, className }: { src: string; alt: string; size?: number; className?: string }) {
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={`rounded-full shrink-0 ${className ?? ""}`}
      style={{ width: size, height: size, objectFit: "contain" }}
      loading="lazy"
    />
  );
}

interface TokenIconProps {
  symbol: string;
  size?: number;
  className?: string;
}

export default function TokenIcon({ symbol, size = 24, className }: TokenIconProps) {
  const key = symbol.toUpperCase();

  // 1. Try web3icons (SVG, crisp)
  const web3Key = WEB3_ALIASES[key] || key;
  const SvgComponent = ICON_MAP[web3Key];
  if (SvgComponent) {
    return (
      <Suspense fallback={<FallbackIcon symbol={symbol} size={size} />}>
        <SvgComponent size={size} variant="branded" className={className} />
      </Suspense>
    );
  }

  // 2. Try URL-based icon (CoinMarketCap / near.com hosted)
  const url = ICON_URLS[key] || ICON_URLS[symbol];
  if (url) {
    return <ImageIcon src={url} alt={symbol} size={size} className={className} />;
  }

  // 3. Try CMC symbol map (auto-generated from tokenized-assets category)
  const cmcId = CMC_SYMBOL_MAP[key];
  if (cmcId) {
    return <ImageIcon src={`${CMC_BASE}/${cmcId}.png`} alt={symbol} size={size} className={className} />;
  }

  // 4. Letter-circle fallback
  return <FallbackIcon symbol={symbol} size={size} />;
}
