import { useState } from 'react';
import { 
  Image as ImageIcon, 
  ExternalLink, 
  CheckCircle, 
  XCircle, 
  HelpCircle,
  ChevronLeft,
  ChevronRight,
  Loader2
} from 'lucide-react';
import { ImageRecord } from '../types';

interface ImageGalleryProps {
  images: ImageRecord[];
  isLoading?: boolean;
  onLoadMore?: () => void;
  hasMore?: boolean;
}

function getFeedbackIcon(feedbackType: string) {
  switch (feedbackType) {
    case 'correct':
      return <CheckCircle className="w-4 h-4 text-accent-green" />;
    case 'incorrect':
      return <XCircle className="w-4 h-4 text-accent-red" />;
    case 'not_sure':
      return <HelpCircle className="w-4 h-4 text-accent-yellow" />;
    default:
      return <ImageIcon className="w-4 h-4 text-gray-400" />;
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case 'uploaded':
      return 'bg-accent-blue/20 text-accent-blue';
    case 'reviewed':
      return 'bg-accent-yellow/20 text-accent-yellow';
    case 'labeled':
      return 'bg-accent-purple/20 text-accent-purple';
    case 'trained':
      return 'bg-accent-green/20 text-accent-green';
    default:
      return 'bg-gray-500/20 text-gray-400';
  }
}

export function ImageGallery({ images, isLoading, onLoadMore, hasMore }: ImageGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  if (isLoading && images.length === 0) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <div key={i} className="aspect-square bg-dark-700 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <ImageIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>No images found for this work type</p>
      </div>
    );
  }

  const selectedImage = selectedIndex !== null ? images[selectedIndex] : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {images.map((image, index) => (
          <div
            key={image.session_id}
            onClick={() => setSelectedIndex(index)}
            className="group relative aspect-square bg-dark-700 rounded-xl overflow-hidden cursor-pointer border border-dark-600 hover:border-accent-blue transition-all"
          >
            {image.s3_url ? (
              <img
                src={image.s3_url}
                alt={image.session_id}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <ImageIcon className="w-8 h-8 text-gray-500" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="absolute bottom-0 left-0 right-0 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {getFeedbackIcon(image.feedback_type)}
                    <span className="text-xs text-white font-medium">
                      {image.ml_prediction || 'N/A'}
                    </span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${getStatusColor(image.status)}`}>
                    {image.status}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {hasMore && (
        <div className="text-center">
          <button
            onClick={onLoadMore}
            disabled={isLoading}
            className="px-6 py-3 bg-dark-700 hover:bg-dark-600 border border-dark-600 rounded-lg text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 mx-auto"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading...
              </>
            ) : (
              'Load More'
            )}
          </button>
        </div>
      )}

      {selectedImage && (
        <div 
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedIndex(null)}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              setSelectedIndex(selectedIndex > 0 ? selectedIndex - 1 : images.length - 1);
            }}
            className="absolute left-4 p-2 bg-dark-700 hover:bg-dark-600 rounded-full transition-colors"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>

          <div 
            className="max-w-4xl w-full bg-dark-800 rounded-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="aspect-video relative bg-dark-900">
              {selectedImage.s3_url ? (
                <img
                  src={selectedImage.s3_url}
                  alt={selectedImage.session_id}
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <ImageIcon className="w-16 h-16 text-gray-500" />
                </div>
              )}
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {getFeedbackIcon(selectedImage.feedback_type)}
                  <span className="font-mono text-sm text-gray-400">
                    {selectedImage.session_id}
                  </span>
                </div>
                <a
                  href={selectedImage.s3_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-accent-blue hover:underline text-sm"
                >
                  Open in S3 <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-gray-400 block">ML Prediction</span>
                  <span className="font-semibold text-white">{selectedImage.ml_prediction || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-gray-400 block">User Correction</span>
                  <span className="font-semibold text-white">{selectedImage.user_correction || '-'}</span>
                </div>
                <div>
                  <span className="text-gray-400 block">Confidence</span>
                  <span className="font-semibold text-white">{(selectedImage.confidence * 100).toFixed(1)}%</span>
                </div>
                <div>
                  <span className="text-gray-400 block">Dial Count</span>
                  <span className="font-semibold text-white">{selectedImage.dial_count}</span>
                </div>
                <div>
                  <span className="text-gray-400 block">Upload Mode</span>
                  <span className="font-semibold text-white capitalize">{selectedImage.upload_mode}</span>
                </div>
                <div>
                  <span className="text-gray-400 block">Image Source</span>
                  <span className="font-semibold text-white capitalize">{selectedImage.image_source}</span>
                </div>
                <div>
                  <span className="text-gray-400 block">User</span>
                  <span className="font-semibold text-white">{selectedImage.user_name}</span>
                </div>
                <div>
                  <span className="text-gray-400 block">Status</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs ${getStatusColor(selectedImage.status)}`}>
                    {selectedImage.status}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              setSelectedIndex(selectedIndex < images.length - 1 ? selectedIndex + 1 : 0);
            }}
            className="absolute right-4 p-2 bg-dark-700 hover:bg-dark-600 rounded-full transition-colors"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </div>
      )}
    </div>
  );
}
