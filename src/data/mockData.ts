import type { MeterReading, DashboardCounts } from '../types';

// Generate placeholder image URLs
const generateImageUrl = (id: string, index: number) => 
  `https://picsum.photos/seed/${id}-${index}/400/300`;

// Generate mock meter readings
export const generateMockReadings = (): MeterReading[] => {
  const locations = [
    'Building A - Floor 1', 'Building A - Floor 2', 'Building A - Floor 3',
    'Building B - Basement', 'Building B - Floor 1', 'Building B - Floor 2',
    'Warehouse East', 'Warehouse West', 'Utility Room 1', 'Utility Room 2',
    'Main Office', 'Server Room', 'Lab 101', 'Lab 102', 'Storage Facility'
  ];

  const readings: MeterReading[] = [];
  
  // Correct readings
  for (let i = 0; i < 42; i++) {
    readings.push(createReading(`correct-${i}`, 'correct', locations[i % locations.length]));
  }
  
  // Incorrect - New
  for (let i = 0; i < 15; i++) {
    readings.push(createReading(`new-${i}`, 'incorrect_new', locations[i % locations.length]));
  }
  
  // Incorrect - Analyzed
  for (let i = 0; i < 8; i++) {
    readings.push(createReading(`analyzed-${i}`, 'incorrect_analyzed', locations[i % locations.length]));
  }
  
  // Incorrect - Labeled
  for (let i = 0; i < 5; i++) {
    readings.push(createReading(`labeled-${i}`, 'incorrect_labeled', locations[i % locations.length]));
  }
  
  // Incorrect - Training
  for (let i = 0; i < 3; i++) {
    readings.push(createReading(`training-${i}`, 'incorrect_training', locations[i % locations.length]));
  }
  
  return readings;
};

function createReading(
  id: string, 
  status: MeterReading['status'], 
  location: string
): MeterReading {
  const daysAgo = Math.floor(Math.random() * 30);
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  
  const meterValue = String(Math.floor(Math.random() * 90000) + 10000);
  const type: MeterReading['type'] = Math.random() > 0.6 ? 'simulator' : 'field';
  
  return {
    id,
    dateOfReading: date.toISOString(),
    location,
    type,
    status,
    meterValue,
    expectedValue: status !== 'correct' ? String(parseInt(meterValue) + Math.floor(Math.random() * 100)) : undefined,
    comments: '',
    createdAt: date.toISOString(),
    updatedAt: date.toISOString(),
    images: [
      {
        id: `${id}-img-1`,
        url: generateImageUrl(id, 1),
        label: 'Full Meter View',
        metadata: {
          capturedAt: date.toISOString(),
          resolution: '4032x3024',
          fileSize: '2.4 MB',
        }
      },
      {
        id: `${id}-img-2`,
        url: generateImageUrl(id, 2),
        label: 'Dial 1',
        metadata: {
          capturedAt: date.toISOString(),
          resolution: '800x800',
          fileSize: '245 KB',
          dialIndex: 0
        }
      },
      {
        id: `${id}-img-3`,
        url: generateImageUrl(id, 3),
        label: 'Dial 2',
        metadata: {
          capturedAt: date.toISOString(),
          resolution: '800x800',
          fileSize: '231 KB',
          dialIndex: 1
        }
      },
      {
        id: `${id}-img-4`,
        url: generateImageUrl(id, 4),
        label: 'Dial 3',
        metadata: {
          capturedAt: date.toISOString(),
          resolution: '800x800',
          fileSize: '256 KB',
          dialIndex: 2
        }
      },
      {
        id: `${id}-img-5`,
        url: generateImageUrl(id, 5),
        label: 'Dial 4',
        metadata: {
          capturedAt: date.toISOString(),
          resolution: '800x800',
          fileSize: '248 KB',
          dialIndex: 3
        }
      }
    ]
  };
}

export const mockReadings = generateMockReadings();

export const calculateCounts = (readings: MeterReading[]): DashboardCounts => {
  return {
    totalPictures: readings.length * 5,
    correctCount: readings.filter(r => r.status === 'correct').length,
    incorrectNewCount: readings.filter(r => r.status === 'incorrect_new').length,
    incorrectAnalyzedCount: readings.filter(r => r.status === 'incorrect_analyzed').length,
    incorrectLabeledCount: readings.filter(r => r.status === 'incorrect_labeled').length,
    incorrectTrainingCount: readings.filter(r => r.status === 'incorrect_training').length,
  };
};
