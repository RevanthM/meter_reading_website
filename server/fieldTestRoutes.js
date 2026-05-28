/**
 * Field test API — Dynamo session index + S3 cycle rollups (no image manifest).
 */
import {
  createFieldTestCycle,
  deleteFieldTestCycle,
  pickActiveCycle,
  readFieldTestCycles,
  updateFieldTestCycle,
} from './fieldTestCycles.js';
import {
  buildFieldTestRollup,
  filterSessionsForCycle,
  readFieldTestRollup,
  writeFieldTestRollup,
} from './fieldTestAnalytics.js';
import { buildFieldTestCycleCsv, enrichFieldTestItemsFromMetadata } from './fieldTestCsv.js';
import { buildFieldTestCityOptions, matchesFieldTestCityFilter } from './fieldTestLocation.js';
import { deriveFieldTestFromMetadata, fieldTestCaptureToListItem } from './fieldTestDerive.js';
import { sessionItemToReading } from './sessionIndex/metadataMapping.js';
import { resolvePrimaryListImageKey } from './sessionIndex/index.js';
import { createResponseCache, parseCacheMs, setApiCacheHeaders } from './responseCache.js';

const FIELD_TEST_CACHE_FRESH_MS = parseCacheMs(process.env.FIELD_TEST_CACHE_FRESH_MS, 45_000);

function prepareSessionItem(item) {
  if (!item) return item;
  const uploadMode = String(item.upload_mode || '').trim().toLowerCase();
  if (uploadMode !== 'field' && !item.field_test_capture) return item;

  const derived = deriveFieldTestFromMetadata({
    upload_mode: item.upload_mode,
    dial_details: item.dial_details,
    final_reading: item.final_reading,
    user_correction: item.user_correction,
    ml_prediction: item.ml_prediction,
    ml_raw_prediction: item.ml_raw_prediction,
    user_incorrect_dial_numbers: item.user_incorrect_dial_numbers,
    user_corrected_positions: item.user_corrected_positions,
    image_difficulty: item.image_difficulty,
    dial_count: item.dial_count,
    is_manually_reviewed: item.is_manually_reviewed,
    is_human_reviewed: item.is_human_reviewed,
    feedback_type: item.feedback_type,
    is_correct: item.is_correct,
    had_user_correction: item.had_user_correction,
  });
  return { ...item, ...derived };
}

function isFieldSessionItem(item) {
  if (item.field_test_capture === true) return true;
  return (
    String(item.upload_mode || '').trim().toLowerCase() === 'field' &&
    String(item.source_type || 'field').toLowerCase() === 'field'
  );
}

function matchesCaptureFilters(capture, filters) {
  if (filters.difficulty && filters.difficulty !== 'all') {
    const d = String(capture.imageDifficulty || 'normal').toLowerCase();
    if (d !== filters.difficulty) return false;
  }
  if (filters.user && filters.user !== 'all') {
    if ((capture.capturedBy || '').trim() !== filters.user) return false;
  }
  if (filters.corrected === 'yes' && !capture.hadUserCorrection) return false;
  if (filters.corrected === 'no' && capture.hadUserCorrection) return false;
  if (filters.q) {
    const q = filters.q.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    const reading = String(capture.finalReading || capture.predictedReading || '').toLowerCase();
    const sid = String(capture.sessionId || '').toLowerCase();
    if (!reading.includes(q) && !(digits && reading.replace(/\D/g, '').includes(digits)) && !sid.includes(q)) {
      return false;
    }
  }
  return true;
}

function matchesReadingFilters(reading, filters) {
  const capture = {
    sessionId: reading.id,
    finalReading: reading.meterValue || reading.expectedValue,
    predictedReading: reading.mlPrediction,
    imageDifficulty: reading.imageDifficulty,
    capturedBy: reading.userName,
    hadUserCorrection: reading.hadUserCorrection,
  };
  if (!matchesCaptureFilters(capture, filters)) return false;
  return matchesFieldTestCityFilter(reading, filters.location);
}

/**
 * @param {import('express').Express} app
 * @param {{ s3Client, BUCKET_NAME: string, sessionIndex: object, getPresignedUrl: Function }} deps
 */
export function registerFieldTestRoutes(app, deps) {
  const { s3Client, BUCKET_NAME, sessionIndex, getPresignedUrl } = deps;

  const analyticsCache = createResponseCache({
    name: 'field-test-analytics',
    freshMs: FIELD_TEST_CACHE_FRESH_MS,
    staleMs: FIELD_TEST_CACHE_FRESH_MS * 4,
  });

  async function loadFieldSessionItems(workType) {
    if (!sessionIndex?.enabled) {
      throw new Error('Dynamo session index is not enabled.');
    }
    const items = await sessionIndex.queryReadingItems('field', workType);
    return items.filter(isFieldSessionItem).map(prepareSessionItem);
  }

  app.get('/api/field-test/cycles', async (req, res) => {
    try {
      const workType = String(req.query.workType || '1000').trim() || '1000';
      const doc = await readFieldTestCycles(s3Client, BUCKET_NAME, workType);
      res.json({
        workType,
        key: doc.key,
        updatedAt: doc.updatedAt,
        cycles: doc.cycles,
        activeCycle: pickActiveCycle(doc.cycles),
      });
    } catch (e) {
      console.error('GET /api/field-test/cycles:', e);
      res.status(500).json({ error: e.message || 'Failed to load field test cycles' });
    }
  });

  app.post('/api/field-test/cycles', async (req, res) => {
    try {
      const workType = String(req.body?.workType || '1000').trim() || '1000';
      const result = await createFieldTestCycle(s3Client, BUCKET_NAME, { ...req.body, workType });
      analyticsCache.invalidate();
      res.status(201).json(result);
    } catch (e) {
      console.error('POST /api/field-test/cycles:', e);
      res.status(500).json({ error: e.message || 'Failed to create cycle' });
    }
  });

  app.delete('/api/field-test/cycles/:cycleId', async (req, res) => {
    try {
      const workType = String(req.query.workType || req.body?.workType || '1000').trim() || '1000';
      const cycleId = String(req.params.cycleId || '').trim();
      const result = await deleteFieldTestCycle(s3Client, BUCKET_NAME, workType, cycleId);
      if (!result) return res.status(404).json({ error: 'Cycle not found' });
      analyticsCache.invalidate();
      res.json(result);
    } catch (e) {
      console.error('DELETE /api/field-test/cycles/:cycleId:', e);
      res.status(500).json({ error: e.message || 'Failed to delete cycle' });
    }
  });

  app.patch('/api/field-test/cycles/:cycleId', async (req, res) => {
    try {
      const workType = String(req.body?.workType || req.query.workType || '1000').trim() || '1000';
      const cycleId = String(req.params.cycleId || '').trim();
      const result = await updateFieldTestCycle(s3Client, BUCKET_NAME, workType, cycleId, req.body || {});
      if (!result) return res.status(404).json({ error: 'Cycle not found' });
      analyticsCache.invalidate();
      res.json(result);
    } catch (e) {
      console.error('PATCH /api/field-test/cycles/:cycleId:', e);
      res.status(500).json({ error: e.message || 'Failed to update cycle' });
    }
  });

  app.get('/api/field-test/cycles/:cycleId/analytics', async (req, res) => {
    try {
      const workType = String(req.query.workType || '1000').trim() || '1000';
      const cycleId = String(req.params.cycleId || '').trim();
      const force = req.query.refresh === '1' || req.query.refresh === 'true';
      const cacheKey = `${workType}:${cycleId}`;

      const { data: payload, cacheStatus } = await analyticsCache.get(
        cacheKey,
        async () => {
          const { cycles } = await readFieldTestCycles(s3Client, BUCKET_NAME, workType);
          const cycle = cycles.find((c) => c.id === cycleId);
          if (!cycle) return { error: 'not_found' };

          if (!force) {
            const cached = await readFieldTestRollup(s3Client, BUCKET_NAME, workType, cycleId);
            if (cached.rollup?.builtAt) {
              return { source: 'rollup', cycle, rollup: cached.rollup, rollupKey: cached.key };
            }
          }

          const items = filterSessionsForCycle(await loadFieldSessionItems(workType), cycle);
          const rollup = buildFieldTestRollup(cycle, items);
          const rollupKey = await writeFieldTestRollup(s3Client, BUCKET_NAME, workType, cycleId, rollup);
          return { source: 'computed', cycle, rollup, rollupKey };
        },
        { force },
      );

      if (payload?.error === 'not_found') {
        return res.status(404).json({ error: 'Cycle not found' });
      }

      setApiCacheHeaders(res, cacheStatus, FIELD_TEST_CACHE_FRESH_MS);
      res.json(payload);
    } catch (e) {
      console.error('GET /api/field-test/cycles/:cycleId/analytics:', e);
      res.status(500).json({ error: e.message || 'Failed to load field test analytics' });
    }
  });

  app.get('/api/field-test/cycles/:cycleId/export.csv', async (req, res) => {
    try {
      const workType = String(req.query.workType || '1000').trim() || '1000';
      const cycleId = String(req.params.cycleId || '').trim();
      const enrich = req.query.enrich !== '0' && req.query.enrich !== 'false';
      const { cycles } = await readFieldTestCycles(s3Client, BUCKET_NAME, workType);
      const cycle = cycles.find((c) => c.id === cycleId);
      if (!cycle) return res.status(404).json({ error: 'Cycle not found' });

      let items = filterSessionsForCycle(await loadFieldSessionItems(workType), cycle);
      if (enrich && items.length > 0) {
        items = await enrichFieldTestItemsFromMetadata(s3Client, BUCKET_NAME, items);
      }
      const rollup = buildFieldTestRollup(cycle, items);
      const csv = buildFieldTestCycleCsv(cycle, rollup, items);
      const safeName = String(cycle.name || cycleId)
        .replace(/[^\w.-]+/g, '_')
        .slice(0, 60);
      const fileName = `field_test_${safeName}_${cycle.startDate}_${cycle.endDate}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('X-Field-Test-Capture-Count', String(items.length));
      res.send(csv);
    } catch (e) {
      console.error('GET /api/field-test/cycles/:cycleId/export.csv:', e);
      res.status(500).json({ error: e.message || 'Failed to export field test CSV' });
    }
  });

  app.get('/api/field-test/captures', async (req, res) => {
    try {
      const workType = String(req.query.workType || '1000').trim() || '1000';
      const cycleId = String(req.query.cycleId || '').trim();
      const format = String(req.query.format || 'captures').trim().toLowerCase();
      const isReadingsFormat = format === 'readings';
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
      const limit = isReadingsFormat
        ? Math.min(2000, Math.max(1, parseInt(String(req.query.limit || '500'), 10) || 500))
        : Math.min(96, Math.max(12, parseInt(String(req.query.limit || '48'), 10) || 48));
      const filters = {
        q: String(req.query.q || ''),
        difficulty: String(req.query.difficulty || 'all'),
        user: String(req.query.user || 'all'),
        corrected: String(req.query.corrected || 'all'),
        location: String(req.query.location || ''),
      };

      let cycle = null;
      if (cycleId) {
        const { cycles } = await readFieldTestCycles(s3Client, BUCKET_NAME, workType);
        cycle = cycles.find((c) => c.id === cycleId) || null;
        if (!cycle) return res.status(404).json({ error: 'Cycle not found' });
      }

      const items = filterSessionsForCycle(await loadFieldSessionItems(workType), cycle);
      const readings = items.map((item) => sessionItemToReading(item, { images: [] })).filter(Boolean);
      const cities = buildFieldTestCityOptions(readings);
      let filteredReadings = readings.filter((r) => matchesReadingFilters(r, filters));
      filteredReadings.sort((a, b) =>
        String(b.dateOfReading || b.date || '').localeCompare(String(a.dateOfReading || a.date || '')),
      );

      const total = filteredReadings.length;
      const start = (page - 1) * limit;
      const pageReadings = filteredReadings.slice(start, start + limit);

      if (isReadingsFormat) {
        const users = [
          ...new Set(filteredReadings.map((r) => (r.userName || '').trim()).filter(Boolean)),
        ].sort();
        return res.json({
          workType,
          cycle,
          format: 'readings',
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
          readings: pageReadings,
          filterOptions: { users, cities },
        });
      }

      let captures = filteredReadings.map(fieldTestCaptureToListItem);
      const pageItems = captures.slice(start, start + limit);

      if (req.query.presign === '1' || req.query.presign === 'true') {
        const keyCache = new Map();
        await Promise.all(
          pageItems.map(async (cap) => {
            try {
              const reading = {
                s3SessionPrefix: cap.s3SessionPrefix,
                primaryImageKey: cap.primaryImageKey,
                status: 'correct',
              };
              const key = await resolvePrimaryListImageKey(reading, {
                s3Client,
                bucketName: BUCKET_NAME,
                keyCache,
              });
              if (key) cap.url = await getPresignedUrl(key);
            } catch {
              cap.url = undefined;
            }
          }),
        );
      }

      const users = [
        ...new Set(captures.map((c) => (c.capturedBy || '').trim()).filter(Boolean)),
      ].sort();

      res.json({
        workType,
        cycle,
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        captures: pageItems,
        filterOptions: { users, cities },
      });
    } catch (e) {
      console.error('GET /api/field-test/captures:', e);
      res.status(500).json({ error: e.message || 'Failed to list field test captures' });
    }
  });
}
