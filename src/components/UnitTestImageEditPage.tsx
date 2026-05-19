import { useCallback, useEffect, useMemo, useState, type FC } from 'react';
import { useNavigate, useOutletContext, useParams, useLocation } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Gauge, ImageIcon, Loader2, Save } from 'lucide-react';
import {
  fetchUnitTestImageByFileName,
  updateUnitTestImageExpected,
  type ImageDifficulty,
  type UnitTestImageRow,
} from '../services/api';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';
import { useReadings } from '../context/ReadingsContext';
import {
  dialDigitsFromExpected,
  expectedFromDialDigits,
  meterDialCountFromExpected,
  normalizeDialDigit,
  normalizeUnitTestDifficulty,
  parseUnitTestImageFileName,
} from '../utils/unitTestImageNaming';

const DIFFICULTY_OPTIONS: { value: ImageDifficulty; label: string }[] = [
  { value: 'normal', label: 'Normal (d1)' },
  { value: 'difficult', label: 'Difficult (d2)' },
  { value: 'very_difficult', label: 'Very difficult (d3)' },
];

export type UnitTestImageEditLocationState = {
  imageQueueS3Keys?: string[];
  listReturn?: { pathname: string; search?: string };
};

const UnitTestImageEditPage: FC = () => {
  const { fileName: fileNameParam } = useParams<{ fileName: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const outletCtx = useOutletContext<PortalOutletWorkContext | undefined>();
  const { workType } = useReadings();

  const fileName = decodeURIComponent(fileNameParam || '');
  const locationState = location.state as UnitTestImageEditLocationState | null;
  const imageQueueS3Keys = locationState?.imageQueueS3Keys;
  const listReturn = locationState?.listReturn;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [image, setImage] = useState<UnitTestImageRow | null>(null);
  const [dialDigits, setDialDigits] = useState<number[]>([]);
  const [expectedReading, setExpectedReading] = useState('');
  const [imageDifficulty, setImageDifficulty] = useState<ImageDifficulty>('normal');
  const [readingDetachedFromDials, setReadingDetachedFromDials] = useState(false);
  const [saving, setSaving] = useState(false);

  const parsed = useMemo(
    () => parseUnitTestImageFileName(image?.fileName ?? fileName),
    [image?.fileName, fileName],
  );
  const meterDialCount = meterDialCountFromExpected(expectedReading);

  const goBack = useCallback(() => {
    if (listReturn?.pathname) {
      navigate({ pathname: listReturn.pathname, search: listReturn.search ?? '' });
    } else {
      navigate('/test-data/images');
    }
  }, [listReturn, navigate]);

  useEffect(() => {
    if (outletCtx?.workMode !== 'test_data_reviewer') {
      navigate('/', { replace: true });
    }
  }, [navigate, outletCtx?.workMode]);

  useEffect(() => {
    if (!fileName) {
      setErr('Missing image file name.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    void fetchUnitTestImageByFileName(workType, fileName)
      .then((row) => {
        if (cancelled) return;
        setImage(row);
        const p = parseUnitTestImageFileName(row.fileName);
        const expected = (row.expectedMeterValue ?? p?.expected ?? '').trim();
        setExpectedReading(expected);
        setImageDifficulty(normalizeUnitTestDifficulty(row.imageDifficulty ?? p?.difficulty));
        setDialDigits(dialDigitsFromExpected(expected));
        setReadingDetachedFromDials(false);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fileName, workType]);

  useEffect(() => {
    if (readingDetachedFromDials || dialDigits.length === 0) return;
    setExpectedReading(expectedFromDialDigits(dialDigits));
  }, [dialDigits, readingDetachedFromDials]);

  const queueIndex = useMemo(() => {
    if (!image?.s3Key || !imageQueueS3Keys?.length) return -1;
    return imageQueueS3Keys.indexOf(image.s3Key);
  }, [image?.s3Key, imageQueueS3Keys]);

  const navigateQueue = (delta: -1 | 1) => {
    if (!imageQueueS3Keys?.length || queueIndex < 0) return;
    const nextIdx = queueIndex + delta;
    if (nextIdx < 0 || nextIdx >= imageQueueS3Keys.length) return;
    const nextKey = imageQueueS3Keys[nextIdx];
    const nextName = nextKey.split('/').pop();
    if (!nextName) return;
    navigate(`/test-data/images/edit/${encodeURIComponent(nextName)}`, {
      replace: true,
      state: location.state,
    });
  };

  const isDirty =
    image != null &&
    (expectedReading.trim() !== (image.expectedMeterValue ?? '').trim() ||
      normalizeUnitTestDifficulty(imageDifficulty) !==
        normalizeUnitTestDifficulty(image.imageDifficulty));

  const handleDialChange = (index: number, digit: number) => {
    setReadingDetachedFromDials(false);
    setDialDigits((prev) => {
      const next = [...prev];
      const count = meterDialCountFromExpected(expectedReading);
      while (next.length < count) next.push(0);
      next[index] = normalizeDialDigit(digit);
      return next.slice(0, count);
    });
  };

  const handleSave = async () => {
    if (!image) return;
    const next = expectedReading.trim();
    if (!next) {
      window.alert('Enter the correct meter reading.');
      return;
    }
    setSaving(true);
    try {
      const res = await updateUnitTestImageExpected(
        workType,
        image.s3Key,
        next,
        normalizeUnitTestDifficulty(imageDifficulty),
      );
      if (res.fileName !== fileName) {
        navigate(`/test-data/images/edit/${encodeURIComponent(res.fileName)}`, {
          replace: true,
          state: {
            imageQueueS3Keys: imageQueueS3Keys?.map((k) => (k === image.s3Key ? res.s3Key : k)),
            listReturn,
          },
        });
      }
      setImage({
        ...image,
        s3Key: res.s3Key,
        fileName: res.fileName,
        expectedMeterValue: res.expectedMeterValue,
        imageDifficulty: res.imageDifficulty,
        url: res.url ?? image.url,
      });
      setDialDigits(dialDigitsFromExpected(res.expectedMeterValue));
      setExpectedReading(res.expectedMeterValue);
      setImageDifficulty(normalizeUnitTestDifficulty(res.imageDifficulty));
      setReadingDetachedFromDials(false);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="detail-page">
        <header className="page-header">
          <div className="header-content">
            <button type="button" className="back-button" onClick={goBack}>
              <ArrowLeft size={20} />
              <span>Back</span>
            </button>
            <div className="page-title">
              <Gauge size={32} strokeWidth={1.5} />
              <div>
                <h1>Unit test image</h1>
                <p>Loading…</p>
              </div>
            </div>
          </div>
        </header>
        <main className="detail-content">
          <p className="training-pipeline-bar-hint">
            <Loader2 size={18} className="spin" /> Loading…
          </p>
        </main>
      </div>
    );
  }

  if (err || !image) {
    return (
      <div className="detail-page">
        <div className="error-state">
          <p>{err || 'Image not found'}</p>
          <button type="button" onClick={goBack}>
            Go back
          </button>
        </div>
      </div>
    );
  }

  const canQueuePrev = queueIndex > 0;
  const canQueueNext = Boolean(
    imageQueueS3Keys?.length && queueIndex >= 0 && queueIndex < imageQueueS3Keys.length - 1,
  );

  return (
    <div className="detail-page">
      <header className="page-header">
        <div className="header-content reading-detail-header">
          <div className="reading-detail-header-lead">
            <button type="button" className="back-button" onClick={goBack}>
              <ArrowLeft size={20} />
              <span>Back to gallery</span>
            </button>
            <div className="page-title">
              <ImageIcon size={32} strokeWidth={1.5} />
              <div>
                <h1>Edit unit test image</h1>
                <p>
                  <code>{image.fileName}</code>
                </p>
              </div>
            </div>
          </div>
          {imageQueueS3Keys && imageQueueS3Keys.length > 0 && queueIndex >= 0 ? (
            <div className="reading-detail-header-actions">
              <div className="reading-detail-header-queue" role="group" aria-label="Position in gallery">
                <button
                  type="button"
                  className="reading-detail-header-nav-btn"
                  onClick={() => navigateQueue(-1)}
                  disabled={!canQueuePrev || saving}
                >
                  <ChevronLeft size={18} aria-hidden />
                  Previous
                </button>
                <span className="reading-detail-header-queue-count" aria-live="polite">
                  {queueIndex + 1} / {imageQueueS3Keys.length}
                </span>
                <button
                  type="button"
                  className="reading-detail-header-nav-btn"
                  onClick={() => navigateQueue(1)}
                  disabled={!canQueueNext || saving}
                >
                  Next
                  <ChevronRight size={18} aria-hidden />
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </header>

      <main className="detail-content">
        <div className="reading-detail-layout">
          <div className="reading-detail-primary">
            <section className="images-section unit-test-edit-images">
              <div className="images-section-head">
                <h2>
                  <ImageIcon size={20} aria-hidden />
                  Meter image
                </h2>
              </div>
              <div className="unit-test-edit-hero">
                {image.url ? (
                  <img src={image.url} alt={image.fileName} className="unit-test-edit-hero-img" />
                ) : (
                  <div className="unit-test-edit-hero-empty">No preview</div>
                )}
              </div>
            </section>
          </div>

          <aside className="reading-detail-sidebar" aria-label="Correct expected reading">
            <section className="status-section">
              <h2>
                <Gauge size={20} aria-hidden /> Expected reading
              </h2>
              <p className="reading-detail-field-hint">
                Set difficulty, dials, and reading. Save updates the manifest and renames the file (e.g.{' '}
                <code>11_d2_4382.jpeg</code>).
              </p>

              <fieldset className="reading-detail-radio-group">
                <legend>Difficulty</legend>
                {DIFFICULTY_OPTIONS.map((opt) => (
                  <label key={opt.value} className="reading-detail-radio">
                    <input
                      type="radio"
                      name="unit-test-difficulty"
                      checked={imageDifficulty === opt.value}
                      disabled={saving}
                      onChange={() => setImageDifficulty(opt.value)}
                    />
                    {opt.label}
                  </label>
                ))}
              </fieldset>

              {parsed && dialDigits.length > 0 ? (
                <div
                  className="unit-test-dial-row"
                  style={{ ['--dial-cols' as string]: String(meterDialCount) }}
                >
                  {Array.from({ length: meterDialCount }, (_, i) => (
                    <div key={i} className="unit-test-dial-cell">
                      <span className="unit-test-dial-label">Dial {i + 1}</span>
                      <select
                        className="image-dial-strip-digit-select"
                        aria-label={`Digit for dial ${i + 1}`}
                        value={normalizeDialDigit(dialDigits[i] ?? 0)}
                        disabled={saving}
                        onChange={(e) => handleDialChange(i, parseInt(e.target.value, 10))}
                      >
                        {Array.from({ length: 10 }, (_, d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              ) : null}

              <label className="reading-detail-meta-field" htmlFor="unit-test-expected-reading">
                <span>Correct reading (whole meter)</span>
                <input
                  id="unit-test-expected-reading"
                  className="reading-detail-meta-input"
                  value={expectedReading}
                  disabled={saving}
                  onChange={(e) => {
                    setReadingDetachedFromDials(true);
                    setExpectedReading(e.target.value);
                  }}
                  autoComplete="off"
                  inputMode="numeric"
                />
              </label>

              {parsed && dialDigits.length > 0 ? (
                <p className="reading-detail-field-hint">
                  <button
                    type="button"
                    className="training-hub-text-btn"
                    disabled={saving}
                    onClick={() => {
                      setReadingDetachedFromDials(false);
                      setExpectedReading(expectedFromDialDigits(dialDigits));
                    }}
                  >
                    Use digits from dials
                  </button>
                  <span> — fills left to right from the dial row above.</span>
                </p>
              ) : null}

              <button
                type="button"
                className={`save-button ${!isDirty ? 'saved' : ''}`}
                disabled={!isDirty || saving}
                onClick={() => void handleSave()}
              >
                {saving ? <Loader2 size={18} className="spin" /> : <Save size={18} />}
                {saving ? 'Saving…' : 'Save expected reading'}
              </button>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
};

export default UnitTestImageEditPage;
