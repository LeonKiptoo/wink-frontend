from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Wink"
    app_env: str = "production"
    api_base_url: str = Field(default="", alias="API_BASE_URL")
    frontend_origin: str = Field(default="*", alias="FRONTEND_ORIGIN")
    supabase_url: str = Field(default="", alias="SUPABASE_URL")
    supabase_anon_key: str = Field(default="", alias="SUPABASE_ANON_KEY")
    checkout_url: str = Field(default="", alias="CHECKOUT_URL")


settings = Settings()


def missing_public_config() -> list[str]:
    missing = []
    if not settings.api_base_url.strip():
        missing.append("API_BASE_URL")
    if not settings.supabase_url.strip():
        missing.append("SUPABASE_URL")
    if not settings.supabase_anon_key.strip():
        missing.append("SUPABASE_ANON_KEY")
    return missing


app = FastAPI(title=settings.app_name)
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
        "workers": 1,
        "config_complete": not missing_public_config(),
        "missing_public_config": missing_public_config(),
    }


@app.get("/config")
async def config() -> dict[str, Any]:
    missing = missing_public_config()
    if missing:
        raise HTTPException(
            status_code=503,
            detail={
                "message": "Frontend public configuration is incomplete on Railway.",
                "missing": missing,
            },
        )
    return {
        "appName": settings.app_name,
        "apiBaseUrl": settings.api_base_url,
        "supabaseUrl": settings.supabase_url,
        "supabaseAnonKey": settings.supabase_anon_key,
        "checkoutUrl": settings.checkout_url,
    }


@app.get("/client-config")
async def client_config() -> dict[str, Any]:
    return await config()
