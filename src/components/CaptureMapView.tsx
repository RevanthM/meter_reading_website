import { useEffect, useMemo, useState, type FC } from 'react';
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import 'leaflet/dist/leaflet.css';
import { ChevronRight, Eye, MapPin, X } from 'lucide-react';
import type { S3MeterReading } from '../services/api';
import { getReadingListStatusDisplay } from '../types';
import { captureLocationListLine } from '../utils/captureLocation';
import {
  CALIFORNIA_MAP_CENTER,
  CALIFORNIA_MAP_ZOOM,
  clusterCapturePoints,
  splitReadingsByLocation,
  type CaptureMapCluster,
} from '../utils/captureMapGeo';
import { formatReadingShortDate } from '../utils/readingDisplayDates';

// Vite does not bundle Leaflet default marker assets automatically.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

/** Stable pin icon — never pass `icon={undefined}` (breaks Leaflet teardown with react-leaflet). */
const singleCaptureIcon = L.icon({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

function clusterDivIcon(count: number, color: string): L.DivIcon {
  return L.divIcon({
    className: 'capture-map-cluster-marker',
    html: `<span class="capture-map-cluster-marker-inner" style="background:${color}">${count}</span>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

function FitBounds({ latLngs }: { latLngs: [number, number][] }) {
  const map = useMap();
  const key = latLngs.map((p) => p.join(',')).join('|');

  useEffect(() => {
    if (latLngs.length === 0) return;
    if (latLngs.length === 1) {
      map.setView(latLngs[0], 15);
      return;
    }
    const bounds = L.latLngBounds(latLngs);
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
  }, [map, key, latLngs]);

  return null;
}

type Props = {
  readings: S3MeterReading[];
  onSelectReading: (reading: S3MeterReading) => void;
};

type KeepAliveProps = Props & {
  /** When false, map stays mounted but hidden (avoids react-leaflet unmount crash). */
  active: boolean;
};

const CaptureMapView: FC<Props> = ({ readings, onSelectReading }) => {
  const [selectedCluster, setSelectedCluster] = useState<CaptureMapCluster | null>(null);

  const { located, unlocated, clusters } = useMemo(() => {
    const split = splitReadingsByLocation(readings);
    return {
      ...split,
      clusters: clusterCapturePoints(split.located),
    };
  }, [readings]);

  const latLngs = useMemo(
    () => clusters.map((c) => [c.lat, c.lng] as [number, number]),
    [clusters],
  );

  const mapDataKey = useMemo(() => clusters.map((c) => c.id).join('|'), [clusters]);

  useEffect(() => {
    setSelectedCluster(null);
  }, [mapDataKey]);

  if (readings.length === 0) {
    return <p className="capture-map-empty">No captures to show.</p>;
  }

  if (located.length === 0) {
    return (
      <div className="capture-map-shell">
        <p className="capture-map-empty">
          No GPS on these captures — switch to List or capture with location enabled on device.
        </p>
        {unlocated.length > 0 ? (
          <CaptureUnlocatedList readings={unlocated} onSelectReading={onSelectReading} />
        ) : null}
      </div>
    );
  }

  const sortedClusterReadings =
    selectedCluster && selectedCluster.readings.length > 1
      ? [...selectedCluster.readings].sort((a, b) =>
          String(b.dateOfReading || b.createdAt || '').localeCompare(
            String(a.dateOfReading || a.createdAt || ''),
          ),
        )
      : [];

  return (
    <div className="capture-map-shell">
      <div
        className={
          selectedCluster && selectedCluster.readings.length > 1
            ? 'capture-map-frame capture-map-frame--with-side-panel'
            : 'capture-map-frame'
        }
      >
        <div className="capture-map-map-area">
          <MapContainer
            key={mapDataKey || 'empty'}
            center={CALIFORNIA_MAP_CENTER}
            zoom={CALIFORNIA_MAP_ZOOM}
            className="capture-map-leaflet"
            scrollWheelZoom
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitBounds latLngs={latLngs} />
            {clusters.map((cluster) => {
              const { color } = getReadingListStatusDisplay(cluster.readings[0]);
              const icon =
                cluster.readings.length > 1
                  ? clusterDivIcon(cluster.readings.length, color)
                  : singleCaptureIcon;
              const isSelected =
                selectedCluster?.id === cluster.id && cluster.readings.length > 1;
              const dimOthers =
                selectedCluster != null &&
                selectedCluster.readings.length > 1 &&
                !isSelected;
              return (
                <Marker
                  key={cluster.id}
                  position={[cluster.lat, cluster.lng]}
                  icon={icon}
                  eventHandlers={{
                    click: () => {
                      if (cluster.readings.length === 1) {
                        onSelectReading(cluster.readings[0]);
                      } else {
                        setSelectedCluster(cluster);
                      }
                    },
                  }}
                  opacity={dimOthers ? 0.65 : 1}
                />
              );
            })}
          </MapContainer>
        </div>

        {selectedCluster && selectedCluster.readings.length > 1 ? (
          <aside
            className="capture-map-side-panel"
            role="dialog"
            aria-label="Captures at this location"
          >
            <div className="capture-map-side-panel-header">
              <div className="capture-map-side-panel-title">
                <MapPin size={18} aria-hidden />
                <div>
                  <strong>
                    {selectedCluster.readings.length} captures
                  </strong>
                  <span className="capture-map-side-panel-sub">
                    {captureLocationListLine(selectedCluster.readings[0]?.captureLocation) ||
                      'This location'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="capture-map-side-panel-close"
                onClick={() => setSelectedCluster(null)}
                aria-label="Close panel"
              >
                <X size={20} />
              </button>
            </div>
            <ul className="capture-map-side-panel-list">
              {sortedClusterReadings.map((reading) => (
                <li key={reading.id}>
                  <CaptureMapSideCard
                    reading={reading}
                    onSelect={() => onSelectReading(reading)}
                  />
                </li>
              ))}
            </ul>
          </aside>
        ) : null}
      </div>

      {unlocated.length > 0 ? (
        <details className="capture-map-unlocated-details">
          <summary>
            {unlocated.length} without location (list only)
          </summary>
          <CaptureUnlocatedList readings={unlocated} onSelectReading={onSelectReading} />
        </details>
      ) : null}
    </div>
  );
};

function CaptureMapSideCard({
  reading,
  onSelect,
}: {
  reading: S3MeterReading;
  onSelect: () => void;
}) {
  const { label, color } = getReadingListStatusDisplay(reading);
  return (
    <button type="button" className="capture-map-side-card" onClick={onSelect}>
      <div className="capture-map-side-card-body">
        <span className="capture-map-side-card-meter">{reading.meterValue || '—'}</span>
        <span className="capture-map-side-card-status" style={{ color }}>
          {label}
        </span>
        <span className="capture-map-side-card-date">
          {formatReadingShortDate(reading.dateOfReading)}
        </span>
        {reading.userName ? (
          <span className="capture-map-side-card-user">{reading.userName}</span>
        ) : null}
      </div>
      <ChevronRight size={18} className="capture-map-side-card-chevron" aria-hidden />
    </button>
  );
}

function CaptureMapPopupRow({
  reading,
  onView,
}: {
  reading: S3MeterReading;
  onView: () => void;
}) {
  const { label, color } = getReadingListStatusDisplay(reading);
  return (
    <div className="capture-map-popup-row">
      <div className="capture-map-popup-meta">
        <span className="capture-map-popup-meter">{reading.meterValue || '—'}</span>
        <span className="capture-map-popup-status" style={{ color }}>
          {label}
        </span>
        <span className="capture-map-popup-date">{formatReadingShortDate(reading.dateOfReading)}</span>
        <span className="capture-map-popup-place">
          {captureLocationListLine(reading.captureLocation)}
        </span>
        {reading.userName ? (
          <span className="capture-map-popup-user">{reading.userName}</span>
        ) : null}
      </div>
      <button type="button" className="capture-map-popup-view" onClick={onView}>
        <Eye size={14} />
        View
      </button>
    </div>
  );
}

function CaptureUnlocatedList({
  readings,
  onSelectReading,
}: {
  readings: S3MeterReading[];
  onSelectReading: (reading: S3MeterReading) => void;
}) {
  return (
    <ul className="capture-map-unlocated-list">
      {readings.map((reading) => (
        <li key={reading.id}>
          <CaptureMapPopupRow reading={reading} onView={() => onSelectReading(reading)} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Keeps Leaflet mounted when switching to List so react-leaflet does not tear down
 * markers while the map is being destroyed (see _leaflet_events / _removeIcon crash).
 */
export const CaptureMapViewKeepAlive: FC<KeepAliveProps> = ({
  active,
  readings,
  onSelectReading,
}) => {
  const [mapEverOpened, setMapEverOpened] = useState(false);

  useEffect(() => {
    if (active && readings.length > 0) setMapEverOpened(true);
  }, [active, readings.length]);

  useEffect(() => {
    if (readings.length === 0) setMapEverOpened(false);
  }, [readings.length]);

  if (!mapEverOpened) return null;

  return (
    <div
      className={
        active
          ? 'capture-map-keepalive capture-map-keepalive--visible'
          : 'capture-map-keepalive capture-map-keepalive--hidden'
      }
      aria-hidden={!active}
    >
      <CaptureMapView readings={readings} onSelectReading={onSelectReading} />
    </div>
  );
};

export default CaptureMapView;
