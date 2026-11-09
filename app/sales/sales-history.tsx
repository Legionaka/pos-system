'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Database } from '@/lib/supabase/database';
import { signOutAction } from '@/app/auth/actions';
import type { StoreSettings } from '@/lib/store-settings';
import { RefundForm } from './refund-form';

type SaleStatus = Database['public']['Enums']['sale_status'];
type PaymentMethod = Database['public']['Enums']['payment_method'];
type DateFilter = 'all' | 'day' | 'week' | 'month';
type StatusFilter = 'all' | 'completed' | 'voided' | 'returned';

export type SaleHistoryEntry = {
  id: string;
  number: number;
  cashierId: string;
  cashierName: string;
  status: SaleStatus;
  subtotalCents: number;
  vatCents: number;
  discountCents: number;
  roundingCents: number;
  refundedRoundingCents: number;
  totalCents: number;
  cashReceivedCents: number;
  changeCents: number;
  createdAt: string;
  items: Array<{
    id: string;
    name: string;
    sku: string;
    qty: number;
    unitPriceCents: number;
    discountCents: number;
    lineTotalCents: number;
    taxCategory: Database['public']['Enums']['tax_category'];
    vatCents: number;
    refundedQty: number;
    refundedAmountCents: number;
  }>;
  payments: Array<{
    method: PaymentMethod;
    amountCents: number;
    receivedCents: number | null;
    changeCents: number | null;
    reference: string | null;
  }>;
  refunds: Array<{ number: number; reason: string; totalCents: number; createdAt: string; payments: Array<{ method: PaymentMethod; amountCents: number; reference: string | null }> }>;
};

const money = (cents: number) => `R${(cents / 100).toFixed(2)}`;
const dateFormatter = new Intl.DateTimeFormat('en-ZA', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Johannesburg',
});
const paymentLabels: Record<PaymentMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  eft: 'EFT',
  qr: 'QR payment',
};
const statusLabels: Record<SaleStatus, string> = {
  completed: 'Completed',
  voided: 'Voided',
  refunded: 'Refunded',
  partially_refunded: 'Partially refunded',
};

export function SalesHistory({
  entries,
  viewerName,
  role,
  homeHref,
  loadError,
  store,
  refundDataAvailable,
  referenceTime,
}: {
  entries: SaleHistoryEntry[];
  viewerName: string;
  role: 'cashier' | 'manager' | 'owner' | 'dev';
  homeHref: string;
  loadError: string | null;
  store: StoreSettings;
  refundDataAvailable: boolean;
  referenceTime: number;
}) {
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedSale, setSelectedSale] = useState<SaleHistoryEntry | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (selectedSale && !dialog.open) dialog.showModal();
    if (!selectedSale && dialog.open) dialog.close();
  }, [selectedSale]);

  const visibleEntries = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const cutoff = dateFilter === 'day' ? referenceTime - 24 * 60 * 60 * 1000
      : dateFilter === 'week' ? referenceTime - 7 * 24 * 60 * 60 * 1000
        : dateFilter === 'month' ? referenceTime - 30 * 24 * 60 * 60 * 1000
          : null;
    return entries.filter((entry) => {
      const dateMatch = cutoff === null || new Date(entry.createdAt).getTime() >= cutoff;
      const statusMatch = statusFilter === 'all'
        || (statusFilter === 'completed' && entry.status === 'completed')
        || (statusFilter === 'voided' && entry.status === 'voided')
        || (statusFilter === 'returned' && (entry.status === 'refunded' || entry.status === 'partially_refunded'));
      const searchable = [
        String(entry.number),
        entry.cashierName,
        ...entry.items.flatMap((item) => [item.name, item.sku]),
        ...entry.payments.map((payment) => paymentLabels[payment.method]),
      ].join(' ').toLocaleLowerCase();
      return dateMatch && statusMatch && (!query || searchable.includes(query));
    });
  }, [entries, search, dateFilter, statusFilter, referenceTime]);

  function closeReceipt() {
    if (dialogRef.current?.open) dialogRef.current.close();
    setSelectedSale(null);
  }

  function showReceipt(entry: SaleHistoryEntry) {
    setSelectedSale(entry);
  }

  return (
    <main className="sales-app">
      <header className="sales-topbar">
        <Link className="sales-brand" href={homeHref} aria-label={`Return to ${store.storeName} workspace`}>
          {store.logoUrl ? <img src={store.logoUrl} alt="" width={36} height={36} /> : <span className="sales-brand-mark">{store.storeName.slice(0, 1).toUpperCase()}</span>}
          <span>{store.storeName}</span>
        </Link>
        <div className="sales-user-area">
          <Link className="sales-back-link" href={homeHref}>{role === 'cashier' ? 'Point of sale' : role === 'owner' ? 'Owner dashboard' : 'Catalog'}</Link>
          <div><span>{role === 'cashier' ? 'Cashier workspace' : role === 'owner' ? 'Owner workspace' : 'Manager workspace'}</span><strong>{viewerName}</strong></div>
          <form action={signOutAction}><button className="sales-signout" type="submit">Sign out</button></form>
        </div>
      </header>

      <div className="sales-content">
        <div className="sales-heading-row">
          <div>
            <p className="sales-eyebrow">STORE WORKSPACE / TRANSACTIONS</p>
            <h1>Sales history</h1>
            <p className="sales-subtitle">Review recent transactions and print a customer receipt.</p>
          </div>
          <span className="sales-count">Up to 100 latest sales</span>
        </div>

        {loadError && <p className="sales-alert" role="alert">{loadError}</p>}

        <section className="sales-list-card" aria-label="Transaction history">
          <div className="sales-filters">
            <label className="sales-search">
              <span className="sales-sr-only">Search by sale number, cashier, item, SKU, or payment method</span>
              <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.2 4.2" /></svg>
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search transactions" />
            </label>
            <label className="sales-filter-label"><span>Date</span>
              <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as DateFilter)}>
                <option value="all">All recent</option><option value="day">Last 24 hours</option><option value="week">Last 7 days</option><option value="month">Last 30 days</option>
              </select>
            </label>
            <label className="sales-filter-label"><span>Status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
                <option value="all">All statuses</option><option value="completed">Completed</option><option value="voided">Voided</option><option value="returned">Refunded</option>
              </select>
            </label>
            <span className="sales-visible-count">{visibleEntries.length} shown</span>
          </div>

          <div className="sales-record-list">
            {visibleEntries.map((entry) => {
              const itemCount = entry.items.reduce((sum, item) => sum + item.qty, 0);
              const methods = [...new Set(entry.payments.map((payment) => paymentLabels[payment.method]))].join(' · ') || 'Payment details unavailable';
              return (
                <button className="sales-record" type="button" key={entry.id} onClick={() => showReceipt(entry)}>
                  <span className="sales-record-main"><strong>Sale #{entry.number}</strong><small>{dateFormatter.format(new Date(entry.createdAt))}</small></span>
                  <span className="sales-record-cashier"><strong>{entry.cashierName}</strong><small>{itemCount} {itemCount === 1 ? 'item' : 'items'} · {methods}</small></span>
                  <span className={`sales-status is-${entry.status}`}><span className="sales-sr-only">Status: </span>{statusLabels[entry.status]}</span>
                  <span className="sales-record-total">{money(entry.totalCents)}<svg aria-hidden="true" viewBox="0 0 20 20"><path d="m7 4 6 6-6 6" /></svg></span>
                </button>
              );
            })}
            {visibleEntries.length === 0 && (
              <div className="sales-empty">
                <span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 5h16v15H4zM8 9h8M8 13h5" /></svg></span>
                <h2>{entries.length ? 'No transactions match these filters' : 'No sales yet'}</h2>
                <p>{entries.length ? 'Try a different search term or widen the date and status filters.' : 'Completed sales will appear here. Open the point of sale to record the first transaction.'}</p>
                {!entries.length && <Link className="sales-button" href={homeHref}>Go to workspace</Link>}
              </div>
            )}
          </div>
        </section>
      </div>

      <dialog
        className="sales-receipt-dialog"
        ref={dialogRef}
        aria-labelledby="sales-receipt-title"
        onClose={() => setSelectedSale(null)}
        onClick={(event) => { if (event.target === dialogRef.current) closeReceipt(); }}
      >
        {selectedSale && <Receipt
          key={selectedSale.id}
          entry={selectedSale}
          onClose={closeReceipt}
          onRefundRecorded={() => { closeReceipt(); router.refresh(); }}
          store={store}
          canRefund={refundDataAvailable && (role === 'manager' || role === 'owner')}
        />}
      </dialog>
    </main>
  );
}

function Receipt({ entry, onClose, onRefundRecorded, store, canRefund }: {
  entry: SaleHistoryEntry;
  onClose: () => void;
  onRefundRecorded: () => void;
  store: StoreSettings;
  canRefund: boolean;
}) {
  const [refundOpen, setRefundOpen] = useState(false);
  const refundable = entry.status === 'completed' || entry.status === 'partially_refunded';
  return (
    <article className="sales-receipt">
      <div className="sales-receipt-actions">
        <button className="sales-icon-button" type="button" aria-label="Close receipt" onClick={onClose}><svg aria-hidden="true" viewBox="0 0 20 20"><path d="m5 5 10 10M15 5 5 15" /></svg></button>
      </div>
      <header className="sales-receipt-heading">
        {store.logoUrl ? <img src={store.logoUrl} alt="" width={42} height={42} /> : <span className="sales-receipt-brand-mark">{store.storeName.slice(0, 1).toUpperCase()}</span>}
        <strong>{store.storeName}</strong>
        <span>Store receipt</span>
      </header>
      <div className="sales-receipt-meta">
        <h2 id="sales-receipt-title">Sale #{entry.number}</h2>
        <span>{statusLabels[entry.status]}</span>
        <p>{dateFormatter.format(new Date(entry.createdAt))}</p>
        <p>Served by {entry.cashierName}</p>
      </div>
      <div className="sales-receipt-items">
        {entry.items.map((item, index) => (
          <div className="sales-receipt-item" key={`${item.sku}-${index}`}>
            <div><strong>{item.name}</strong><small>{item.sku} · {item.qty} × {money(item.unitPriceCents)}</small></div>
            <span>{money(item.lineTotalCents)}</span>
            {item.discountCents > 0 && <small className="sales-receipt-discount">Discount −{money(item.discountCents)}</small>}
          </div>
        ))}
        {entry.items.length === 0 && <p>Item details are unavailable.</p>}
      </div>
      <div className="sales-receipt-totals">
        <div><span>Subtotal</span><strong>{money(entry.subtotalCents)}</strong></div>
        {entry.discountCents > 0 && <div><span>Discount</span><strong>−{money(entry.discountCents)}</strong></div>}
        <div><span>VAT included</span><strong>{money(entry.vatCents)}</strong></div>
        {entry.roundingCents !== 0 && <div><span>Cash rounding</span><strong>{entry.roundingCents > 0 ? '+' : '−'}{money(Math.abs(entry.roundingCents))}</strong></div>}
        <div className="sales-receipt-grand"><span>Total</span><strong>{money(entry.totalCents)}</strong></div>
      </div>
      <div className="sales-receipt-payments">
        <h3>Payment</h3>
        {entry.payments.map((payment, index) => (
          <div key={`${payment.method}-${index}`}>
            <span>{paymentLabels[payment.method]}{payment.reference ? ` · ${payment.reference}` : ''}</span>
            <strong>{money(payment.amountCents)}</strong>
            {payment.method === 'cash' && payment.receivedCents !== null && <small>Cash received {money(payment.receivedCents)} · Change {money(payment.changeCents ?? 0)}</small>}
          </div>
        ))}
        {!entry.payments.length && entry.cashReceivedCents > 0 && <p>Cash received {money(entry.cashReceivedCents)} · Change {money(entry.changeCents)}</p>}
      </div>
      {entry.status === 'partially_refunded' || entry.status === 'refunded' ? <section className="sales-receipt-refunds"><h3>Refund activity</h3>{entry.refunds.length ? entry.refunds.map((refund) => <article key={refund.number}><div><strong>Refund #{refund.number}</strong><time>{dateFormatter.format(new Date(refund.createdAt))}</time></div><p>{refund.reason}</p><strong>{money(refund.totalCents)}</strong>{refund.payments.map((payment, index) => <small key={`${payment.method}-${index}`}>{paymentLabels[payment.method]} payout{payment.reference ? ` · ${payment.reference}` : ''}: {money(payment.amountCents)}</small>)}</article>) : <p>Refunds have been recorded. Ask a manager for payout details.</p>}</section> : null}
      {canRefund && refundable && !refundOpen && (
        <div className="sales-refund-launch"><button className="sales-button sales-button--secondary" type="button" onClick={() => setRefundOpen(true)}>Refund items</button></div>
      )}
      {canRefund && refundable && refundOpen && (
        <RefundForm
          saleId={entry.id}
          items={entry.items}
          roundingCents={entry.roundingCents}
          refundedRoundingCents={entry.refundedRoundingCents}
          onCancel={() => setRefundOpen(false)}
          onSuccess={onRefundRecorded}
        />
      )}
      <footer className="sales-receipt-footer">
        <span>Thank you for shopping with us.</span>
        <button className="sales-button" type="button" onClick={() => window.print()}>Print receipt</button>
      </footer>
    </article>
  );
}
