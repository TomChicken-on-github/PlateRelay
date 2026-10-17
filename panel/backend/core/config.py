from typing import Optional
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

class PanelSettings(BaseSettings):
    HOST: str = Field(default="0.0.0.0", description="Panel backend host")
    PORT: int = Field(default=8000, description="Panel backend port")
    DAEMON_SECRET_TOKEN: str = Field(
        default="platerelay_daemon_secret_token_123",
        description="Shared secret token for authenticating Daemons"
    )
    WORKSPACE_PROFILE: str = Field(
        default="event",
        description="Workspace deployment profile (event, lab, farm)"
    )
    CORS_ORIGINS: list[str] = Field(
        default=["*"],
        description="CORS allowed origins"
    )
    TELEMETRY_BROADCAST_INTERVAL_SEC: float = Field(
        default=1.0,
        description="Throttle interval for broadcasting updates to browser clients"
    )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="PANEL_",
        extra="ignore"
    )

settings = PanelSettings()
