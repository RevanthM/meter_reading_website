import { ReactNode } from 'react';

interface StatsCardProps {
  title: string;
  value: number | string;
  icon: ReactNode;
  color?: 'blue' | 'green' | 'yellow' | 'red' | 'purple';
  subtitle?: string;
}

const colorClasses = {
  blue: 'bg-accent-blue/10 text-accent-blue border-accent-blue/20',
  green: 'bg-accent-green/10 text-accent-green border-accent-green/20',
  yellow: 'bg-accent-yellow/10 text-accent-yellow border-accent-yellow/20',
  red: 'bg-accent-red/10 text-accent-red border-accent-red/20',
  purple: 'bg-accent-purple/10 text-accent-purple border-accent-purple/20',
};

export function StatsCard({ title, value, icon, color = 'blue', subtitle }: StatsCardProps) {
  return (
    <div className={`rounded-xl border p-5 ${colorClasses[color]}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium opacity-80">{title}</p>
          <p className="text-3xl font-bold mt-1">{value.toLocaleString()}</p>
          {subtitle && (
            <p className="text-xs mt-1 opacity-60">{subtitle}</p>
          )}
        </div>
        <div className="p-2 rounded-lg bg-white/5">
          {icon}
        </div>
      </div>
    </div>
  );
}
