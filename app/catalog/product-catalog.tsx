'use client';

import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';
import { signOutAction } from '@/app/auth/actions';
import {
  adjustProductStockAction,
  createCategoryAction,
  importCatalogRowsAction,
  groupProductVariantsAction,
  saveProductAction,
  type CatalogActionState,
} from './actions';

export type CatalogProduct = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  price_cents: number;
  tax_category: 'standard' | 'zero_rated' | 'exempt';
  stock_qty: number;
  reorder_at: number;
  active: boolean;
  category_id: string | null;
  variant_group_id: string | null;
  image_path: string | null;
  image_url: string | null;
  updated_at: string;
};

export type CatalogCategory = { id: string; name: string };
type ProductFilter = 'all' | 'active' | 'inactive' | 'low';

const money = (cents: number) => `R${(cents / 100).toFixed(2)}`;

export function ProductCatalog({
  managerName,
  workspaceRole,
  products,
  categories,
  loadError,
  storeName,
  storeLogoUrl,
}: {
  managerName: string;
  workspaceRole: 'Owner' | 'Manager';
  products: CatalogProduct[];
  categories: CatalogCategory[];
  loadError: string | null;
  storeName: string;
  storeLogoUrl: string | null;
}) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<ProductFilter>('all');
  const [editing, setEditing] = useState<CatalogProduct | null | 'new'>(null);
  const [adjusting, setAdjusting] = useState<CatalogProduct | null>(null);
  const [saveState, saveAction, savePending] = useActionState(saveProductAction, null);
  const [stockState, stockAction, stockPending] = useActionState(adjustProductStockAction, null);
  const [categoryState, categoryAction, categoryPending] = useActionState(createCategoryAction, null);
  const [importState, importAction, importing] = useActionState(importCatalogRowsAction, null);
  const [variantState, variantAction, groupingVariants] = useActionState(groupProductVariantsAction, null);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [importRows, setImportRows] = useState<Array<{ sku: string; barcode: string; name: string; price_cents: number; tax_category: 'standard' | 'zero_rated' | 'exempt'; reorder_at: number; active: boolean }>>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [dismissedSaveVersion, setDismissedSaveVersion] = useState<string | null>(null);
  const [dismissedStockVersion, setDismissedStockVersion] = useState<string | null>(null);
  const [dismissedCategoryVersion, setDismissedCategoryVersion] = useState<string | null>(null);

  const saveSucceeded = Boolean(saveState?.ok && saveState.version !== dismissedSaveVersion);
  const stockSucceeded = Boolean(stockState?.ok && stockState.version !== dismissedStockVersion);
  const categorySucceeded = Boolean(categoryState?.ok && categoryState.version !== dismissedCategoryVersion);

  const visibleProducts = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return products.filter((product) => {
      const searchMatch = !needle || [product.name, product.sku, product.barcode ?? '']
        .some((value) => value.toLocaleLowerCase().includes(needle));
      const categoryMatch = categoryFilter === 'all' || product.category_id === categoryFilter;
      const statusMatch = statusFilter === 'all'
        || (statusFilter === 'active' && product.active)
        || (statusFilter === 'inactive' && !product.active)
        || (statusFilter === 'low' && product.active && product.stock_qty <= product.reorder_at);
      return searchMatch && categoryMatch && statusMatch;
    });
  }, [products, search, categoryFilter, statusFilter]);

  function openEditor(product: CatalogProduct | null) {
    setDismissedSaveVersion(saveState?.version ?? null);
    setEditing(product ?? 'new');
  }

  function openStockAdjustment(product: CatalogProduct) {
    setDismissedStockVersion(stockState?.version ?? null);
    setAdjusting(product);
  }

  function openCategoryForm() {
    setDismissedCategoryVersion(categoryState?.version ?? null);
  }

  async function previewCatalogFile(file: File | undefined) {
    setImportRows([]);
    setImportError(null);
    if (!file) return;
    try {
      const text = await file.text();
      const rows = parseCatalogCsv(text);
      if (rows.length > 1000) throw new Error('Imports are limited to 1,000 products at a time.');
      setImportRows(rows);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Could not read this CSV file.');
    }
  }

  return (
    <main className="catalog-app">
      <header className="catalog-topbar">
        <a className="catalog-brand" href="/catalog" aria-label={`${storeName} product catalog`}>
          {storeLogoUrl ? <img src={storeLogoUrl} alt="" width={34} height={34} /> : <span className="catalog-brand-mark">{storeName.slice(0, 1).toUpperCase()}</span>}
          <span>{storeName}</span>
        </a>
        <div className="catalog-user-area">
          <Link className="catalog-history-link" href="/inventory">Inventory</Link>
          <Link className="catalog-history-link" href="/reports">Reports</Link>
          <Link className="catalog-history-link" href="/sales">Sales history</Link>
          <div><span>{workspaceRole} workspace</span><strong>{managerName}</strong></div>
          <form action={signOutAction}><button type="submit">Sign out</button></form>
        </div>
      </header>

      <div className="catalog-content">
        <div className="catalog-heading-row">
          <div>
            <p className="catalog-eyebrow">STORE MANAGEMENT / INVENTORY</p>
            <h1>Product catalog</h1>
            <p className="catalog-subtitle">Maintain prices, availability, categories, and stock for your store.</p>
          </div>
          <button className="catalog-button" type="button" onClick={() => openEditor(null)}>
            <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M10 4v12M4 10h12" /></svg> Add product
          </button>
        </div>

        {loadError && <p className="catalog-alert" role="alert">{loadError}</p>}

        {(saveSucceeded || stockSucceeded || categorySucceeded) && (
          <p className="catalog-success" role="status">
            {saveSucceeded ? saveState?.message : stockSucceeded ? stockState?.message : categoryState?.message}
          </p>
        )}

        <section className="catalog-metrics" aria-label="Catalog summary">
          <div><span>Products</span><strong>{products.length}</strong><small>Across {categories.length} categories</small></div>
          <div><span>Active for sale</span><strong>{products.filter((product) => product.active).length}</strong><small>Visible on the cashier screen</small></div>
          <div><span>At or below reorder level</span><strong>{products.filter((product) => product.active && product.stock_qty <= product.reorder_at).length}</strong><small>Review stock before the next sale</small></div>
        </section>

        <section className="catalog-table-card" aria-labelledby="catalog-list-title">
          <div className="catalog-list-heading">
            <div><h2 id="catalog-list-title">Store products</h2><p>{visibleProducts.length} shown</p></div>
            <form action={variantAction} className="catalog-category-manager"><input type="hidden" name="productIds" value={JSON.stringify(selectedProductIds)} /><button className="catalog-button catalog-button--secondary" type="submit" disabled={groupingVariants || selectedProductIds.length < 2}>Group selected variants ({selectedProductIds.length})</button>{variantState?.message && <p role={variantState.ok ? 'status' : 'alert'}>{variantState.message}</p>}</form>
            <details className="catalog-category-manager">
              <summary onClick={openCategoryForm}>Add category</summary>
              <form action={categoryAction}>
                <label htmlFor="new-category-name">Category name</label>
                <div><input id="new-category-name" name="name" minLength={2} maxLength={48} required placeholder="e.g. Deli" /><button type="submit" disabled={categoryPending}>{categoryPending ? 'Saving…' : 'Add'}</button></div>
                {categoryState?.message && !categoryState.ok && <p role="alert">{categoryState.message}</p>}
                {categorySucceeded && <p role="status">{categoryState?.message}</p>}
              </form>
            </details>
          </div>

          <div className="catalog-toolbar">
            <label className="catalog-search">
              <span className="catalog-sr-only">Search products by name, SKU, or barcode</span>
              <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.2 4.2" /></svg>
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products, SKU, or barcode" />
            </label>
            <label className="catalog-filter-label"><span className="catalog-sr-only">Filter by category</span>
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                <option value="all">All categories</option>
                {categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
              </select>
            </label>
            <div className="catalog-status-tabs" aria-label="Filter by product status">
              {(['all', 'active', 'inactive', 'low'] as const).map((filter) => (
                <button className={statusFilter === filter ? 'is-selected' : ''} key={filter} type="button" onClick={() => setStatusFilter(filter)}>
                  {filter === 'all' ? 'All' : filter === 'active' ? 'Active' : filter === 'inactive' ? 'Inactive' : 'Low stock'}
                </button>
              ))}
            </div>
          </div>

          {visibleProducts.length === 0 ? (
            <div className="catalog-empty">
              <span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 20V7l3-3h10l3 3v13M4 9h16M9 20v-5h6v5" /></svg></span>
              <h3>{products.length ? 'No products match these filters' : 'No products in the catalog yet'}</h3>
              <p>{products.length ? 'Try another search or clear a filter.' : 'Add the store’s products here. New products start with zero stock; use Adjust stock to receive the first inventory.'}</p>
              {products.length === 0 && <button className="catalog-button" type="button" onClick={() => openEditor(null)}>Add your first product</button>}
            </div>
          ) : (
            <div className="catalog-table-wrap">
              <table className="catalog-table">
                <thead><tr><th scope="col"><span className="catalog-sr-only">Select variant</span></th><th scope="col">Product</th><th scope="col">Category</th><th scope="col">Price</th><th scope="col">Stock</th><th scope="col">Status</th><th scope="col"><span className="catalog-sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {visibleProducts.map((product) => {
                    const category = categories.find((item) => item.id === product.category_id);
                    const lowStock = product.stock_qty <= product.reorder_at;
                    return (
                      <tr key={product.id}>
                        <td><input type="checkbox" checked={selectedProductIds.includes(product.id)} onChange={(event) => setSelectedProductIds((current) => event.target.checked ? [...current, product.id] : current.filter((id) => id !== product.id))} aria-label={`Select ${product.name} as a variant`} /></td><td><div className="catalog-product-name">{product.image_url && <img className="catalog-product-thumb" src={product.image_url} alt="" width={40} height={40} />}<span><strong>{product.name}{product.variant_group_id ? <small>Variant group</small> : null}</strong><small>{product.sku}{product.barcode ? ` · ${product.barcode}` : ''}</small></span></div></td>
                        <td>{category?.name ?? <span className="catalog-unassigned">Unassigned</span>}</td>
                        <td className="catalog-price">{money(product.price_cents)}</td>
                        <td><span className={`catalog-stock${lowStock ? ' is-low' : ''}`}>{product.stock_qty}</span>{lowStock && <span className="catalog-stock-hint"> / reorder at {product.reorder_at}</span>}</td>
                        <td><span className={`catalog-status${product.active ? ' is-active' : ' is-inactive'}`}>{product.active ? 'Active' : 'Inactive'}</span></td>
                        <td><div className="catalog-row-actions"><button type="button" onClick={() => openEditor(product)}>Edit</button><button type="button" onClick={() => openStockAdjustment(product)}>Adjust stock</button></div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="catalog-table-card" aria-labelledby="catalog-import-title">
          <div className="catalog-list-heading"><div><h2 id="catalog-import-title">Catalog CSV</h2><p>Download a copy or preview a product import. Stock levels are never changed by import.</p></div><a className="catalog-button catalog-button--secondary" href="/catalog/export">Export CSV</a></div>
          <div className="catalog-toolbar"><label className="catalog-search">Choose CSV<input type="file" accept=".csv,text/csv" onChange={(event) => void previewCatalogFile(event.target.files?.[0])} /></label><span>Required columns: sku, barcode, name, price, tax_category, reorder_at, active</span></div>
          {importError && <p className="catalog-alert" role="alert">{importError}</p>}
          {importRows.length > 0 && <form action={importAction} className="catalog-import-preview"><input type="hidden" name="rows" value={JSON.stringify(importRows)} /><p><strong>{importRows.length} rows ready to import.</strong> Matching SKUs will be updated.</p><div className="catalog-table-wrap"><table className="catalog-table"><thead><tr><th>SKU</th><th>Name</th><th>Barcode</th><th>Price</th></tr></thead><tbody>{importRows.slice(0, 8).map((row) => <tr key={row.sku}><td>{row.sku}</td><td>{row.name}</td><td>{row.barcode || '—'}</td><td>{money(row.price_cents)}</td></tr>)}</tbody></table></div><button className="catalog-button" type="submit" disabled={importing}>{importing ? 'Importing…' : `Import ${importRows.length} products`}</button></form>}
          {importState?.message && <p className={importState.ok ? 'catalog-success' : 'catalog-alert'} role={importState.ok ? 'status' : 'alert'}>{importState.message}</p>}
        </section>
        <p className="catalog-footnote">Stock changes are recorded as inventory movements. Product names and prices on past sales remain as sale-time snapshots.</p>
      </div>

      {editing && !saveSucceeded && (
        <ProductEditor
          key={editing === 'new' ? 'new-product' : editing.id}
          product={editing === 'new' ? null : editing}
          categories={categories}
          action={saveAction}
          pending={savePending}
          state={saveState}
          onClose={() => setEditing(null)}
        />
      )}

      {adjusting && !stockSucceeded && (
        <StockAdjuster
          key={adjusting.id}
          product={adjusting}
          action={stockAction}
          pending={stockPending}
          state={stockState}
          onClose={() => setAdjusting(null)}
        />
      )}
    </main>
  );
}

function parseCatalogCsv(text: string) {
  const matrix: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted && character === '"' && text[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { row.push(value); value = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(value); value = '';
      if (row.some((cell) => cell.trim())) matrix.push(row);
      row = [];
    } else value += character;
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  row.push(value);
  if (row.some((cell) => cell.trim())) matrix.push(row);
  if (matrix.length < 2) throw new Error('CSV needs a header and at least one product row.');
  const headers = matrix[0].map((header) => header.trim().toLowerCase());
  const required = ['sku', 'barcode', 'name', 'price', 'tax_category', 'reorder_at', 'active'];
  if (required.some((header) => !headers.includes(header))) throw new Error(`Include these columns: ${required.join(', ')}.`);
  return matrix.slice(1).map((cells, index) => {
    const record = Object.fromEntries(headers.map((header, cellIndex) => [header, (cells[cellIndex] ?? '').trim()]));
    const price = /^\d{1,9}(?:\.\d{1,2})?$/.test(record.price) ? Number(record.price) : NaN;
    const reorder = /^\d+$/.test(record.reorder_at) ? Number(record.reorder_at) : NaN;
    const category = record.tax_category as 'standard' | 'zero_rated' | 'exempt';
    if (!record.sku || !record.name || !Number.isSafeInteger(Math.round(price * 100)) || !Number.isSafeInteger(reorder) || !['standard', 'zero_rated', 'exempt'].includes(category) || !['true', 'false'].includes(record.active.toLowerCase())) throw new Error(`Row ${index + 2} has invalid or missing values.`);
    return { sku: record.sku, barcode: record.barcode, name: record.name, price_cents: Math.round(price * 100), tax_category: category, reorder_at: reorder, active: record.active.toLowerCase() === 'true' };
  });
}

function ProductEditor({
  product,
  categories,
  action,
  pending,
  state,
  onClose,
}: {
  product: CatalogProduct | null;
  categories: CatalogCategory[];
  action: (formData: FormData) => void;
  pending: boolean;
  state: CatalogActionState;
  onClose: () => void;
}) {
  return (
    <div className="catalog-modal-backdrop">
      <section className="catalog-modal" role="dialog" aria-modal="true" aria-labelledby="product-editor-title">
        <header><div><p className="catalog-eyebrow">PRODUCT DETAILS</p><h2 id="product-editor-title">{product ? 'Edit product' : 'Add product'}</h2></div><button className="catalog-modal-close" type="button" aria-label="Close" onClick={onClose}><svg aria-hidden="true" viewBox="0 0 20 20"><path d="m5 5 10 10M15 5 5 15" /></svg></button></header>
        <form action={action} className="catalog-editor-form" encType="multipart/form-data">
          <input type="hidden" name="id" value={product?.id ?? ''} />
          <div className="catalog-form-grid">
            <label>Product name<input name="name" required minLength={2} maxLength={120} defaultValue={product?.name ?? ''} placeholder="e.g. Full cream milk 2 L" /></label>
            <label>SKU<input name="sku" required minLength={2} maxLength={64} defaultValue={product?.sku ?? ''} placeholder="e.g. DAIRY-MILK-2L" /></label>
            <label>Barcode <span>(optional)</span><input name="barcode" maxLength={64} defaultValue={product?.barcode ?? ''} placeholder="Scan or enter barcode" /></label>
            <label>Price <span>(ZAR)</span><div className="catalog-money-input"><b aria-hidden="true">R</b><input name="price" type="number" min="0" step="0.01" required defaultValue={product ? (product.price_cents / 100).toFixed(2) : ''} placeholder="0.00" /></div></label>
            <label>VAT category<select name="taxCategory" defaultValue={product?.tax_category ?? 'standard'}><option value="standard">Standard-rated</option><option value="zero_rated">Zero-rated</option><option value="exempt">Exempt</option></select><small>Use zero-rated or exempt only when the product qualifies.</small></label>
            <label>Reorder alert at<input name="reorderAt" type="number" min="0" step="1" required defaultValue={product?.reorder_at ?? 5} /><small>Show a warning when stock reaches this quantity.</small></label>
            <label>Category<select name="categoryId" defaultValue={product?.category_id ?? ''}><option value="">Unassigned</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
            <label>Availability<select name="active" defaultValue={product?.active === false ? 'false' : 'true'}><option value="true">Active — available for sale</option><option value="false">Inactive — hidden from POS</option></select></label>
            <label>Product image <span>(optional, PNG/JPEG/WebP, 2 MB max)</span><input name="image" type="file" accept="image/png,image/jpeg,image/webp" /></label>
          </div>
          {product?.image_url && <div className="catalog-image-edit"><img src={product.image_url} alt={`${product.name} current image`} width={72} height={72} /><label><input type="checkbox" name="removeImage" value="true" /> Remove current image</label></div>}
          {!product && <p className="catalog-form-note">The product will start at zero stock. After saving, choose Adjust stock to enter the opening quantity with a reason.</p>}
          {state?.message && !state.ok && <p className="catalog-form-error" role="alert">{state.message}</p>}
          <footer><button className="catalog-button catalog-button--quiet" type="button" onClick={onClose}>Cancel</button><button className="catalog-button" type="submit" disabled={pending}>{pending ? 'Saving…' : product ? 'Save changes' : 'Add product'}</button></footer>
        </form>
      </section>
    </div>
  );
}

function StockAdjuster({
  product,
  action,
  pending,
  state,
  onClose,
}: {
  product: CatalogProduct;
  action: (formData: FormData) => void;
  pending: boolean;
  state: CatalogActionState;
  onClose: () => void;
}) {
  return (
    <div className="catalog-modal-backdrop">
      <section className="catalog-modal catalog-stock-modal" role="dialog" aria-modal="true" aria-labelledby="stock-editor-title">
        <header><div><p className="catalog-eyebrow">INVENTORY MOVEMENT</p><h2 id="stock-editor-title">Adjust stock</h2></div><button className="catalog-modal-close" type="button" aria-label="Close" onClick={onClose}><svg aria-hidden="true" viewBox="0 0 20 20"><path d="m5 5 10 10M15 5 5 15" /></svg></button></header>
        <div className="catalog-stock-summary"><strong>{product.name}</strong><span>Current stock <b>{product.stock_qty}</b></span></div>
        <form action={action} className="catalog-editor-form">
          <input type="hidden" name="productId" value={product.id} />
          <label>Quantity change<input name="delta" type="number" step="1" required placeholder="e.g. 24 or -2" /><small>Positive to receive stock; negative to record a write-off or correction.</small></label>
          <label>Reason<input name="reason" minLength={3} maxLength={250} required placeholder="e.g. Supplier delivery or damaged goods" /></label>
          {state?.message && !state.ok && <p className="catalog-form-error" role="alert">{state.message}</p>}
          <footer><button className="catalog-button catalog-button--quiet" type="button" onClick={onClose}>Cancel</button><button className="catalog-button" type="submit" disabled={pending}>{pending ? 'Updating…' : 'Save adjustment'}</button></footer>
        </form>
      </section>
    </div>
  );
}
