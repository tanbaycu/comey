import type { RawEmailInput } from '../../src/types.js';

export const CAKE_HTML_TABLE_EMAIL: RawEmailInput = {
  source: 'email_worker',
  messageId: '<cake-html-table@cake.vn>',
  from: 'Cake by VPBank <no-reply@cake.vn>',
  to: 'acc_demo@in.comey.vn',
  subject: 'Thông báo biến động số dư tài khoản',
  date: 'Thu, 26 Nov 2026 09:15:02 +0700',
  authenticationResults:
    'mx.cloudflare.net; dkim=pass header.d=cake.vn header.b=AbCdEf; spf=pass smtp.mailfrom=cake.vn; dmarc=pass',
  htmlBody: `
    <html>
      <body>
        <style>.muted { color: #666; }</style>
        <p>Xin chào TRAN MINH TAN,</p>
        <table>
          <tr><td>Tài khoản nhận</td><td>0835117727 - Tài khoản thanh toán</td></tr>
          <tr><td>Số tiền</td><td>+80.000 đ</td></tr>
          <tr><td>Ngày giờ giao dịch</td><td>26/11/2026 09:15:02</td></tr>
          <tr><td>Mã giao dịch</td><td>FT26330123456789</td></tr>
          <tr><td>Tên người chuyển</td><td>NGUYEN VAN A</td></tr>
          <tr><td>Ngân hàng chuyển</td><td>VCB</td></tr>
          <tr><td>Nội dung giao dịch</td><td>MUA950961 Cảm ơn bạn đã sử dụng dịch vụ của Cake!</td></tr>
        </table>
      </body>
    </html>
  `,
};

export const CAKE_INLINE_COLON_EMAIL: RawEmailInput = {
  source: 'apps_script',
  messageId: 'msg_inline_01',
  from: 'no-reply@cake.vn',
  subject: 'Thông báo biến động số dư',
  authenticationResults: 'mx.google.com; dkim=pass header.d=cake.vn; spf=pass',
  textBody: `
Tài khoản thụ hưởng: 0835117727
Số tiền: +150,000đ
Ngày giờ giao dịch: 26/11/2026 10:05:30
Mã giao dịch: CK202611260001
Tên người chuyển: LE THI B
Ngân hàng chuyển: Techcombank
Nội dung giao dịch: NAP 881122
  `,
};

export const CAKE_MULTILINE_SPLIT_EMAIL: RawEmailInput = {
  source: 'email_worker',
  messageId: 'msg_multiline_01',
  from: 'no-reply@cake.vn',
  subject: 'Thông báo giao dịch Cake',
  authenticationResults: 'mx.cloudflare.net; dkim=pass header.i=@mail.cake.vn',
  htmlBody: `
    <div>
      <div>Số tài khoản nhận</div>
      <div>0835117727</div>
      <div>Số tiền</div>
      <div>+250.000 đ</div>
      <div>Mã giao dịch</div>
      <div>FT9988776655</div>
      <div>Ngày giờ giao dịch</div>
      <div>26/11/2026 11:20:00</div>
      <div>Nội dung giao dịch</div>
      <div>BOT778899</div>
    </div>
  `,
};

export const CAKE_OUTGOING_EMAIL: RawEmailInput = {
  source: 'email_worker',
  messageId: 'msg_outgoing_01',
  from: 'no-reply@cake.vn',
  subject: 'Thông báo biến động số dư',
  authenticationResults: 'mx.cloudflare.net; dkim=pass header.d=cake.vn',
  htmlBody: `
    <table>
      <tr><td>Tài khoản nguồn</td><td>0835117727</td></tr>
      <tr><td>Số tiền</td><td>-50.000 đ</td></tr>
      <tr><td>Mã giao dịch</td><td>FT0000001111</td></tr>
      <tr><td>Nội dung giao dịch</td><td>Chuyen tien ra</td></tr>
    </table>
  `,
};

export const CAKE_BROKEN_TEMPLATE_EMAIL: RawEmailInput = {
  source: 'email_worker',
  messageId: 'msg_broken_01',
  from: 'no-reply@cake.vn',
  subject: 'Thông báo biến động số dư tài khoản',
  authenticationResults: 'mx.cloudflare.net; dkim=pass header.d=cake.vn',
  htmlBody: `
    <div>Thông báo biến động số dư</div>
    <p>Tài khoản nhận: 0835117727</p>
    <p>Biến động mới vừa phát sinh nhưng mẫu HTML mới không còn nhãn số tiền.</p>
  `,
};

export const CAKE_PROMO_EMAIL: RawEmailInput = {
  source: 'email_worker',
  messageId: 'msg_promo_01',
  from: 'hello@cake.vn',
  subject: 'Ưu đãi hoàn tiền cuối tuần cùng Cake!',
  authenticationResults: 'mx.cloudflare.net; dkim=pass header.d=cake.vn',
  htmlBody: `<p>Mở thẻ tín dụng Cake ngay hôm nay để nhận hoàn tiền 20%.</p>`,
};

// RFC822 MIME email with UTF-8 quoted-printable Vietnamese body ("Cộng 120.000 đ", "Số tiền", "Nội dung giao dịch")
export const CAKE_RAW_MIME_QUOTED_PRINTABLE = [
  'From: "Cake by VPBank" <no-reply@cake.vn>',
  'To: merchant@in.comey.vn',
  'Subject: =?UTF-8?B?VGjDtG5nIGLDoW8gYmnhur9uIMSR4buZbmcgc+G7kSBkxrA=?=',
  'Date: Thu, 26 Nov 2026 12:30:00 +0700',
  'Message-ID: <mime-qp-01@cake.vn>',
  'Authentication-Results: mx.cloudflare.net; dkim=pass header.d=cake.vn; spf=pass; dmarc=pass',
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative; boundary="bnd_cake_001"',
  '',
  '--bnd_cake_001',
  'Content-Type: text/plain; charset=UTF-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'T=C3=A0i kho=E1=BA=A3n nh=E1=BA=ADn: 0835117727',
  'S=E1=BB=91 ti=E1=BB=81n: +120.000 =C4=91',
  'M=C3=A3 giao d=E1=BB=8Bch: FTQP20261126',
  'Ng=C3=A0y gi=E1=BB=9D giao d=E1=BB=8Bch: 26/11/2026 12:30:00',
  'N=E1=BB=99i dung giao d=E1=BB=8Bch: MUA112233 thanh to=C3=A1n =C4=91=C6=A1n',
  '--bnd_cake_001--',
  '',
].join('\r\n');

export const CAKE_SPOOFED_UNALIGNED_DKIM_EMAIL: RawEmailInput = {
  ...CAKE_HTML_TABLE_EMAIL,
  messageId: 'msg_spoof_01',
  authenticationResults:
    'mx.cloudflare.net; dkim=pass header.d=attacker-domain.com; spf=fail; dmarc=fail',
};

export const GMAIL_FORWARDING_CONFIRMATION_EMAIL: RawEmailInput = {
  source: 'email_worker',
  messageId: 'msg_fwd_google_01',
  from: 'Gmail Team <forwarding-noreply@google.com>',
  to: 'acc_demo@in.comey.vn',
  subject: 'Gmail Forwarding Confirmation - Receive Mail from shopowner@gmail.com',
  authenticationResults: 'mx.cloudflare.net; dkim=pass header.d=google.com; spf=pass',
  textBody: `
shopowner@gmail.com has requested to automatically forward mail to your email address acc_demo@in.comey.vn.
Confirmation code: 482910374

To allow shopowner@gmail.com to automatically forward mail to your address, please click the link below to confirm the request:
https://mail-settings.google.com/mail/vf-%5B123456%5D-AbCdEf
  `,
};
