import gc
import os
from collections import OrderedDict
from contextlib import asynccontextmanager
from typing import Any, Iterable

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Wink"
    app_env: str = "production"
    api_base_url: str = Field(..., alias="API_BASE_URL")
    frontend_origin: str = Field(default="*", alias="FRONTEND_ORIGIN")
    supabase_url: str = Field(..., alias="SUPABASE_URL")
    supabase_anon_key: str = Field(..., alias="SUPABASE_ANON_KEY")
    checkout_url: str = Field(default="", alias="CHECKOUT_URL")
    vector_cache_limit: int = Field(default=2, alias="VECTOR_CACHE_LIMIT")
    vector_batch_size: int = Field(default=24, alias="VECTOR_BATCH_SIZE")


settings = Settings()


class VectorStoreManager:
    """
    Single-worker, low-memory vector store coordinator.
    Keeps only a small LRU cache in memory and rebuilds indexes in batches.
    """

    def __init__(self, cache_limit: int = 2, batch_size: int = 24) -> None:
        self.cache_limit = max(1, cache_limit)
        self.batch_size = max(4, batch_size)
        self._stores: OrderedDict[str, Any] = OrderedDict()

    def get(self, workspace_id: str) -> Any | None:
        store = self._stores.get(workspace_id)
        if store is not None:
            self._stores.move_to_end(workspace_id)
        return store

    def put(self, workspace_id: str, store: Any) -> None:
        self._stores[workspace_id] = store
        self._stores.move_to_end(workspace_id)
        self._trim()

    def _trim(self) -> None:
        while len(self._stores) > self.cache_limit:
            _, removed = self._stores.popitem(last=False)
            close = getattr(removed, "close", None)
            if callable(close):
                close()
            del removed
            gc.collect()

    def rebuild(self, workspace_id: str, documents: Iterable[Any], indexer: Any) -> dict[str, Any]:
        total = 0
        for batch in self._batched(documents):
            indexer.add(batch)
            total += len(batch)
            del batch
            gc.collect()
        store = getattr(indexer, "store", None)
        if store is not None:
            self.put(workspace_id, store)
        return {"workspace_id": workspace_id, "indexed_documents": total, "batch_size": self.batch_size}

    def _batched(self, items: Iterable[Any]) -> Iterable[list[Any]]:
        batch: list[Any] = []
        for item in items:
            batch.append(item)
            if len(batch) >= self.batch_size:
                yield batch
                batch = []
        if batch:
            yield batch


vector_store_manager = VectorStoreManager(
    cache_limit=settings.vector_cache_limit,
    batch_size=settings.vector_batch_size,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
    os.environ.setdefault("MKL_NUM_THREADS", "1")
    yield
    gc.collect()


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin] if settings.frontend_origin != "*" else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "environment": settings.app_env,
        "vector_cache_limit": settings.vector_cache_limit,
        "vector_batch_size": settings.vector_batch_size,
        "workers": 1,
    }


@app.get("/config")
async def config() -> dict[str, Any]:
    return {
        "appName": settings.app_name,
        "apiBaseUrl": settings.api_base_url,
        "supabaseUrl": settings.supabase_url,
        "supabaseAnonKey": settings.supabase_anon_key,
        "checkoutUrl": settings.checkout_url,
    }


@app.get("/memory-profile")
async def memory_profile() -> dict[str, Any]:
    return {
        "workers": 1,
        "vector_cache_limit": settings.vector_cache_limit,
        "vector_batch_size": settings.vector_batch_size,
        "cached_workspaces": list(vector_store_manager._stores.keys()),
    }
