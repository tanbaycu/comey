import { CheckCircle2, Cloud, KeyRound, Mail, Terminal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { BrandIcon } from './BrandIcon';
import { CopyButton } from './CopyButton';
import { SegmentedControl } from './SegmentedControl';

type TerminalTab = 'cli' | 'wrangler' | 'secrets' | 'routing';

export function TerminalCodeKit({
  onNotify,
}: {
  onNotify?: (kind: 'success' | 'error', text: string) => void;
}) {
  const defaultProdUrl =
    typeof window !== 'undefined' && window.location.protocol === 'https:'
      ? window.location.origin
      : 'https://pay.yourdomain.vn';

  const [workerName, setWorkerName] = useState('comey-cloud');
  const [prodUrl, setProdUrl] = useState(defaultProdUrl);
  const [inboundDomain, setInboundDomain] = useState('in.yourdomain.vn');
  const [tab, setTab] = useState<TerminalTab>('cli');

  const safeWorker = (workerName.trim() || 'comey-cloud').replace(/[^a-zA-Z0-9_-]/g, '-');
  const safeProdUrl = (prodUrl.trim() || 'https://pay.yourdomain.vn').replace(/\/+$/, '');
  const safeInbound = (inboundDomain.trim() || 'in.yourdomain.vn').replace(/^@+/, '');

  const snippetSpec = useMemo(() => {
    if (tab === 'wrangler') {
      return {
        filename: 'apps/cloud/wrangler.jsonc',
        hint: 'Thay database_id bằng ID trả về từ lệnh wrangler d1 create rồi deploy.',
        code: JSON.stringify(
          {
            $schema: 'node_modules/wrangler/config-schema.json',
            name: safeWorker,
            main: 'src/index.ts',
            compatibility_date: '2025-10-01',
            observability: {
              enabled: true,
              traces: { enabled: true },
            },
            d1_databases: [
              {
                binding: 'DB',
                database_name: 'comey-db',
                database_id: '<PASTE_D1_DATABASE_ID>',
                migrations_dir: 'migrations',
              },
            ],
            triggers: {
              crons: ['* * * * *'],
            },
            assets: {
              directory: './public',
              not_found_handling: 'single-page-application',
              run_worker_first: ['/health', '/v1/*', '/p/*', '/api/*', '/soundbox/*', '/qr'],
            },
            vars: {
              INBOUND_EMAIL_DOMAIN: safeInbound,
              PUBLIC_BASE_URL: safeProdUrl,
              ALLOW_PUBLIC_SIGNUP: 'false',
            },
          },
          null,
          2
        ),
      };
    }

    if (tab === 'secrets') {
      return {
        filename: `bash — Secrets cho Worker (${safeWorker})`,
        hint: 'Chạy 3 lệnh secret put để mã hóa token & ký cookie HttpOnly trên Production.',
        code: [
          '# 1. Sinh chuỗi secret 32-byte Base64 ngẫu nhiên tại máy',
          'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
          '',
          `# 2. Nạp bí mật lên Cloudflare Worker (${safeWorker})`,
          'pnpm --filter @comey/cloud exec wrangler secret put MASTER_ENCRYPTION_KEY',
          'pnpm --filter @comey/cloud exec wrangler secret put SESSION_SECRET',
          'pnpm --filter @comey/cloud exec wrangler secret put ADMIN_BOOTSTRAP_KEY',
        ].join('\n'),
      };
    }

    if (tab === 'routing') {
      return {
        filename: `Cloudflare Email Routing (*@${safeInbound})`,
        hint: 'Đấu catch-all tên miền vào Worker và kiểm tra /health sau khi lên sóng.',
        code: [
          '# Bước A — Cloudflare Dashboard -> Email -> Email Routing -> Routing Rules:',
          `#   Catch-all address: *@${safeInbound}  ->  Action: Send to a Worker (${safeWorker})`,
          '',
          '# Bước B — Trên Gmail nhận biến động số dư:',
          `#   Settings -> Forwarding -> Add a forwarding address -> dán địa chỉ *@${safeInbound}`,
          '',
          '# Bước C — Kiểm tra sức khỏe Edge Worker + D1:',
          `curl -sS ${safeProdUrl}/health`,
        ].join('\n'),
      };
    }

    return {
      filename: 'bash — Cloudflare CLI Deploy',
      hint: 'Build trọn bộ monorepo, khởi tạo D1 và đẩy thẳng lên Cloudflare Edge trong 1 phút.',
      code: [
        '# 1. Cài đặt & build Dashboard + Cloud Worker',
        'pnpm install',
        'pnpm build',
        '',
        '# 2. Tạo Cloudflare D1 database (lấy database_id gán vào wrangler.jsonc)',
        'pnpm --filter @comey/cloud exec wrangler d1 create comey-db',
        '',
        '# 3. Chạy D1 migrations trên remote & Deploy lên Cloudflare Edge',
        'pnpm --filter @comey/cloud exec wrangler d1 migrations apply DB --remote',
        'pnpm --filter @comey/cloud exec wrangler deploy',
      ].join('\n'),
    };
  }, [tab, safeWorker, safeProdUrl, safeInbound]);

  return (
    <div className="cm-panel overflow-hidden min-w-0">
      <div className="cm-studio-surface p-5 sm:p-6 border-b border-black/[0.07] space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <BrandIcon id="cloudflare" size={18} tile label="Cloudflare" />
              <BrandIcon id="sqlite" size={18} tile label="Cloudflare D1" />
              <h3 className="text-[16px] font-semibold tracking-[-0.02em] text-[#09090B]">
                Bộ cấu hình Deploy Cloudflare Workers &amp; D1
              </h3>
            </div>
            <p className="text-[13px] text-[#52525B]">
              Nhập domain của bạn để tự động sinh toàn bộ lệnh CLI, file{' '}
              <code className="font-mono-num text-[12px] text-[#09090B]">wrangler.jsonc</code> và cấu
              hình Email Routing chuẩn Production.
            </p>
          </div>

          <span className="inline-flex items-center gap-1.5 rounded-[7px] bg-white border border-black/[0.08] px-2.5 py-1 text-[11.5px] font-medium text-[#047857]">
            <Cloud className="w-3.5 h-3.5" />
            Zero Cold-Start Edge
          </span>
        </div>

        {/* Dynamic Parameter Inputs */}
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-[10px] bg-white border border-black/[0.08] p-3">
            <label
              htmlFor="deploy-worker-name"
              className="block text-[11px] font-semibold text-[#71717A] mb-1"
            >
              Worker Name
            </label>
            <input
              id="deploy-worker-name"
              type="text"
              value={workerName}
              onChange={(e) => setWorkerName(e.target.value)}
              placeholder="comey-cloud"
              className="cm-input h-9 min-h-[36px] font-mono-num text-[12.5px]"
            />
          </div>

          <div className="rounded-[10px] bg-white border border-black/[0.08] p-3">
            <label
              htmlFor="deploy-prod-url"
              className="block text-[11px] font-semibold text-[#71717A] mb-1"
            >
              Production HTTPS URL
            </label>
            <input
              id="deploy-prod-url"
              type="url"
              value={prodUrl}
              onChange={(e) => setProdUrl(e.target.value)}
              placeholder="https://pay.yourdomain.vn"
              className="cm-input h-9 min-h-[36px] font-mono-num text-[12.5px]"
            />
          </div>

          <div className="rounded-[10px] bg-white border border-black/[0.08] p-3">
            <label
              htmlFor="deploy-inbound-domain"
              className="block text-[11px] font-semibold text-[#71717A] mb-1"
            >
              Inbound Email Domain
            </label>
            <input
              id="deploy-inbound-domain"
              type="text"
              value={inboundDomain}
              onChange={(e) => setInboundDomain(e.target.value)}
              placeholder="in.yourdomain.vn"
              className="cm-input h-9 min-h-[36px] font-mono-num text-[12.5px]"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl
            size="sm"
            value={tab}
            onChange={setTab}
            ariaLabel="Chọn bước cấu hình triển khai"
            options={[
              { value: 'cli', label: '1. CLI Deploy' },
              { value: 'wrangler', label: '2. wrangler.jsonc' },
              { value: 'secrets', label: '3. Secrets & Env' },
              { value: 'routing', label: '4. Email Routing' },
            ]}
          />

          <div className="flex items-center gap-2 text-[12px] text-[#52525B]">
            {tab === 'secrets' ? (
              <KeyRound className="w-3.5 h-3.5 text-[#047857] shrink-0" />
            ) : tab === 'routing' ? (
              <Mail className="w-3.5 h-3.5 text-[#047857] shrink-0" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 text-[#047857] shrink-0" />
            )}
            <span>{snippetSpec.hint}</span>
          </div>
        </div>
      </div>

      {/* Studio Terminal Surface */}
      <div className="p-4 sm:p-5 bg-[#F5F6F7]/70">
        <div className="cm-terminal overflow-hidden">
          <div className="px-4 py-2.5 border-b border-white/[0.08] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Terminal className="w-3.5 h-3.5 text-[#34D399] shrink-0" />
              <span className="font-mono-num text-[12px] font-medium text-zinc-200 truncate">
                {snippetSpec.filename}
              </span>
            </div>

            <CopyButton
              value={snippetSpec.code}
              label="Sao chép cấu hình"
              variant="dark"
              size="xs"
              className="border-white/15 bg-white/10 hover:bg-white/15"
              onCopied={(ok) =>
                onNotify?.(
                  ok ? 'success' : 'error',
                  ok ? `Đã sao chép ${snippetSpec.filename}` : 'Không thể sao chép'
                )
              }
            />
          </div>

          <pre className="p-4 text-[12.5px] font-mono-num leading-relaxed text-zinc-100 overflow-x-auto">
            <code>{snippetSpec.code}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
