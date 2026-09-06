/**
 * The payload delivered when the dev server reports that assets changed on
 * disk.
 */
export interface AssetReloadEvent {
  urls: string[];
}

/**
 * The single canonical internal asset event.
 *
 * @remarks
 * There is deliberately exactly one channel name. Aliasing the same event
 * under two names would deliver it twice to anything that subscribed to both,
 * producing duplicate reloads.
 */
export const ASSET_RELOAD_EVENT = 'ovacanvas:assets';

const Subscribers = new Set<(event: AssetReloadEvent) => void>();

// Exactly one module-lifetime listener, no matter how many runtimes exist.
// Registering `import.meta.hot.on` per instance is unsafe: the Vite client
// keeps the handler for the lifetime of the module, so every disposed runtime
// would leave a live listener holding its whole object graph.
if (import.meta.hot) {
  import.meta.hot.on(ASSET_RELOAD_EVENT, event => {
    for (const subscriber of [...Subscribers]) {
      subscriber(event);
    }
  });
}

/**
 * Subscribe to asset reloads behind the single module-lifetime listener.
 *
 * @param subscriber - Called whenever the dev server reports changed assets.
 *
 * @returns An unsubscribe function. Runtimes must call it during disposal so
 *          that teardown is symmetrical.
 */
export function onAssetReload(
  subscriber: (event: AssetReloadEvent) => void,
): () => void {
  Subscribers.add(subscriber);
  return () => {
    Subscribers.delete(subscriber);
  };
}

/**
 * The number of live asset-reload subscribers.
 *
 * @remarks
 * Lets teardown be asserted to be symmetrical: after every runtime on the
 * page is disposed this must be back to its starting value.
 *
 * @internal
 */
export function getAssetReloadSubscriberCount(): number {
  return Subscribers.size;
}
