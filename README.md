# Work Type Portal

A web application for managing and monitoring utility inspection data organized by work types.

## Work Types Supported

| Code | Name | Description |
|------|------|-------------|
| INTR | Intrusive Inspection | Internal inspection of pipelines and structures |
| GO95 | GO95 Electrical Pole Inspection | Electrical pole safety inspection per GO95 standards |
| RISR | Riser Inspection | Gas riser pipe inspection |
| LEAK | Leak Inspection | Gas leak detection and inspection |
| METR | Meter Reading | Analog meter dial reading |

Each work type has associated condition codes for categorizing findings.

## Architecture

```
meter_reading_website/
├── backend/              # FastAPI backend
│   ├── main.py          # API entry point
│   ├── routers/         # API endpoints
│   ├── services/        # DynamoDB & S3 services
│   └── models/          # Pydantic models
├── frontend/            # React + TypeScript frontend
│   ├── src/
│   │   ├── components/  # Reusable UI components
│   │   ├── pages/       # Page components
│   │   ├── services/    # API client
│   │   └── types/       # TypeScript types
│   └── ...
└── README.md
```

## Setup

### Backend

1. Create a virtual environment:
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Create `.env` file from example:
```bash
cp .env.example .env
# Edit .env with your AWS credentials
```

4. Run the server:
```bash
uvicorn main:app --reload --port 8000
```

### Frontend

1. Install dependencies:
```bash
cd frontend
npm install
```

2. Run development server:
```bash
npm run dev
```

The frontend will run on `http://localhost:5173` and proxy API requests to the backend.

## API Endpoints

### Work Types

- `GET /api/work-types` - List all work types
- `GET /api/work-types/stats` - Get stats for all work types
- `GET /api/work-types/{code}` - Get work type details
- `GET /api/work-types/{code}/stats` - Get stats for a specific work type

### Images

- `GET /api/images/by-work-type/{code}` - Get images for a work type (paginated)
- `GET /api/images/{session_id}` - Get a specific image
- `PUT /api/images/{session_id}/status` - Update image status

## iOS App Integration

The iOS app (AnalogMeterReader) uploads images with work type metadata:

- S3 path: `{work_type}/{mode}_{feedback}/{session_id}/`
- DynamoDB: `Images` table with `work_type`, `work_type_name`, `condition_code`, `status` fields

When the iOS app uploads an image, it automatically appears in the portal under the selected work type.

## Workflow

1. **Upload**: iOS app uploads image with work type → appears in portal
2. **Review**: Portal displays stats and images by work type
3. **Label**: Update image status via portal (uploaded → reviewed → labeled)
4. **Train**: Use labeled data for ML model training
