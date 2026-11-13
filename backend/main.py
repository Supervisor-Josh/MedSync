from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy import Column, Integer, String, Float, DateTime, select
from datetime import datetime
from pydantic import BaseModel
from typing import List, Optional, Dict, Any

DATABASE_URL = "sqlite+aiosqlite:///./medsync.db"

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
Base = declarative_base()

class ResourceModel(Base):
    __tablename__ = "resources"
    id = Column(String, primary_key=True, index=True)
    name = Column(String, index=True)
    category = Column(String)
    quantity = Column(Integer)
    min_threshold = Column(Integer)
    version = Column(Integer, default=1)
    updated_at = Column(DateTime, default=datetime.utcnow)

async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    # Seed initial data if empty
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(ResourceModel))
        existing = result.scalars().all()
        if not existing:
            initial_resources = [
                ResourceModel(id="101", name="Amoxicillin 500mg Dispersible", category="Antibiotics", quantity=120, min_threshold=30, version=1),
                ResourceModel(id="102", name="Malaria Rapid Diagnostic Kits (RDT)", category="Diagnostics", quantity=75, min_threshold=20, version=1),
                ResourceModel(id="103", name="Oxytocin Ampoules", category="Maternal Health", quantity=45, min_threshold=15, version=1),
                ResourceModel(id="104", name="Chlorine NaDCC Purification Tabs", category="Water & Sanitation", quantity=300, min_threshold=50, version=1),
            ]
            session.add_all(initial_resources)
            await session.commit()

app = FastAPI(title="MedSync FastAPI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session

@app.on_event("startup")
async def startup_event():
    await init_db()

@app.get("/api/resources", response_model=List[Dict[str, Any]])
async def get_resources(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ResourceModel))
    resources = result.scalars().all()
    return [
        {
            "id": r.id,
            "name": r.name,
            "category": r.category,
            "quantity": r.quantity,
            "min_threshold": r.min_threshold,
            "version": r.version,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None
        }
        for r in resources
    ]

class SyncAction(BaseModel):
    op_id: str
    resource_id: str
    action: str
    base_version: int
    delta_qty: int
    payload: Dict[str, Any]

class SyncPushPayload(BaseModel):
    client_id: str
    actions: List[SyncAction]

@app.post("/api/sync/push")
async def push_sync(payload: SyncPushPayload, db: AsyncSession = Depends(get_db)):
    for action in payload.actions:
        res_query = await db.execute(select(ResourceModel).where(ResourceModel.id == str(action.resource_id)))
        resource = res_query.scalars().first()
        
        if not resource:
            # Fallback check
            all_res = (await db.execute(select(ResourceModel))).scalars().all()
            resource = next((r for r in all_res if str(r.id).lower() == str(action.resource_id).lower()), None)
            
        if not resource:
            continue

        # Check for conflict (version mismatch)
        if resource.version != action.base_version:
            return {
                "status": "CONFLICT",
                "resource_id": resource.id,
                "server_state": {
                    "id": resource.id,
                    "name": resource.name,
                    "quantity": resource.quantity,
                    "version": resource.version,
                    "min_threshold": resource.min_threshold
                },
                "client_attempt": {
                    "base_version": action.base_version,
                    "payload": action.payload
                }
            }
        
        # Apply update
        if "quantity" in action.payload:
            resource.quantity = action.payload["quantity"]
        resource.version += 1
        resource.updated_at = datetime.utcnow()
        await db.commit()

    return {"status": "SUCCESS", "synced_actions": len(payload.actions)}

class ConflictResolutionSchema(BaseModel):
    resource_id: str
    resolution_strategy: str
    local_delta: int

@app.post("/api/sync/resolve-conflict")
async def resolve_conflict(data: ConflictResolutionSchema, db: AsyncSession = Depends(get_db)):
    res_query = await db.execute(select(ResourceModel).where(ResourceModel.id == str(data.resource_id)))
    resource = res_query.scalars().first()
    
    if not resource:
        all_res = (await db.execute(select(ResourceModel))).scalars().all()
        resource = next((r for r in all_res if str(r.id).lower() == str(data.resource_id).lower()), None)
        
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    if data.resolution_strategy == "smart_delta_merge":
        resource.quantity = max(0, resource.quantity + data.local_delta)
    elif data.resolution_strategy == "keep_local":
        pass

    resource.version += 1
    resource.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(resource)

    return {"status": "RESOLVED", "new_version": resource.version, "quantity": resource.quantity}
