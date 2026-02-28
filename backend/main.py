from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import work_types_router, images_router

app = FastAPI(
    title="Work Type Portal API",
    description="API for managing work types and images for utility inspection training",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(work_types_router)
app.include_router(images_router)


@app.get("/")
async def root():
    return {
        "message": "Work Type Portal API",
        "version": "1.0.0",
        "docs": "/docs",
    }


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
