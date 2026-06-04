import type { FC } from 'react';
import { formatReadingDateTime } from '../utils/readingDisplayDates';

type Props = {
  capturedBy?: string | null;
  dialCount?: number | null;
  hadUserCorrection?: boolean;
  correctedBy?: string | null;
  correctedAt?: string | null;
  correctedOnDevice?: boolean;
  className?: string;
};

/** Captured-by line plus optional portal reviewer correction attribution. */
const FieldTestCorrectionMetaLines: FC<Props> = ({
  capturedBy,
  dialCount,
  hadUserCorrection,
  correctedBy,
  correctedAt,
  correctedOnDevice,
  className = 'field-test-capture-lightbox-meta-line',
}) => {
  const dialLabel =
    typeof dialCount === 'number' && Number.isFinite(dialCount) ? `${dialCount} reads` : null;
  const reviewer = correctedBy?.trim() || '';
  const showCorrectionLine =
    hadUserCorrection ||
    correctedOnDevice ||
    reviewer.length > 0 ||
    Boolean(correctedAt?.trim());

  return (
    <>
      <p className={className}>
        Captured by: <strong>{capturedBy?.trim() || 'Unknown'}</strong>
        {dialLabel ? <> · {dialLabel}</> : null}
      </p>
      {showCorrectionLine ? (
        <p className={`${className} field-test-correction-meta`}>
          {reviewer ? (
            <>
              Corrected by: <strong>{reviewer}</strong>
              {correctedAt ? (
                <>
                  {' '}
                  · <time dateTime={correctedAt}>{formatReadingDateTime(correctedAt)}</time>
                </>
              ) : null}
            </>
          ) : correctedOnDevice ? (
            <>Corrected on device</>
          ) : hadUserCorrection ? (
            <>Dial reading changed vs model</>
          ) : null}
        </p>
      ) : null}
    </>
  );
};

export default FieldTestCorrectionMetaLines;
