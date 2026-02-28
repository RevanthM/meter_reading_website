import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Image as ImageIcon } from 'lucide-react';
import { WorkTypeDropdown, StatsDisplay, ImageGallery } from '../components';
import { WorkType, WorkTypeStats, ImageRecord } from '../types';
import { 
  fetchWorkTypes, 
  fetchWorkTypeStats, 
  fetchImagesByWorkType 
} from '../services/api';

export function Dashboard() {
  const [workTypes, setWorkTypes] = useState<WorkType[]>([]);
  const [selectedWorkType, setSelectedWorkType] = useState<string | null>(null);
  const [stats, setStats] = useState<WorkTypeStats | null>(null);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [nextToken, setNextToken] = useState<string | undefined>();
  
  const [isLoadingWorkTypes, setIsLoadingWorkTypes] = useState(true);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showImages, setShowImages] = useState(false);

  useEffect(() => {
    loadWorkTypes();
  }, []);

  async function loadWorkTypes() {
    setIsLoadingWorkTypes(true);
    try {
      const data = await fetchWorkTypes();
      setWorkTypes(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load work types');
    } finally {
      setIsLoadingWorkTypes(false);
    }
  }

  const loadStats = useCallback(async (workTypeCode: string) => {
    setIsLoadingStats(true);
    setError(null);
    try {
      const data = await fetchWorkTypeStats(workTypeCode);
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stats');
      setStats(null);
    } finally {
      setIsLoadingStats(false);
    }
  }, []);

  const loadImages = useCallback(async (workTypeCode: string, reset: boolean = true) => {
    setIsLoadingImages(true);
    try {
      const response = await fetchImagesByWorkType(
        workTypeCode, 
        20, 
        reset ? undefined : nextToken
      );
      setImages(reset ? response.images : [...images, ...response.images]);
      setNextToken(response.next_token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load images');
    } finally {
      setIsLoadingImages(false);
    }
  }, [nextToken, images]);

  function handleWorkTypeSelect(code: string) {
    setSelectedWorkType(code);
    setShowImages(false);
    setImages([]);
    setNextToken(undefined);
    loadStats(code);
  }

  function handleRefresh() {
    if (selectedWorkType) {
      loadStats(selectedWorkType);
      if (showImages) {
        loadImages(selectedWorkType, true);
      }
    }
  }

  function handleShowImages() {
    if (selectedWorkType && !showImages) {
      setShowImages(true);
      loadImages(selectedWorkType, true);
    }
  }

  function handleLoadMore() {
    if (selectedWorkType && nextToken) {
      loadImages(selectedWorkType, false);
    }
  }

  return (
    <div className="min-h-screen bg-dark-900">
      <header className="border-b border-dark-600 bg-dark-800/50 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">Work Type Portal</h1>
              <p className="text-sm text-gray-400 mt-1">
                Manage and monitor inspection data by work type
              </p>
            </div>
            <button
              onClick={handleRefresh}
              disabled={!selectedWorkType || isLoadingStats}
              className="p-2 bg-dark-700 hover:bg-dark-600 border border-dark-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Refresh"
            >
              <RefreshCw className={`w-5 h-5 ${isLoadingStats ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-8">
          <div className="bg-dark-800 rounded-xl border border-dark-600 p-6">
            <WorkTypeDropdown
              workTypes={workTypes}
              selectedWorkType={selectedWorkType}
              onSelect={handleWorkTypeSelect}
              isLoading={isLoadingWorkTypes}
            />
          </div>

          {selectedWorkType && (
            <>
              <div className="bg-dark-800 rounded-xl border border-dark-600 p-6">
                <StatsDisplay
                  stats={stats}
                  isLoading={isLoadingStats}
                  error={error || undefined}
                />
              </div>

              <div className="bg-dark-800 rounded-xl border border-dark-600 p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <ImageIcon className="w-5 h-5 text-accent-blue" />
                    Images
                  </h2>
                  {!showImages && (
                    <button
                      onClick={handleShowImages}
                      className="px-4 py-2 bg-accent-blue hover:bg-accent-blue/80 rounded-lg text-white font-medium transition-colors"
                    >
                      Load Images
                    </button>
                  )}
                </div>
                
                {showImages ? (
                  <ImageGallery
                    images={images}
                    isLoading={isLoadingImages}
                    onLoadMore={handleLoadMore}
                    hasMore={!!nextToken}
                  />
                ) : (
                  <div className="text-center py-12 text-gray-400">
                    <ImageIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>Click "Load Images" to view images for this work type</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </main>

      <footer className="border-t border-dark-600 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-center text-sm text-gray-500">
            Work Type Portal v1.0.0 • Connected to DynamoDB
          </p>
        </div>
      </footer>
    </div>
  );
}
