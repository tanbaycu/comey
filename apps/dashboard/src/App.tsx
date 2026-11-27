import {
  Activity,
  Landmark,
  LayoutDashboard,
  Lock,
  QrCode,
  RefreshCw,
  Rocket,
  Search,
  ShieldAlert,
  Volume2,
  Webhook,
} from 'lucide-react';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { ComeyMark } from './components/BrandIcon';
import { CommandPalette, type QuickActionId } from './components/CommandPalette';
import { ProfilePopover } from './components/ProfilePopover';
import { QuickCreatePopover } from './components/QuickCreatePopover';
import { SkeletonCards } from './components/Skeleton';
import { ComeyToaster, notifyToast } from './components/Toast';
import { Tip, TipProvider } from './components/Tooltip';
import { api, setOnUnauthorizedHandler } from './lib/api';
import type {
  ApiKeyItem,
  AuditLogItem,
  BankAccount,
  BankCatalogItem,
  PaymentSessionItem,
  QuarantineItem,
  RoutingRule,
  SecuritySummary,
  SoundboxItem,
  TransactionItem,
  UserInfo,
  WebhookDeliveryItem,
  WebhookPayloadFormat,
  WorkspaceInfo,
} from './lib/types';

const LandingAuthView = lazy(() =>
  import('./components/LandingAuthView').then((m) => ({ default: m.LandingAuthView }))
);
const OverviewPage = lazy(() =>
  import('./pages/OverviewPage').then((m) => ({ default: m.OverviewPage }))
);
const BankAccountsPage = lazy(() =>
  import('./pages/BankAccountsPage').then((m) => ({ default: m.BankAccountsPage }))
);
const RoutingWebhooksPage = lazy(() =>
  import('./pages/RoutingWebhooksPage').then((m) => ({ default: m.RoutingWebhooksPage }))
);
const TransactionsSimulatorPage = lazy(() =>
  import('./pages/TransactionsSimulatorPage').then((m) => ({
    default: m.TransactionsSimulatorPage,
  }))
);
const SessionsPage = lazy(() =>
  import('./pages/SessionsPage').then((m) => ({ default: m.SessionsPage }))
);
const SoundboxPage = lazy(() =>
  import('./pages/SoundboxPage').then((m) => ({ default: m.SoundboxPage }))
);
const QuarantinePage = lazy(() =>
  import('./pages/QuarantinePage').then((m) => ({ default: m.QuarantinePage }))
);
const SecurityPage = lazy(() =>
  import('./pages/SecurityPage').then((m) => ({ default: m.SecurityPage }))
);
const DeveloperDocsPage = lazy(() =>
  import('./pages/DeveloperDocsPage').then((m) => ({ default: m.DeveloperDocsPage }))
);

type TabId =
  | 'overview'
  | 'transactions'
  | 'sessions'
  | 'accounts'
  | 'routing'
  | 'soundboxes'
  | 'quarantine'
  | 'security'
  | 'developers';

const PATH_TO_TAB: Record<string, TabId> = {
  '/': 'overview',
  '/transactions': 'transactions',
  '/sessions': 'sessions',
  '/accounts': 'accounts',
  '/routing': 'routing',
  '/soundboxes': 'soundboxes',
  '/quarantine': 'quarantine',
  '/security': 'security',
  '/developers': 'developers',
};

const TAB_TO_PATH: Record<TabId, string> = {
  overview: '/',
  transactions: '/transactions',
  sessions: '/sessions',
  accounts: '/accounts',
  routing: '/routing',
  soundboxes: '/soundboxes',
  quarantine: '/quarantine',
  security: '/security',
  developers: '/developers',
};

function readInitialTab(): TabId {
  if (typeof window === 'undefined') return 'overview';
  return PATH_TO_TAB[window.location.pathname] ?? 'overview';
}

export function App() {
  const [booting, setBooting] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [tab, setTab] = useState<TabId>(readInitialTab);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [intent, setIntent] = useState<{
    action: QuickActionId;
    seq: number;
    bankCode?: string;
    payloadFormat?: WebhookPayloadFormat;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [banks, setBanks] = useState<BankCatalogItem[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [sessions, setSessions] = useState<PaymentSessionItem[]>([]);
  const [soundboxes, setSoundboxes] = useState<SoundboxItem[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDeliveryItem[]>([]);
  const [quarantine, setQuarantine] = useState<QuarantineItem[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [securitySummary, setSecuritySummary] = useState<SecuritySummary | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);

  const banksLoadedRef = useRef(false);
  const navTrackRef = useRef<HTMLDivElement>(null);
  const tabBtnRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});
  const prevTabRef = useRef<TabId | null>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  const [animateIndicator, setAnimateIndicator] = useState(false);

  const notify = useCallback((kind: 'success' | 'error', text: string) => {
    notifyToast(kind, text);
  }, []);

  const resetSessionState = useCallback(() => {
    setUser(null);
    setWorkspace(null);
    setTab('overview');
    setPaletteOpen(false);
    banksLoadedRef.current = false;
    setBanks([]);
    setAccounts([]);
    setRules([]);
    setTransactions([]);
    setSessions([]);
    setSoundboxes([]);
    setDeliveries([]);
    setQuarantine([]);
    setApiKeys([]);
    setSecuritySummary(null);
    setAuditLogs([]);
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.history.replaceState(null, '', '/');
    }
  }, []);

  const reloadTransactions = useCallback(async () => {
    const res = await api.transactions.list();
    setTransactions(res.transactions);
  }, []);

  const reloadAccounts = useCallback(async () => {
    const res = await api.bankAccounts.list();
    setAccounts(res.bankAccounts);
  }, []);

  const reloadRulesAndDeliveries = useCallback(async () => {
    const [rulesRes, dlvRes] = await Promise.all([
      api.routingRules.list(),
      api.deliveries.list(),
    ]);
    setRules(rulesRes.routingRules);
    setDeliveries(dlvRes.deliveries);
  }, []);

  const reloadSessions = useCallback(async () => {
    const res = await api.sessions.list();
    setSessions(res.sessions);
  }, []);

  const reloadSoundboxes = useCallback(async () => {
    const res = await api.soundboxes.list();
    setSoundboxes(res.soundboxes);
  }, []);

  const reloadQuarantine = useCallback(async () => {
    const res = await api.quarantine.list('quarantined');
    setQuarantine(res.quarantine);
  }, []);

  const reloadSecurity = useCallback(async () => {
    const [secRes, audRes] = await Promise.all([
      api.security.summary(),
      api.security.auditLogs(),
    ]);
    setSecuritySummary(secRes.summary);
    setAuditLogs(audRes.auditLogs);
  }, []);

  const reloadApiKeys = useCallback(async () => {
    const res = await api.apiKeys.list();
    setApiKeys(res.apiKeys);
  }, []);

  const reloadAfterSimulation = useCallback(async () => {
    const [txRes, sessRes, dlvRes] = await Promise.all([
      api.transactions.list(),
      api.sessions.list(),
      api.deliveries.list(),
    ]);
    setTransactions(txRes.transactions);
    setSessions(sessRes.sessions);
    setDeliveries(dlvRes.deliveries);
  }, []);

  const reloadAfterSoundboxTest = useCallback(async () => {
    const [sbxRes, txRes, dlvRes] = await Promise.all([
      api.soundboxes.list(),
      api.transactions.list(),
      api.deliveries.list(),
    ]);
    setSoundboxes(sbxRes.soundboxes);
    setTransactions(txRes.transactions);
    setDeliveries(dlvRes.deliveries);
  }, []);

  const loadWorkspaceData = useCallback(async (initial = false) => {
    if (initial) setLoadingData(true);
    setRefreshing(true);
    try {
      const shouldFetchBanks = !banksLoadedRef.current;
      const [
        banksRes,
        accRes,
        rulesRes,
        txRes,
        sessRes,
        sbxRes,
        dlvRes,
        qRes,
        keysRes,
        secRes,
        audRes,
      ] = await Promise.all([
        shouldFetchBanks ? api.banks.list() : Promise.resolve(null),
        api.bankAccounts.list(),
        api.routingRules.list(),
        api.transactions.list(),
        api.sessions.list(),
        api.soundboxes.list(),
        api.deliveries.list(),
        api.quarantine.list('quarantined'),
        api.apiKeys.list(),
        api.security.summary(),
        api.security.auditLogs(),
      ]);
      if (banksRes) {
        setBanks(banksRes.banks);
        banksLoadedRef.current = true;
      }
      setAccounts(accRes.bankAccounts);
      setRules(rulesRes.routingRules);
      setTransactions(txRes.transactions);
      setSessions(sessRes.sessions);
      setSoundboxes(sbxRes.soundboxes);
      setDeliveries(dlvRes.deliveries);
      setQuarantine(qRes.quarantine);
      setApiKeys(keysRes.apiKeys);
      setSecuritySummary(secRes.summary);
      setAuditLogs(audRes.auditLogs);
    } finally {
      setRefreshing(false);
      if (initial) setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    setOnUnauthorizedHandler(() => {
      resetSessionState();
      notify('error', 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại');
    });
    return () => setOnUnauthorizedHandler(null);
  }, [notify, resetSessionState]);

  useEffect(() => {
    void api.auth
      .me()
      .then(async (res) => {
        setUser(res.user);
        setWorkspace(res.workspace);
        await loadWorkspaceData(true);
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setBooting(false);
      });
  }, [loadWorkspaceData]);

  useEffect(() => {
    const onPopState = () => setTab(readInitialTab());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!user) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [user]);

  const navigate = useCallback(
    (nextTab: string) => {
      const valid = (nextTab in TAB_TO_PATH ? nextTab : 'overview') as TabId;
      setTab(valid);
      const targetPath = TAB_TO_PATH[valid];
      if (window.location.pathname !== targetPath) {
        window.history.pushState(null, '', targetPath);
      }
      if (valid === 'security') {
        void reloadSecurity().catch(() => {});
      } else if (valid === 'quarantine') {
        void reloadQuarantine().catch(() => {});
      } else if (valid === 'soundboxes') {
        void reloadSoundboxes().catch(() => {});
      }
    },
    [reloadQuarantine, reloadSecurity, reloadSoundboxes]
  );

  const handleQuickAction = useCallback(
    (action: QuickActionId) => {
      const seq = Date.now();
      if (action === 'refresh') {
        void loadWorkspaceData(false);
        return;
      }
      setIntent({ action, seq });
      if (action === 'new-account') navigate('accounts');
      else if (action === 'new-rule') navigate('routing');
      else if (action === 'simulate-tx') navigate('transactions');
      else if (action === 'dynamic-qr') navigate('sessions');
      else if (action === 'new-soundbox') navigate('soundboxes');
      else if (action === 'new-apikey' || action === 'deploy-guide') navigate('developers');
    },
    [loadWorkspaceData, navigate]
  );

  const handleOpenBankWithCode = useCallback(
    (bankCode: string) => {
      setIntent({ action: 'new-account', seq: Date.now(), bankCode });
      navigate('accounts');
    },
    [navigate]
  );

  const handleOpenRuleWithFormat = useCallback(
    (payloadFormat: WebhookPayloadFormat) => {
      setIntent({ action: 'new-rule', seq: Date.now(), payloadFormat });
      navigate('routing');
    },
    [navigate]
  );

  async function handleLogout() {
    await api.auth.logout().catch(() => {});
    resetSessionState();
  }

  const navItems: Array<{
    id: TabId;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
    badgeTone?: 'red' | 'neutral';
  }> = [
    { id: 'overview', label: 'Tổng quan', icon: LayoutDashboard },
    { id: 'transactions', label: 'Sổ giao dịch', icon: Activity },
    { id: 'sessions', label: 'Thanh toán & QR', icon: QrCode },
    {
      id: 'accounts',
      label: 'Ngân hàng',
      icon: Landmark,
      badge: accounts.length || undefined,
      badgeTone: 'neutral',
    },
    { id: 'routing', label: 'Định tuyến', icon: Webhook },
    { id: 'soundboxes', label: 'Loa thu ngân', icon: Volume2 },
    {
      id: 'quarantine',
      label: 'Cách ly',
      icon: ShieldAlert,
      badge: quarantine.length || undefined,
      badgeTone: 'red',
    },
    { id: 'security', label: 'Bảo mật', icon: Lock },
    { id: 'developers', label: 'Triển khai & API', icon: Rocket },
  ];

  const measureIndicator = useCallback(
    (shouldAnimate: boolean) => {
      const btn = tabBtnRefs.current[tab];
      if (!btn || btn.offsetWidth <= 0) return;
      const next = { left: btn.offsetLeft, width: btn.offsetWidth };
      setAnimateIndicator(shouldAnimate);
      setIndicator((prev) =>
        prev && prev.left === next.left && prev.width === next.width ? prev : next
      );
    },
    [tab]
  );

  useLayoutEffect(() => {
    if (!user) return;
    const changed = prevTabRef.current !== null && prevTabRef.current !== tab;
    prevTabRef.current = tab;
    measureIndicator(changed);
    const activeBtn = tabBtnRefs.current[tab];
    if (changed && activeBtn && typeof activeBtn.scrollIntoView === 'function') {
      activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [tab, user, measureIndicator, accounts.length, quarantine.length]);

  useEffect(() => {
    if (!user) return;
    const track = navTrackRef.current;
    const snap = () => measureIndicator(false);
    let obs: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined' && track) {
      obs = new ResizeObserver(snap);
      obs.observe(track);
    }
    let cancelled = false;
    if (typeof document !== 'undefined' && 'fonts' in document && document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        if (!cancelled) snap();
      });
    }
    return () => {
      cancelled = true;
      obs?.disconnect();
    };
  }, [user, measureIndicator]);

  const reducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (booting) {
    return (
      <TipProvider>
        <div className="min-h-screen flex items-center justify-center bg-[#F5F6F7] text-[13px] font-medium text-[#71717A]">
          Đang khởi tạo không gian làm việc...
        </div>
        <ComeyToaster />
      </TipProvider>
    );
  }

  if (!user) {
    return (
      <TipProvider>
        <Suspense
          fallback={
            <div className="min-h-screen flex items-center justify-center bg-[#F5F6F7] text-[13px] font-medium text-[#71717A]">
              Đang tải Comey...
            </div>
          }
        >
          <LandingAuthView
            onAuthenticated={(u, ws) => {
              setUser(u);
              setWorkspace(ws);
              void loadWorkspaceData(true);
            }}
          />
        </Suspense>
        <ComeyToaster />
      </TipProvider>
    );
  }

  return (
    <TipProvider>
        <div className="min-h-screen flex flex-col bg-[#F5F6F7] text-[#09090B] overflow-x-clip">
          <a className="skip-link" href="#main-content">
            Chuyển tới nội dung chính
          </a>

          {/* 2-Tier Sidebar-less Top Command Chrome */}
          <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-black/[0.08]">
            {/* Tier 1: Workspace Context & Actions */}
            <div className="border-b border-black/[0.06]">
              <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => navigate('overview')}
                    className="flex items-center gap-2.5 text-left cursor-pointer rounded-[8px] pr-1.5 py-1 hover:bg-[#F5F6F7] transition-colors duration-150 shrink-0"
                  >
                    <ComeyMark size={26} />
                    <span className="text-[14.5px] font-semibold tracking-[-0.02em] text-[#09090B]">
                      Comey
                    </span>
                  </button>

                  <span className="text-zinc-300 select-none hidden sm:inline" aria-hidden="true">
                    /
                  </span>

                  <div className="hidden sm:inline-flex items-center gap-2 rounded-[8px] border border-black/[0.07] bg-[#F5F6F7] px-2.5 py-1 min-w-0 max-w-[220px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#047857] cm-live-dot shrink-0" />
                    <span className="text-[12.5px] font-medium text-[#09090B] truncate">
                      {workspace?.name || 'Workspace'}
                    </span>
                    <span className="font-mono-num text-[10px] font-semibold text-[#047857] bg-[#ECFDF5] border border-[#A7F3D0] px-1.5 py-0.5 rounded-[4px] shrink-0">
                      Edge
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Tip label="Mở bảng lệnh nhanh" shortcut="⌘K" side="bottom">
                    <button
                      type="button"
                      onClick={() => setPaletteOpen(true)}
                      className="h-[34px] md:min-w-[208px] inline-flex items-center justify-between gap-2 rounded-[9px] bg-[#F5F6F7] hover:bg-[#EAECEF] border border-black/[0.08] px-2.5 text-[12.5px] text-[#52525B] cursor-pointer active:scale-[0.98] transition-[transform,background-color] duration-150"
                    >
                      <span className="inline-flex items-center gap-2 min-w-0">
                        <Search className="w-3.5 h-3.5 text-[#71717A] shrink-0" />
                        <span className="hidden sm:inline truncate">Tìm nhanh...</span>
                      </span>
                      <kbd className="hidden sm:inline font-mono-num text-[10.5px] text-[#71717A] bg-white px-1.5 py-0.5 rounded-[4px] border border-black/[0.08] shrink-0">
                        ⌘K
                      </kbd>
                    </button>
                  </Tip>

                  <QuickCreatePopover onQuickAction={handleQuickAction} />

                  <Tip label="Đồng bộ lại dữ liệu" side="bottom">
                    <button
                      type="button"
                      onClick={() => void loadWorkspaceData(false)}
                      disabled={refreshing}
                      aria-label="Làm mới dữ liệu"
                      className="h-[34px] w-[34px] inline-flex items-center justify-center rounded-[9px] border border-black/[0.09] bg-white hover:bg-[#F5F6F7] text-[#52525B] hover:text-[#09090B] active:scale-[0.96] transition-[transform,background-color,color] duration-150 cursor-pointer shrink-0"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                    </button>
                  </Tip>

                  <ProfilePopover
                    user={user}
                    workspace={workspace}
                    onNavigate={navigate}
                    onOpenPalette={() => setPaletteOpen(true)}
                    onLogout={() => void handleLogout()}
                  />
                </div>
              </div>
            </div>

            {/* Tier 2: Horizontal Scrollable Navigation Rail */}
            <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8">
              <nav
                ref={navTrackRef}
                aria-label="Điều hướng chính"
                className="relative flex items-center gap-1 overflow-x-auto no-scrollbar"
              >
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const active = tab === item.id;
                  return (
                    <button
                      key={item.id}
                      ref={(el) => {
                        tabBtnRefs.current[item.id] = el;
                      }}
                      type="button"
                      aria-current={active ? 'page' : undefined}
                      onClick={() => navigate(item.id)}
                      className={`relative inline-flex items-center gap-2 px-3 py-3 text-[13px] whitespace-nowrap cursor-pointer transition-colors duration-150 shrink-0 ${
                        active
                          ? 'text-[#09090B] font-semibold'
                          : 'text-[#52525B] font-medium hover:text-[#09090B]'
                      }`}
                    >
                      <Icon
                        className={`w-3.5 h-3.5 shrink-0 ${
                          active ? 'text-[#047857]' : 'text-[#71717A]'
                        }`}
                      />
                      <span>{item.label}</span>
                      {item.badge !== undefined && (
                        <span
                          className={`rounded-[5px] px-1.5 py-0.5 text-[10px] font-mono-num font-semibold shrink-0 leading-none ${
                            item.badgeTone === 'red'
                              ? 'bg-[#DC2626] text-white'
                              : 'bg-[#F5F6F7] text-[#52525B] border border-black/[0.08]'
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}

                {indicator && (
                  <span
                    aria-hidden="true"
                    style={{
                      width: `${indicator.width}px`,
                      transform: `translate3d(${indicator.left}px, 0, 0)`,
                      transition:
                        animateIndicator && !reducedMotion
                          ? 'transform 220ms var(--ease-out), width 220ms var(--ease-out)'
                          : 'none',
                    }}
                    className="pointer-events-none absolute bottom-0 left-0 h-[2px] rounded-full bg-[#09090B]"
                  />
                )}
              </nav>
            </div>
          </header>

          <main
            id="main-content"
            className="flex-1 min-w-0 w-full max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8"
          >
            {loadingData ? (
              <SkeletonCards />
            ) : (
              <Suspense fallback={<SkeletonCards />}>
                {tab === 'overview' && (
                  <OverviewPage
                    user={user}
                    workspace={workspace}
                    accounts={accounts}
                    rules={rules}
                    transactions={transactions}
                    sessions={sessions}
                    deliveries={deliveries}
                    quarantine={quarantine}
                    apiKeys={apiKeys}
                    onNavigate={navigate}
                    onQuickAction={handleQuickAction}
                    onOpenBankWithCode={handleOpenBankWithCode}
                    onOpenRuleWithFormat={handleOpenRuleWithFormat}
                  />
                )}
                {tab === 'accounts' && (
                  <BankAccountsPage
                    accounts={accounts}
                    banks={banks}
                    onReload={reloadAccounts}
                    onReloadRules={reloadRulesAndDeliveries}
                    onReloadAfterSim={reloadAfterSimulation}
                    onNotify={notify}
                    openCreateSignal={intent?.action === 'new-account' ? intent.seq : 0}
                    preselectedBankCode={
                      intent?.action === 'new-account' ? intent.bankCode : undefined
                    }
                  />
                )}
                {tab === 'routing' && (
                  <RoutingWebhooksPage
                    accounts={accounts}
                    rules={rules}
                    deliveries={deliveries}
                    onReload={reloadRulesAndDeliveries}
                    onNotify={notify}
                    openCreateSignal={intent?.action === 'new-rule' ? intent.seq : 0}
                    preselectedFormat={
                      intent?.action === 'new-rule' ? intent.payloadFormat : undefined
                    }
                  />
                )}
                {tab === 'transactions' && (
                  <TransactionsSimulatorPage
                    accounts={accounts}
                    transactions={transactions}
                    onReload={reloadAfterSimulation}
                    onPollTransactions={reloadTransactions}
                    onNotify={notify}
                    openSimSignal={intent?.action === 'simulate-tx' ? intent.seq : 0}
                  />
                )}
                {tab === 'sessions' && (
                  <SessionsPage
                    accounts={accounts}
                    sessions={sessions}
                    onReload={reloadSessions}
                    onReloadAfterSim={reloadAfterSimulation}
                    onNotify={notify}
                    dynamicQrSignal={intent?.action === 'dynamic-qr' ? intent.seq : 0}
                  />
                )}
                {tab === 'soundboxes' && (
                  <SoundboxPage
                    accounts={accounts}
                    soundboxes={soundboxes}
                    onReload={reloadSoundboxes}
                    onReloadAfterTest={reloadAfterSoundboxTest}
                    onNotify={notify}
                    openCreateSignal={intent?.action === 'new-soundbox' ? intent.seq : 0}
                  />
                )}
                {tab === 'quarantine' && (
                  <QuarantinePage
                    quarantine={quarantine}
                    onReload={reloadQuarantine}
                    onNotify={notify}
                  />
                )}
                {tab === 'security' && (
                  <SecurityPage
                    summary={securitySummary}
                    auditLogs={auditLogs}
                    onReload={reloadSecurity}
                    onLoggedOutAll={resetSessionState}
                    onNotify={notify}
                  />
                )}
                {tab === 'developers' && (
                  <DeveloperDocsPage
                    apiKeys={apiKeys}
                    accounts={accounts}
                    rules={rules}
                    onReload={reloadApiKeys}
                    onNavigate={navigate}
                    onNotify={notify}
                    openCreateSignal={intent?.action === 'new-apikey' ? intent.seq : 0}
                    openDeploySignal={intent?.action === 'deploy-guide' ? intent.seq : 0}
                  />
                )}
              </Suspense>
            )}
          </main>

          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            onNavigate={navigate}
            onQuickAction={handleQuickAction}
            accounts={accounts}
            transactions={transactions}
            sessions={sessions}
          />
        </div>
        <ComeyToaster />
      </TipProvider>
  );
}
