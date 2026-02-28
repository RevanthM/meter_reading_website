import { 
  Image, 
  Upload, 
  CheckCircle, 
  Tag, 
  Cpu,
  BarChart3,
  AlertCircle
} from 'lucide-react';
import { WorkTypeStats } from '../types';
import { StatsCard } from './StatsCard';

interface StatsDisplayProps {
  stats: WorkTypeStats | null;
  isLoading?: boolean;
  error?: string;
}

export function StatsDisplay({ stats, isLoading, error }: StatsDisplayProps) {
  if (isLoading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-dark-700 rounded-xl" />
          ))}
        </div>
        <div className="h-64 bg-dark-700 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-accent-red/10 border border-accent-red/20 rounded-xl p-6 flex items-center gap-4">
        <AlertCircle className="w-8 h-8 text-accent-red flex-shrink-0" />
        <div>
          <h3 className="font-semibold text-accent-red">Error Loading Stats</h3>
          <p className="text-sm text-gray-400 mt-1">{error}</p>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="text-center py-12 text-gray-400">
        <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>Select a work type to view statistics</p>
      </div>
    );
  }

  const { status_breakdown, feedback_breakdown, condition_code_counts } = stats;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">{stats.work_type_name}</h2>
          <p className="text-sm text-gray-400 mt-1">Code: {stats.work_type_code}</p>
        </div>
        <span className="px-3 py-1 bg-accent-blue/20 text-accent-blue rounded-full text-sm font-medium">
          {stats.total_images.toLocaleString()} total images
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Uploaded"
          value={status_breakdown.uploaded}
          icon={<Upload className="w-5 h-5" />}
          color="blue"
          subtitle="Awaiting review"
        />
        <StatsCard
          title="Reviewed"
          value={status_breakdown.reviewed}
          icon={<CheckCircle className="w-5 h-5" />}
          color="yellow"
          subtitle="Quality checked"
        />
        <StatsCard
          title="Labeled"
          value={status_breakdown.labeled}
          icon={<Tag className="w-5 h-5" />}
          color="purple"
          subtitle="Ready for training"
        />
        <StatsCard
          title="Trained"
          value={status_breakdown.trained}
          icon={<Cpu className="w-5 h-5" />}
          color="green"
          subtitle="Used in model"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-dark-700 rounded-xl p-6 border border-dark-600">
          <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
            <Image className="w-5 h-5 text-accent-blue" />
            Feedback Breakdown
          </h3>
          <div className="space-y-3">
            {Object.entries(feedback_breakdown).map(([type, count]) => {
              const percentage = stats.total_images > 0 
                ? ((count / stats.total_images) * 100).toFixed(1)
                : '0';
              return (
                <div key={type} className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-300 capitalize">
                        {type.replace(/_/g, ' ')}
                      </span>
                      <span className="text-gray-400">{count} ({percentage}%)</span>
                    </div>
                    <div className="h-2 bg-dark-600 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-accent-blue rounded-full transition-all duration-500"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-dark-700 rounded-xl p-6 border border-dark-600">
          <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
            <Tag className="w-5 h-5 text-accent-purple" />
            Condition Codes
          </h3>
          {condition_code_counts.length > 0 ? (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {condition_code_counts.map(({ code, count }) => (
                <div 
                  key={code}
                  className="flex items-center justify-between py-2 px-3 bg-dark-600/50 rounded-lg"
                >
                  <span className="text-sm text-gray-300 font-mono">
                    {code.replace(/_/g, ' ')}
                  </span>
                  <span className="text-sm font-semibold text-accent-purple">
                    {count}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-400 text-sm">No condition codes recorded yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
