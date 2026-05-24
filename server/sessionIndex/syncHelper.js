/** Fire-and-forget Dynamo dual-write helpers for the portal API. */

export async function syncSessionIndexFromMetadata(store, metadata, ctx) {
  if (!store?.enabled) return null;
  try {
    return await store.upsertFromMetadata(metadata, ctx);
  } catch (err) {
    console.error('📇 Dynamo session upsert failed:', err.message);
    return null;
  }
}

export function scheduleSessionIndexSync(store, metadata, ctx) {
  if (!store?.enabled) return;
  setImmediate(() => {
    syncSessionIndexFromMetadata(store, metadata, ctx).catch((err) =>
      console.error('📇 Dynamo session upsert (async):', err.message),
    );
  });
}

export async function syncSessionIndexAfterMove(store, moveCtx) {
  if (!store?.enabled) return;
  try {
    await store.updateAfterMove(moveCtx);
  } catch (err) {
    console.error('📇 Dynamo session move update failed:', err.message);
  }
}
