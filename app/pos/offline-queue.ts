export type OfflineQueueItem = {
  key: string;
  shiftId: string;
  items: Array<{ product_id: string; qty: number; unit_price_cents: number; discount_cents: number }>;
  cashReceivedCents: number;
  status: 'queued' | 'synced' | 'rejected';
  message?: string;
  createdAt: string;
};

const databaseName = 'truemarket-register';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('sales')) database.createObjectStore('sales', { keyPath: 'key' });
      if (!database.objectStoreNames.contains('catalog')) database.createObjectStore('catalog', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveCatalogSnapshot(products: Array<{ id: string; sku: string; barcode: string | null; name: string; price_cents: number; stock_qty: number }>) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('catalog', 'readwrite');
    const store = transaction.objectStore('catalog');
    store.clear();
    for (const product of products) store.put(product);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

export async function getQueuedSales(): Promise<OfflineQueueItem[]> {
  const db = await openDatabase();
  const result = await new Promise<OfflineQueueItem[]>((resolve, reject) => {
    const request = db.transaction('sales', 'readonly').objectStore('sales').getAll();
    request.onsuccess = () => resolve(request.result as OfflineQueueItem[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function putQueuedSale(sale: OfflineQueueItem) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction('sales', 'readwrite').objectStore('sales').put(sale);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  db.close();
}
