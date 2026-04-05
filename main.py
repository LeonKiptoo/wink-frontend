import os
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Wink"
    app_env: str = "production"
    frontend_origin: str = "*"


settings = Settings()


def env_value(*names: str) -> str:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""


def missing_auth_config() -> list[str]:
    supabase_url = env_value("SUPABASE_URL", "PUBLIC_SUPABASE_URL")
    supabase_anon_key = env_value("SUPABASE_ANON_KEY", "PUBLIC_SUPABASE_ANON_KEY")
    missing = []
    if not supabase_url:
        missing.append("SUPABASE_URL")
    if not supabase_anon_key:
        missing.append("SUPABASE_ANON_KEY")
    return missing


def missing_backend_config() -> list[str]:
    return [] if env_value("API_BASE_URL", "PUBLIC_API_BASE") else ["API_BASE_URL"]


def public_config_payload() -> dict[str, Any]:
    missing_backend = missing_backend_config()
    return {
        "appName": settings.app_name,
        "apiBaseUrl": env_value("API_BASE_URL", "PUBLIC_API_BASE"),
        "supabaseUrl": env_value("SUPABASE_URL", "PUBLIC_SUPABASE_URL"),
        "supabaseAnonKey": env_value("SUPABASE_ANON_KEY", "PUBLIC_SUPABASE_ANON_KEY"),
        "checkoutUrl": env_value("CHECKOUT_URL", "PUBLIC_CHECKOUT_URL"),
        "backendConfigured": not missing_backend,
        "missingBackendConfig": missing_backend,
    }


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
    missing_auth = missing_auth_config()
    missing_backend = missing_backend_config()
    return {
        "status": "ok",
        "environment": settings.app_env,
        "auth_config_complete": not missing_auth,
        "backend_config_complete": not missing_backend,
        "missing_auth_config": missing_auth,
        "missing_backend_config": missing_backend,
    }


@app.get("/config")
async def config() -> dict[str, Any]:
    missing_auth = missing_auth_config()
    if missing_auth:
        raise HTTPException(
            status_code=503,
            detail={
                "message": "Frontend Supabase configuration is incomplete on Railway.",
                "missing": missing_auth,
            },
        )
    return public_config_payload()


@app.get("/client-config")
async def client_config() -> dict[str, Any]:
    return await config()
