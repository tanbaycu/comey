import type { PaymentSession, StorageAdapter, UnifiedTransaction } from '../types.js';

export class MemoryStorageAdapter implements StorageAdapter {
  private readonly processed = new Map<string, number | null>();
  private readonly transactions = new Map<string, UnifiedTransaction>();
  private readonly sessionsById = new Map<string, PaymentSession>();
  private readonly sessionIdByOrderCode = new Map<string, string>();
  private readonly sessionIdByShortId = new Map<string, string>();

  async hasProcessedTx(txId: string): Promise<boolean> {
    const exp = this.processed.get(txId);
    if (exp === undefined) return false;
    if (exp !== null && Date.now() > exp) {
      this.processed.delete(txId);
      return false;
    }
    return true;
  }

  async markProcessedTx(txId: string, ttlSeconds?: number): Promise<void> {
    const exp = ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null;
    this.processed.set(txId, exp);
  }

  async saveTransaction(tx: UnifiedTransaction): Promise<void> {
    this.transactions.set(tx.id, tx);
  }

  async getTransaction(id: string): Promise<UnifiedTransaction | null> {
    return this.transactions.get(id) ?? null;
  }

  async getSessionByOrderCode(orderCode: string): Promise<PaymentSession | null> {
    const id = this.sessionIdByOrderCode.get(orderCode.trim().toUpperCase());
    return id ? this.sessionsById.get(id) ?? null : null;
  }

  async getSessionByShortId(shortId: string): Promise<PaymentSession | null> {
    const id = this.sessionIdByShortId.get(shortId);
    return id ? this.sessionsById.get(id) ?? null : null;
  }

  async saveSession(session: PaymentSession): Promise<void> {
    this.sessionsById.set(session.id, session);
    this.sessionIdByOrderCode.set(session.orderCode.trim().toUpperCase(), session.id);
    this.sessionIdByShortId.set(session.shortId, session.id);
  }
}
