import { Navigate, useOutletContext } from 'react-router-dom';
import type { FC } from 'react';
import type { PortalOutletWorkContext } from '../utils/portalWorkMode';

/** Legacy route: training / pipelines live under `/training`. */
const DatasetsPage: FC = () => {
  const outletCtx = useOutletContext<PortalOutletWorkContext | undefined>();
  if (outletCtx?.workMode === 'reviewer') {
    return <Navigate to="/" replace />;
  }
  return <Navigate to="/training" replace />;
};

export default DatasetsPage;
