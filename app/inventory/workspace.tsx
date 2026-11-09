'use client';

import { useActionState, useMemo, useState } from 'react';
import { cancelInventoryCountAction, finishInventoryCountAction, receiveDeliveryAction, startInventoryCountAction } from './actions';

export type InventoryProduct = { id: string; sku: string; barcode: string | null; name: string; stock_qty: number; reorder_at: number; active: boolean; image_path: string | null };
type Delivery = { id: string; supplier_name: string; delivery_date: string; reference: string | null; notes: string | null; created_at: string };
export type DeliveryItem = { id: string; delivery_id: string; product_name: string; sku: string; qty: number; unit_cost_cents: number };
export type CountItem = { id: string; count_id: string; product_id: string; product_name: string; sku: string; expected_qty: number; counted_qty: number | null };
const money = (cents: number) => `R${(cents / 100).toFixed(2)}`;
const dateLabel = (date: string) => new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeZone: 'Africa/Johannesburg' }).format(new Date(`${date}T12:00:00+02:00`));

export function InventoryWorkspace({ products, deliveries, deliveryItems, activeCount, countItems }: {
  products: InventoryProduct[]; deliveries: Delivery[]; deliveryItems: DeliveryItem[];
  activeCount: { id: string; status: string; started_at: string } | null; countItems: CountItem[];
}) {
  const [query, setQuery] = useState('');
  const [countValues, setCountValues] = useState<Record<string, string>>(() => Object.fromEntries(countItems.map((item) => [item.id, item.counted_qty === null ? '' : String(item.counted_qty)])));
  const [receivingState, receiveAction, receiving] = useActionState(receiveDeliveryAction, null);
  const [startState, startAction, starting] = useActionState(startInventoryCountAction, null);
  const [countState, countAction, counting] = useActionState(finishInventoryCountAction, null);
  const activeProducts = products.filter((product) => product.active);
  const lowCount = products.filter((product) => product.active && product.stock_qty <= product.reorder_at).length;
  const visibleCountItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return countItems.filter((item) => !needle || `${item.product_name} ${item.sku}`.toLocaleLowerCase().includes(needle));
  }, [countItems, query]);
  const visibleCountIds = new Set(visibleCountItems.map((item) => item.id));
  const countedItemCount = countItems.filter((item) => (countValues[item.id] ?? '').trim() !== '').length;
  const varianceCount = countItems.filter((item) => (countValues[item.id] ?? '').trim() !== '' && Number(countValues[item.id]) !== item.expected_qty).length;

  return <div className="workspace-stack">
    <section className="workspace-metrics workspace-inventory-metrics"><article><span>Active products</span><strong>{activeProducts.length}</strong><small>Available to receive</small></article><article><span>Need replenishing</span><strong>{lowCount}</strong><small>At or below reorder point</small></article><article><span>Latest deliveries</span><strong>{deliveries.length}</strong><small>Up to 30 records</small></article></section>
    {activeCount ? <section className="workspace-card workspace-count-card"><div className="workspace-card-heading"><div><p className="workspace-eyebrow">CHECKOUT PAUSED</p><h2>Full-store stock count</h2><p>Started {new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Johannesburg' }).format(new Date(activeCount.started_at))}. Count every listed product before applying adjustments.</p></div></div>
      <form action={countAction} className="workspace-count-form"><input type="hidden" name="countId" value={activeCount.id} />{countItems.filter((item) => !visibleCountIds.has(item.id)).map((item) => <input key={item.id} type="hidden" name={`count_${item.id}`} value={countValues[item.id] ?? ''} />)}<div className="workspace-filters"><label className="workspace-search">Find product<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or SKU" /></label><span>{countedItemCount} of {countItems.length} counted · {varianceCount} variances</span></div>
        <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Product</th><th>Expected</th><th>Counted quantity</th><th>Variance</th></tr></thead><tbody>{visibleCountItems.map((item) => { const value = countValues[item.id] ?? ''; const variance = value.trim() === '' ? null : Number(value) - item.expected_qty; return <tr key={item.id}><td><strong>{item.product_name}</strong><small>{item.sku}</small></td><td>{item.expected_qty}</td><td><input className="workspace-count-input" name={`count_${item.id}`} type="number" min="0" step="1" required value={value} onChange={(event) => setCountValues((current) => ({ ...current, [item.id]: event.target.value }))} aria-label={`Counted quantity for ${item.product_name}`} /></td><td className={variance && variance !== 0 ? 'workspace-variance' : ''}>{variance === null ? '—' : variance > 0 ? `+${variance}` : variance}</td></tr>; })}</tbody></table></div>
        {countState?.message && <p className={countState.ok ? 'workspace-success' : 'workspace-alert'} role={countState.ok ? 'status' : 'alert'}>{countState.message}</p>}
        <p className="workspace-note">Review the variance column before applying. Stock adjustments are recorded as inventory movements.</p>
        <div className="workspace-count-actions"><button className="workspace-button workspace-button--quiet" type="submit" formAction={cancelInventoryCountAction} formNoValidate>Cancel count</button><button className="workspace-button" type="submit" disabled={counting || countedItemCount !== countItems.length}>{counting ? 'Applying…' : `Apply ${varianceCount} stock adjustments`}</button></div>
      </form>
    </section> : <section className="workspace-card workspace-count-start"><div><p className="workspace-eyebrow">FULL-STORE COUNT</p><h2>Reconcile physical stock</h2><p>Starting a count pauses checkout and all stock changes until the count is completed or cancelled.</p></div><form action={startAction}><button className="workspace-button" type="submit" disabled={starting}>{starting ? 'Starting…' : 'Start stock count'}</button></form>{startState?.message && <p className={startState.ok ? 'workspace-success' : 'workspace-alert'} role={startState.ok ? 'status' : 'alert'}>{startState.message}</p>}</section>}
    <section className="workspace-card"><div className="workspace-card-heading"><div><p className="workspace-eyebrow">SUPPLIER DELIVERY</p><h2>Receive inventory</h2><p>Stock changes and delivery history are recorded together.</p></div></div>
      <form action={receiveAction} className="workspace-form workspace-delivery-form"><div className="workspace-form-grid"><label>Supplier name<input name="supplier" required minLength={2} maxLength={120} placeholder="Supplier or wholesaler" /></label><label>Delivery date<input name="deliveryDate" type="date" required /></label><label>Reference <span>(optional)</span><input name="reference" maxLength={120} placeholder="Invoice or delivery note" /></label><label>Notes <span>(optional)</span><input name="notes" maxLength={500} placeholder="Delivery details" /></label></div>
        <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Product</th><th>On hand</th><th>Receive qty</th><th>Unit cost</th></tr></thead><tbody>{activeProducts.map((product) => <tr key={product.id}><td><strong>{product.name}</strong><small>{product.sku}</small></td><td>{product.stock_qty}</td><td><input className="workspace-count-input" name={`qty_${product.id}`} type="number" min="1" step="1" aria-label={`Receive quantity for ${product.name}`} /></td><td><input className="workspace-cost-input" name={`cost_${product.id}`} type="number" min="0" step="0.01" aria-label={`Unit cost for ${product.name}`} placeholder="R0.00" /></td></tr>)}</tbody></table></div>
        {receivingState?.message && <p className={receivingState.ok ? 'workspace-success' : 'workspace-alert'} role={receivingState.ok ? 'status' : 'alert'}>{receivingState.message}</p>}
        <button className="workspace-button" type="submit" disabled={receiving}>{receiving ? 'Recording delivery…' : 'Receive delivery'}</button>
      </form>
    </section>
    <section className="workspace-card"><div className="workspace-card-heading"><div><p className="workspace-eyebrow">RECENT RECEIVING</p><h2>Delivery history</h2></div></div>{!deliveries.length ? <div className="workspace-empty"><strong>No deliveries recorded</strong><p>Received deliveries will appear here with their item quantities and unit costs.</p></div> : <div className="workspace-delivery-list">{deliveries.map((delivery) => <details key={delivery.id}><summary><strong>{delivery.supplier_name}</strong><span>{dateLabel(delivery.delivery_date)} · {delivery.reference || 'No reference'}</span></summary><div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Product</th><th>Quantity</th><th>Unit cost</th><th>Line cost</th></tr></thead><tbody>{deliveryItems.filter((item) => item.delivery_id === delivery.id).map((item) => <tr key={item.id}><td>{item.product_name}<small>{item.sku}</small></td><td>{item.qty}</td><td>{money(item.unit_cost_cents)}</td><td>{money(item.unit_cost_cents * item.qty)}</td></tr>)}</tbody></table></div>{delivery.notes && <p className="workspace-note">{delivery.notes}</p>}</details>)}</div>}</section>
  </div>;
}
