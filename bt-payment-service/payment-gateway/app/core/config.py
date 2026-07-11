# app/core/config.py
# This file defines the global configuration system of the application using Pydantic Settings.
# It reads settings from environment variables and an optional '.env' file, applying type validations.


from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def parse_cors_origins(v: str | list[str]) -> list[str]:
    """
    Parses a comma-separated string of CORS origins into a list of strings,
    or returns the list directly if already parsed.
    """
    if isinstance(v, str):
        if not v.strip():
            return []
        # Support both standard comma-separated lists and simple bracket notation
        if v.startswith("[") and v.endswith("]"):
            import json

            try:
                parsed = json.loads(v)
                if isinstance(parsed, list):
                    return [str(item).strip() for item in parsed]
            except Exception:
                pass
        return [i.strip() for i in v.split(",") if i.strip()]
    elif isinstance(v, list):
        return [str(item).strip() for item in v]
    raise ValueError(f"Invalid CORS origins value: {v}")


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables and validated.
    Uses Pydantic Settings (v2) features.
    """

    # Configure the settings loader to check for an .env file first
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", case_sensitive=True, extra="ignore"
    )

    # Core Settings
    ENV: str = "development"
    DEBUG: bool = True
    PROJECT_NAME: str = "BharatTruck Payment Service"
    API_V1_STR: str = "/api/v1"

    # Server Settings
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # CORS Settings
    # Raw string parsed by property. E.g. "http://localhost:3000,http://localhost:8000"
    BACKEND_CORS_ORIGINS: str = ""

    @property
    def cors_origins(self) -> list[str]:
        """
        Parses the raw BACKEND_CORS_ORIGINS string into a list of strings.
        Supports both comma-separated and JSON list formats.
        """
        val = self.BACKEND_CORS_ORIGINS.strip()
        if not val:
            return []
        if val.startswith("[") and val.endswith("]"):
            import json

            try:
                parsed = json.loads(val)
                if isinstance(parsed, list):
                    return [str(item).strip() for item in parsed]
            except Exception:
                pass
        return [i.strip() for i in val.split(",") if i.strip()]

    # Database Settings
    DB_HOST: str = "localhost"
    DB_PORT: int = 5432
    DB_USER: str = "postgres"
    DB_PASSWORD: str = "postgres"
    DB_NAME: str = "payment_db"

    # Connection URL (takes precedence if set, otherwise constructed from fields above)
    DATABASE_URL: str | None = None

    # Razorpay Gateway API Credentials (Required - fails fast if missing)
    RAZORPAY_KEY_ID: str
    RAZORPAY_KEY_SECRET: str
    RAZORPAY_WEBHOOK_SECRET: str

    # Logging Settings
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: str = "json"  # Options: 'json' or 'text'

    @field_validator("ENV")
    @classmethod
    def validate_env(cls, v: str) -> str:
        allowed = {"development", "production", "testing", "staging"}
        if v.lower() not in allowed:
            raise ValueError(f"ENV must be one of {allowed}")
        return v.lower()

    @field_validator("LOG_LEVEL")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        allowed = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
        if v.upper() not in allowed:
            raise ValueError(f"LOG_LEVEL must be one of {allowed}")
        return v.upper()

    @field_validator("LOG_FORMAT")
    @classmethod
    def validate_log_format(cls, v: str) -> str:
        allowed = {"json", "text"}
        if v.lower() not in allowed:
            raise ValueError(f"LOG_FORMAT must be one of {allowed}")
        return v.lower()

    @field_validator(
        "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"
    )
    @classmethod
    def validate_non_empty_secrets(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Razorpay configuration variables cannot be empty")
        return v

    @property
    def get_database_url(self) -> str:
        """
        Dynamically computes the connection URL if not provided directly.
        """
        if self.DATABASE_URL:
            return self.DATABASE_URL
        return f"postgresql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"


# Instantiated settings object to import across the project
settings = Settings()
