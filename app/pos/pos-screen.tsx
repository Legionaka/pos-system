'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { signOutAction } from '@/app/auth/actions';
import { closeShiftAction, completeSaleAction, openShiftAction } from './actions';

export type PosProduct = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  price_cents: number;
  tax_category: 'standard' | 'zero_rated' | 'exempt';
  stock_qty: number;
  category_id: string | null;
  active: boolean;
};

export type PosCategory = { id: string; name: string };
export type PosShift = { id: string; opened_at: string; opening_cash_cents: number };
type CartLine = { productId: string; qty: number };
type PaymentMethod = 'cash' | 'card' | 'eft' | 'qr';

const money = (cents: number) => `R${(cents / 100).toFixed(2)}`;
const toCents = (value: string) => {
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ''] = value.trim().split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
};

export function PosScreen({
  cashierName,
  products,
  categories,
  shift,
  loadError,
}: {
  cashierName: string;
  products: PosProduct[];
  categories: PosCategory[];
  shift: PosShift | null;
  loadError: string | null;
}) {
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [dismissedSaleId, setDismissedSaleId] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [cashReceived, setCashReceived] = useState('');
  const [reference, setReference] = useState('');
  const [saleState, completeAction, salePending] = useActionState(completeSaleAction, null);
  const [shiftState, openAction, shiftPending] = useActionState(openShiftAction, null);
  const [closeShiftState, closeAction, closePending] = useActionState(closeShiftAction, null);
  const [showCloseShift, setShowCloseShift] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (
        target.isContentEditable
        || target.closest('input, textarea, select, [contenteditable="true"]')
      )) return;

      event.preventDefault();
      searchInputRef.current?.focus();
    }

    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  const showReceipt = Boolean(saleState?.saleId && saleState.saleId !== dismissedSaleId);
  const activeCart = showReceipt ? [] : cart;

  const filteredProducts = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return products.filter((product) => {
      const matchesSearch = !needle || [product.name, product.sku, product.barcode ?? '']
        .some((value) => value.toLocaleLowerCase().includes(needle));
      return matchesSearch && (categoryId === 'all' || product.category_id === categoryId);
    });
  }, [products, search, categoryId]);

  const cartProducts = activeCart.flatMap((line) => {
    const product = products.find((item) => item.id === line.productId);
    return product ? [{ product, qty: line.qty }] : [];
  });
  const subtotalCents = cartProducts.reduce((sum, line) => sum + line.product.price_cents * line.qty, 0);
  const vatCents = cartProducts.reduce((sum, line) => sum + (
    line.product.tax_category === 'standard'
      ? Math.round(line.product.price_cents * line.qty * 15 / 115)
      : 0
  ), 0);
  const roundingCents = method === 'cash' ? Math.round(subtotalCents / 5) * 5 - subtotalCents : 0;
  const totalCents = subtotalCents + roundingCents;
  const receivedCents = toCents(cashReceived);
  const changeCents = method === 'cash' && receivedCents !== null
    ? Math.max(0, receivedCents - totalCents)
    : null;

  function addProduct(product: PosProduct) {
    if (!shift || product.stock_qty < 1) return;
    if (showReceipt && saleState?.saleId) {
      setDismissedSaleId(saleState.saleId);
      setCart([{ productId: product.id, qty: 1 }]);
      setCashReceived('');
      setReference('');
      return;
    }
    setCart((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (!existing) return [...current, { productId: product.id, qty: 1 }];
      if (existing.qty >= product.stock_qty) return current;
      return current.map((line) => line.productId === product.id ? { ...line, qty: line.qty + 1 } : line);
    });
  }

  function setQuantity(productId: string, qty: number) {
    const product = products.find((item) => item.id === productId);
    if (!product) return;
    if (qty <= 0) {
      setCart((current) => current.filter((line) => line.productId !== productId));
      return;
    }
    setCart((current) => current.map((line) => line.productId === productId
      ? { ...line, qty: Math.min(qty, product.stock_qty) }
      : line));
  }

  return (
    <main className="pos-app">
      <header className="pos-topbar">
        <a className="pos-brand" href="/pos" aria-label="TrueMarket point of sale">
          <Image src="/logo/truemarket-symbol-light.svg" alt="" width={36} height={36} priority />
          <span>true<span>market</span></span>
        </a>
        <div className="pos-user-area">
          <div className="pos-user-copy"><span>Signed in as</span><strong>{cashierName}</strong></div>
          <form action={signOutAction}><button className="pos-signout" type="submit">Sign out</button></form>
        </div>
      </header>

      <div className="pos-workspace">
        <section className="pos-catalog" aria-labelledby="pos-title">
          <div className="pos-heading-row">
            <div>
              <p className="pos-eyebrow">STAFF WORKSPACE / SALES</p>
              <h1 id="pos-title">Point of sale</h1>
              <p className="pos-subtitle">Search the store catalog and add items to the sale.</p>
            </div>
            <div className="pos-shift-tools">
              <div className={`pos-shift-status${shift ? ' is-open' : ''}`}>
                <span className="pos-status-dot" />
                {shift ? 'Shift open' : 'No open shift'}
              </div>
              {shift && <button className="pos-close-shift-link" type="button" onClick={() => setShowCloseShift((current) => !current)}>{showCloseShift ? 'Cancel close' : 'Close shift'}</button>}
            </div>
          </div>

          {loadError && <p className="pos-alert" role="alert">{loadError}</p>}

          {!shift && (
            <section className="pos-open-shift" aria-labelledby="open-shift-title">
              <div>
                <p className="pos-eyebrow">BEFORE THE FIRST SALE</p>
                <h2 id="open-shift-title">Open your shift</h2>
                <p>Enter the opening cash float. You can open one shift at a time.</p>
              </div>
              <form action={openAction} className="pos-open-shift-form">
                <label htmlFor="opening-cash">Opening cash <span>(ZAR)</span></label>
                <div className="pos-inline-field">
                  <span aria-hidden="true">R</span>
                  <input id="opening-cash" name="openingCash" type="number" min="0" step="0.01" defaultValue="0.00" required disabled={shiftPending || products.length === 0} />
                  <button className="pos-button" type="submit" disabled={shiftPending || products.length === 0}>
                    {shiftPending ? 'Opening…' : 'Open shift'}
                  </button>
                </div>
                {products.length === 0 && <p className="pos-shift-unavailable">Add and activate products before opening a shift.</p>}
                {shiftState?.message && <p className="pos-field-error" role="alert">{shiftState.message}</p>}
              </form>
            </section>
          )}

          {shift && showCloseShift && (
            <section className="pos-close-shift" aria-labelledby="close-shift-title">
              <div>
                <p className="pos-eyebrow">END OF SHIFT</p>
                <h2 id="close-shift-title">Count the till</h2>
                <p>Enter the actual cash in the till. The system will compare it with expected cash.</p>
              </div>
              <form action={closeAction} className="pos-open-shift-form">
                <input type="hidden" name="shiftId" value={shift.id} />
                <label htmlFor="counted-cash">Cash counted <span>(ZAR)</span></label>
                <div className="pos-inline-field">
                  <span aria-hidden="true">R</span>
                  <input id="counted-cash" name="countedCash" type="number" min="0" step="0.01" required disabled={closePending} />
                  <button className="pos-button" type="submit" disabled={closePending}>
                    {closePending ? 'Closing…' : 'Close shift'}
                  </button>
                </div>
                {closeShiftState?.message && <p className="pos-field-error" role="alert">{closeShiftState.message}</p>}
              </form>
            </section>
          )}

          <div className="pos-catalog-tools">
            <label className="pos-search">
              <span className="pos-sr-only">Search products by name, SKU or barcode</span>
              <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.2 4.2" /></svg>
              <input
                ref={searchInputRef}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name, SKU or barcode"
              />
              <kbd>/</kbd>
            </label>
            <div className="pos-categories" aria-label="Product categories">
              <button className={categoryId === 'all' ? 'is-selected' : ''} type="button" onClick={() => setCategoryId('all')}>All items</button>
              {categories.map((category) => (
                <button
                  className={categoryId === category.id ? 'is-selected' : ''}
                  key={category.id}
                  type="button"
                  onClick={() => setCategoryId(category.id)}
                >
                  {category.name}
                </button>
              ))}
            </div>
          </div>

          {products.length === 0 ? (
            <div className="pos-empty-catalog">
              <span className="pos-empty-icon" aria-hidden="true">
                <svg viewBox="0 0 48 48"><path d="M7 18h34l-3-10H10L7 18Z" /><path d="M9 18v22h30V18M18 40V27h12v13M7 18c0 4 5 5 8 2 3 3 8 2 9-2 1 4 6 5 9 2 3 3 8 2 8-2" /></svg>
              </span>
              <h2>No active products yet</h2>
              <p>The catalog is empty. Ask a manager or owner to add and activate products in Supabase, then refresh this page.</p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="pos-no-results"><h2>No matching products</h2><p>Try another name, SKU, barcode, or category.</p></div>
          ) : (
            <div className="pos-product-grid">
              {filteredProducts.map((product) => (
                <button
                  className="pos-product"
                  key={product.id}
                  type="button"
                  onClick={() => addProduct(product)}
                  disabled={!shift || product.stock_qty < 1}
                  aria-label={`${product.name}, ${money(product.price_cents)}, ${product.stock_qty} in stock`}
                >
                  <span className="pos-product-topline"><span>{product.sku}</span><span className={product.stock_qty > 0 ? 'pos-stock' : 'pos-stock is-empty'}>{product.stock_qty > 0 ? `${product.stock_qty} in stock` : 'Out of stock'}</span></span>
                  <strong>{product.name}</strong>
                  <span className="pos-product-price">{money(product.price_cents)}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <aside className="pos-cart" aria-labelledby="cart-title">
          <div className="pos-cart-heading">
            <div><p className="pos-eyebrow">CURRENT TRANSACTION</p><h2 id="cart-title">Sale items</h2></div>
          <span className="pos-cart-count">{activeCart.reduce((sum, line) => sum + line.qty, 0)}</span>
          </div>

          {activeCart.length === 0 ? (
            <div className="pos-cart-empty"><span aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M10 4v12M4 10h12" /></svg></span><p>Your sale is empty</p><small>Add products from the catalog.</small></div>
          ) : (
            <ul className="pos-cart-lines">
              {cartProducts.map(({ product, qty }) => (
                <li key={product.id}>
                  <div className="pos-cart-line-copy"><strong>{product.name}</strong><span>{money(product.price_cents)} each</span></div>
                  <div className="pos-quantity" aria-label={`Quantity for ${product.name}`}>
                    <button type="button" aria-label={`Remove one ${product.name}`} onClick={() => setQuantity(product.id, qty - 1)}><svg aria-hidden="true" viewBox="0 0 20 20"><path d="M4 10h12" /></svg></button>
                    <span>{qty}</span>
                    <button type="button" aria-label={`Add one ${product.name}`} disabled={qty >= product.stock_qty} onClick={() => setQuantity(product.id, qty + 1)}><svg aria-hidden="true" viewBox="0 0 20 20"><path d="M10 4v12M4 10h12" /></svg></button>
                  </div>
                  <strong className="pos-line-total">{money(product.price_cents * qty)}</strong>
                </li>
              ))}
            </ul>
          )}

          <form action={completeAction} className="pos-checkout-form">
            <input type="hidden" name="items" value={JSON.stringify(activeCart.map((line) => ({ product_id: line.productId, qty: line.qty })))} />
            <input type="hidden" name="method" value={method} />
            {method === 'cash' && <input type="hidden" name="reference" value="" />}
            {method !== 'cash' && <input type="hidden" name="cashReceived" value="" />}
            <div className="pos-total-row"><span>Subtotal</span><strong>{money(subtotalCents)}</strong></div>
            <div className="pos-total-row pos-rounding-row"><span>VAT included</span><span>{money(vatCents)}</span></div>
            {method === 'cash' && <div className="pos-total-row pos-rounding-row"><span>Cash rounding</span><span>{roundingCents < 0 ? '−' : '+'}{money(Math.abs(roundingCents))}</span></div>}
            <div className="pos-total-row pos-grand-total"><span>Total due</span><strong>{money(totalCents)}</strong></div>

            <fieldset className="pos-payment-methods" disabled={!shift || salePending}>
              <legend>Payment method</legend>
              <div>
                {(['cash', 'card', 'eft', 'qr'] as const).map((value) => (
                  <button className={method === value ? 'is-selected' : ''} key={value} type="button" onClick={() => setMethod(value)}>
                    {value === 'eft' ? 'EFT' : value === 'qr' ? 'QR' : value[0].toUpperCase() + value.slice(1)}
                  </button>
                ))}
              </div>
            </fieldset>

            {method === 'cash' ? (
              <div className="pos-payment-field">
                <label htmlFor="cash-received">Cash received <span>(ZAR)</span></label>
                <div className="pos-inline-field"><span aria-hidden="true">R</span><input id="cash-received" name="cashReceived" type="number" min="0" step="0.01" value={cashReceived} onChange={(event) => setCashReceived(event.target.value)} disabled={!shift || salePending} /></div>
                {changeCents !== null && <p className="pos-change">Change due <strong>{money(changeCents)}</strong></p>}
              </div>
            ) : (
              <div className="pos-payment-field">
                <label htmlFor="payment-reference">Reference <span>(optional)</span></label>
                <input id="payment-reference" name="reference" type="text" maxLength={120} value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Terminal or transfer reference" disabled={!shift || salePending} />
              </div>
            )}

            {saleState?.message && <p className="pos-field-error" role="alert">{saleState.message}</p>}
            <button className="pos-button pos-complete-sale" type="submit" disabled={!shift || activeCart.length === 0 || salePending || (method === 'cash' && totalCents > 0 && (receivedCents === null || receivedCents < totalCents))}>
              {salePending ? 'Completing sale…' : 'Complete sale'}
            </button>
          </form>
        </aside>
      </div>

      {showReceipt && saleState?.saleId && (
        <div className="pos-sale-success" role="status">
          <span className="pos-success-check" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="m4 10 4 4 8-8" /></svg></span>
          <div><strong>Sale complete</strong><span>{saleState.saleNumber ? `Receipt #${saleState.saleNumber}` : 'Inventory and payment have been recorded.'}</span></div>
          <button type="button" onClick={() => window.print()}>Print receipt</button>
          {saleState.receipt && (
            <section className="pos-receipt-paper" aria-label="Receipt preview">
              <header><strong>TrueMarket</strong><span>Receipt #{saleState.receipt.number}</span><time>{saleState.receipt.createdAt}</time></header>
              <ul>
                {saleState.receipt.items.map((item, index) => (
                  <li key={`${item.sku}-${index}`}>
                    <span>{item.name}<small>{item.qty} × {money(item.unitPriceCents)}</small></span>
                    <strong>{money(item.lineTotalCents)}</strong>
                  </li>
                ))}
              </ul>
              <div className="pos-receipt-total"><span>Subtotal</span><strong>{money(saleState.receipt.subtotalCents)}</strong></div>
              <div className="pos-receipt-total"><span>VAT included</span><strong>{money(saleState.receipt.vatCents)}</strong></div>
              {saleState.receipt.roundingCents !== 0 && <div className="pos-receipt-total"><span>Cash rounding</span><strong>{saleState.receipt.roundingCents < 0 ? '−' : '+'}{money(Math.abs(saleState.receipt.roundingCents))}</strong></div>}
              <div className="pos-receipt-total pos-receipt-grand"><span>Total</span><strong>{money(saleState.receipt.totalCents)}</strong></div>
              <p>Thank you.</p>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
