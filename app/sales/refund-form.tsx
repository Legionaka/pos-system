'use client';

import { useActionState, useMemo, useState } from 'react';
import { recordRefundAction } from './actions';
import type { SaleHistoryEntry } from './sales-history';

type RefundLine = SaleHistoryEntry['items'][number];
const money = (cents: number) => `R${(cents / 100).toFixed(2)}`;

export function RefundForm({ saleId, items, roundingCents, refundedRoundingCents, onCancel, onSuccess }: {
  saleId: string;
  items: RefundLine[];
  roundingCents: number;
  refundedRoundingCents: number;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [state, action, pending] = useActionState(recordRefundAction, null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const eligibleItems = useMemo(() => items.filter((item) => item.qty > item.refundedQty), [items]);
  const preview = useMemo(() => {
    let subtotal = 0;
    let completesAllItems = eligibleItems.length > 0;
    let valid = true;
    let hasSelection = false;
    for (const item of items) {
      const requestedQty = Number(quantities[item.id] ?? 0);
      if (!Number.isInteger(requestedQty) || requestedQty < 0 || requestedQty > item.qty - item.refundedQty) {
        completesAllItems = false;
        valid = false;
        continue;
      }
      const remainingQty = item.qty - item.refundedQty;
      if (item.refundedQty + requestedQty !== item.qty) completesAllItems = false;
      if (requestedQty > 0) {
        hasSelection = true;
        const remainingAmount = item.lineTotalCents - item.refundedAmountCents;
        subtotal += requestedQty === remainingQty
          ? remainingAmount
          : Math.round(item.lineTotalCents * requestedQty / item.qty);
      }
    }
    const rounding = completesAllItems ? roundingCents - refundedRoundingCents : 0;
    return { total: subtotal + rounding, completesAllItems, valid, hasSelection };
  }, [items, quantities, eligibleItems, roundingCents, refundedRoundingCents]);

  return (
    <section className="sales-refund-panel" aria-labelledby="sales-refund-title">
      <div className="sales-refund-heading">
        <div><p className="sales-eyebrow">MANAGER / OWNER APPROVAL</p><h3 id="sales-refund-title">Refund items</h3></div>
        <button className="sales-icon-button" type="button" aria-label="Cancel refund" onClick={onCancel}><svg aria-hidden="true" viewBox="0 0 20 20"><path d="m5 5 10 10M15 5 5 15" /></svg></button>
      </div>
      {state?.ok ? <div className="sales-refund-success" role="status"><p>{state.message}</p><button className="sales-button" type="button" onClick={onSuccess}>Close receipt</button></div> : (
        <form action={action} className="sales-refund-form">
          <input type="hidden" name="saleId" value={saleId} />
          {eligibleItems.length === 0 ? <p className="sales-refund-empty">All sale quantities have already been refunded.</p> : (
            <div className="sales-refund-lines">
              {eligibleItems.map((item) => {
                const remainingQty = item.qty - item.refundedQty;
                return <div className="sales-refund-line" key={item.id}>
                  <div className="sales-refund-product"><strong>{item.name}</strong><small>{item.sku} · {remainingQty} remaining</small></div>
                  <label className="sales-refund-qty">Qty<input
                    name={`qty_${item.id}`}
                    type="number"
                    min="0"
                    max={remainingQty}
                    step="1"
                    value={quantities[item.id] ?? '0'}
                    onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))}
                    aria-label={`Quantity to refund for ${item.name}`}
                  /></label>
                  <label className="sales-refund-restock"><input
                    name={`restock_${item.id}`}
                    type="checkbox"
                    checked={restock[item.id] ?? true}
                    onChange={(event) => setRestock((current) => ({ ...current, [item.id]: event.target.checked }))}
                  /> Restock</label>
                </div>;
              })}
            </div>
          )}
          <label className="sales-refund-field">Reason<textarea name="reason" required minLength={3} maxLength={250} placeholder="e.g. Item damaged or customer changed their mind" /></label>
          <div className="sales-refund-fields-row">
            <label className="sales-refund-field">Refund method<select name="method" defaultValue="cash"><option value="cash">Cash</option><option value="card">Card</option><option value="eft">EFT</option><option value="qr">QR payment</option></select></label>
            <label className="sales-refund-field">Reference <span>(optional)</span><input name="reference" maxLength={120} placeholder="Payment or terminal reference" /></label>
          </div>
          <div className="sales-refund-total"><span>Estimated refund{preview.completesAllItems ? ' · includes cash rounding' : ''}</span><strong>{money(Math.max(0, preview.total))}</strong></div>
          {state?.message && !state.ok && <p className="sales-alert" role="alert">{state.message}</p>}
          <p className="sales-refund-note">The database calculates and records the refund. Process the payout separately; this does not move money or reverse a card transaction. Restocking adds the returned quantity back to inventory.</p>
          <div className="sales-refund-actions"><button className="sales-button sales-button--secondary" type="button" onClick={onCancel}>Cancel</button><button className="sales-button" type="submit" disabled={pending || eligibleItems.length === 0 || !preview.valid || !preview.hasSelection || preview.total < 0}>{pending ? 'Recording refund…' : 'Confirm refund'}</button></div>
        </form>
      )}
    </section>
  );
}
